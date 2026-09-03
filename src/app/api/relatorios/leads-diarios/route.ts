import { createClient } from "@/lib/supabase/server";
import { canAccess } from "@/lib/auth/module-access";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

/**
 * Leads que entraram por dia e o que o bot fez com eles.
 *
 * ⚠️ **Serve QUALQUER fluxo, porque os bots não têm o mesmo tipo de desfecho.**
 * A Triagem Comercial classifica em quente/frio pelo nó `score` (soma ≥ 9); a
 * Triagem Secretaria não tem nota nenhuma — o cliente escolhe um ASSUNTO
 * ("Documentos/Prova Sub", "Imersão Pres. MMA", "Outros") e cada ramo vai para
 * um atendente. Por isso o desfecho volta em **mapa** (`{"docs": 4}`) e não em
 * colunas fixas: coluna fixa só serve a um bot.
 *
 * ⚠️ **Lê `bot_desfechos`, não `bot_sessions`** — ver a migração 202609031955.
 * Sessão é apagada quando a conversa finalizada reabre, e um relatório diário
 * lido de lá encolheria o passado.
 *
 * ⚠️ **Não é admin-only**: vale a permissão do módulo `relatorios`, como a aba de
 * Atendimento. E a checagem que importa é ESTA, no servidor — a função é
 * `security definer`, então esconder a aba na tela não seria proteção.
 */
export async function GET(request: Request) {
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

  const { data: deps } = await supabase
    .from("departments")
    .select("id, name, permissions")
    .eq("location_id", membership.location_id);

  if (!canAccess("relatorios", membership as any, (deps ?? []) as any)) {
    return Response.json({ error: "sem acesso a relatórios" }, { status: 403 });
  }

  const url = new URL(request.url);
  const dias = Math.min(180, Math.max(1, Number(url.searchParams.get("dias")) || 30));
  // `flow` vazio = todos os fluxos. A tela sempre manda um (o seletor de fluxo).
  const flow = url.searchParams.get("flow") || null;

  const hoje = new Date();
  const de = new Date(hoje);
  de.setDate(de.getDate() - (dias - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const { data, error } = await supabase.rpc("relatorio_triagem_diaria", {
    p_location: membership.location_id,
    p_de: iso(de),
    p_ate: iso(hoje),
    p_flow: flow,
  });
  if (error) {
    /*
     * ⚠️ O motivo VAI para a tela. Uma rota que respondia só "não foi possível
     * carregar" custou uma rodada inteira em 03/09 — a função existia, os grants
     * estavam certos, e o `42804` (tipo divergente no `returns table`) só
     * apareceu depois de o `code` ser exposto.
     */
    const detalhe = [error.code, error.message].filter(Boolean).join(" · ");
    console.error(`[relatorios/leads-diarios] rpc falhou: ${detalhe}`);
    return Response.json({ error: `Não foi possível carregar: ${detalhe}` }, { status: 500 });
  }

  const linhas = (data ?? []).map((r: any) => ({
    dia: r.dia as string,
    entraram: Number(r.entraram ?? 0),
    concluiram: Number(r.concluiram ?? 0),
    /** Mapa desfecho → quantidade. As chaves são as do fluxo, não do CRM. */
    desfechos: (r.desfechos ?? {}) as Record<string, number>,
    // numeric do PostgREST chega como string; sem o Number() a média viraria
    // concatenação na tela.
    pontosMedio: r.pontos_medio == null ? null : Number(r.pontos_medio),
  }));

  /*
   * Os totais são somados AQUI e não no SQL: a chave de desfecho é dinâmica (o
   * fluxo decide quais existem), e um segundo `group by` na função só para o
   * total repetiria a regra em dois lugares para divergirem.
   */
  const desfechos: Record<string, number> = {};
  let entraram = 0;
  let concluiram = 0;
  for (const l of linhas as { entraram: number; concluiram: number; desfechos: Record<string, number> }[]) {
    entraram += l.entraram;
    concluiram += l.concluiram;
    for (const [k, v] of Object.entries(l.desfechos)) desfechos[k] = (desfechos[k] ?? 0) + v;
  }

  return Response.json({ linhas, total: { entraram, concluiram, desfechos }, dias, flow });
}
