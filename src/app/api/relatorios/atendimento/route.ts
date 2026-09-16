import { createClient } from "@/lib/supabase/server";
import { paginarRpc } from "@/lib/supabase/paginar-rpc";
import { canAccess } from "@/lib/auth/module-access";
import { diaBr, type SlaLinha } from "@/lib/reports/sla";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Meta de primeira resposta, em minutos ÚTEIS (decisão do Gabriel). */
export const SLA_TARGET_MIN = 15;
/** Expediente que o `private.business_minutes` aplica — só para exibir na tela. */
export const EXPEDIENTE = "seg a sex, 8h às 19h";

const PERIODOS: Record<string, number> = { "7": 7, "30": 30, "90": 90 };

/**
 * Análise de atendimento: SLA de primeira resposta.
 *
 * O trabalho pesado (minutos úteis, primeira resposta humana, quem nunca foi
 * respondido) é do Postgres — `public.sla_conversations`.
 *
 * ⚠️ Esta rota devolve UMA LINHA POR CONVERSA, não os totais. Quem soma é
 * `lib/reports/sla.ts`, no navegador: os gráficos são clicáveis e recontar no
 * servidor a cada clique tiraria a resposta imediata do filtro. São 245 linhas
 * em 30 dias (~40 KB) — cabe folgado, e o dia em que não couber é o dia de
 * voltar a agregar aqui.
 *
 * ⚠️ A agregação por pessoa usa `conversations.assigned_to`, NÃO
 * `messages.created_by`: 86% das saídas estão com autor nulo, e foi por isso que
 * a aba Agentes mostrava "sem dados" para 8 dos 10 atendentes.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "não autenticado" }, { status: 401 });

  const { data: membership } = await supabase
    .from("location_members")
    .select("location_id, role, permissions, department_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return Response.json({ error: "empresa não encontrada" }, { status: 400 });

  // ⚠️ Esta rota era admin-only (copiado da aba Agentes). Passou a valer a
  // permissão do módulo **relatorios** porque o widget do painel precisa
  // aparecer para quem tem Relatórios liberado — pedido do Gabriel. Quem não
  // enxerga o módulo continua barrado AQUI, no servidor: a função é
  // `security definer`, então esconder o widget na tela não seria proteção.
  const { data: departments } = await supabase
    .from("departments")
    .select("id, permissions")
    .eq("location_id", membership.location_id);
  const podeVer = canAccess(
    "relatorios",
    {
      role: membership.role as "admin" | "user",
      permissions: membership.permissions ?? null,
      departmentId: membership.department_id ?? null,
    },
    (departments ?? []) as { id: string; permissions: Record<string, boolean> | null }[]
  );
  if (!podeVer) {
    return Response.json({ error: "sem acesso a Relatórios" }, { status: 403 });
  }

  const url = new URL(req.url);
  const dias = PERIODOS[url.searchParams.get("dias") ?? "30"] ?? 30;
  const meta = Number(url.searchParams.get("meta") ?? SLA_TARGET_MIN) || SLA_TARGET_MIN;
  const ate = new Date();
  const de = new Date(ate.getTime() - dias * 24 * 60 * 60 * 1000);

  /*
   * 🔴 **PAGINA.** Era uma chamada só, e o PostgREST corta em 1000 linhas SEM
   * ERRO E SEM AVISO — inclusive em RPC. Medido em 16/09/2026: 30 dias têm
   * **4.415 conversas** e a aba lia 1.000 — ou seja, **77% do atendimento ficava
   * de fora** de todos os KPIs, da mediana, do p90, da distribuição, do recorte
   * por responsável e da fila de ação. E a aba nasceu justamente para acabar com
   * uma métrica que mentia.
   *
   * ⚠️ A ordem termina em `conversation_id` (uuid único) porque a função ordena
   * só por `primeira_entrada`: sem desempate, duas páginas da mesma consulta
   * podem repetir uma conversa e PULAR outra — e a pulada some do relatório.
   */
  const [{ data: linhas, truncado, error }, { data: profiles }] = await Promise.all([
    paginarRpc(
      supabase,
      "sla_conversations",
      {
        p_location: membership.location_id,
        p_from: de.toISOString(),
        p_to: ate.toISOString(),
        p_target_min: meta,
      },
      [{ coluna: "primeira_entrada", desc: true }, { coluna: "conversation_id" }]
    ),
    supabase.from("profiles").select("id, name"),
  ]);
  if (error) {
    // O motivo VAI para a tela: `code` + `message`, a lição do 42804 de 03/09.
    const detalhe = [error.code, error.message].filter(Boolean).join(" · ");
    return Response.json({ error: `Não foi possível carregar: ${detalhe}` }, { status: 500 });
  }

  const rows = ((linhas ?? []) as any[]).map(
    (r): SlaLinha => ({
      conversation_id: r.conversation_id,
      contact_id: r.contact_id,
      contato: r.contato,
      canal: r.canal,
      assigned_to: r.assigned_to,
      primeira_entrada: r.primeira_entrada,
      primeira_resposta: r.primeira_resposta,
      espera_util_min: Number(r.espera_util_min),
      espera_corrida_min: Number(r.espera_corrida_min),
      respondida: r.respondida,
      dentro_da_meta: r.dentro_da_meta,
      fechada: r.fechada,
      respondida_por_bot: r.respondida_por_bot,
    })
  );

  // O eixo do gráfico é o do PERÍODO, não o dos dados: filtrando por um
  // responsável, os dias em que ele não atendeu têm que aparecer como zero em
  // vez de encurtar a linha.
  const dias_do_periodo = [...new Set(rows.map((r) => diaBr(r.primeira_entrada)))].sort();

  // Só a equipe que aparece — o seletor de responsável não precisa da empresa toda.
  const usados = new Set(rows.map((r) => r.assigned_to).filter(Boolean) as string[]);
  const nomes: Record<string, string> = {};
  for (const p of (profiles ?? []) as any[]) {
    if (usados.has(p.id)) nomes[p.id] = p.name;
  }

  return Response.json({
    periodo: { dias, de: de.toISOString(), ate: ate.toISOString() },
    meta,
    expediente: EXPEDIENTE,
    linhas: rows,
    nomes,
    dias_do_periodo,
    // ⚠️ Vai para a tela: relatório incompleto tem de DIZER que está incompleto.
    truncado,
  });
}
