import { createClient } from "@/lib/supabase/server";
import { canAccess } from "@/lib/auth/module-access";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

/** Fuso da operação. A Vercel roda em UTC — nunca use o relógio do processo. */
const FUSO = "America/Sao_Paulo";

/**
 * "AAAA-MM-DD" no fuso da operação.
 *
 * ⚠️ `toISOString().slice(0, 10)` daria o dia em **UTC**, e às 21h de Brasília o
 * servidor já está no dia seguinte: o período pediria um dia a mais na frente e
 * perderia o dia corrente no fim. `en-CA` é o atalho para o formato ISO.
 */
function diaEm(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(d);
}

/** Lista de dias "AAAA-MM-DD" de `de` até `ate`, inclusive. */
function enumerarDias(de: string, ate: string): string[] {
  const out: string[] = [];
  // Meio-dia UTC para o passo de 24h nunca cair em cima de uma virada de dia
  // (nem de horário de verão) e pular ou repetir uma data.
  const cursor = new Date(`${de}T12:00:00Z`);
  const fim = new Date(`${ate}T12:00:00Z`);
  while (cursor <= fim) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

interface Lead {
  dia: string;
  hora: number;
  /** Desfecho do bot. `null` = não concluiu a triagem. */
  resultado: string | null;
  pontos: number | null;
}

/** Um balde de agregação — por dia ou por hora, a conta é a mesma. */
interface Balde {
  entraram: number;
  concluiram: number;
  desfechos: Record<string, number>;
  somaPontos: number;
  comPontos: number;
}

function balde(): Balde {
  return { entraram: 0, concluiram: 0, desfechos: {}, somaPontos: 0, comPontos: 0 };
}

function somar(b: Balde, l: Lead): void {
  b.entraram++;
  if (l.resultado) {
    b.concluiram++;
    b.desfechos[l.resultado] = (b.desfechos[l.resultado] ?? 0) + 1;
  }
  if (l.pontos != null) {
    b.somaPontos += l.pontos;
    b.comPontos++;
  }
}

function fechar(b: Balde) {
  return {
    entraram: b.entraram,
    concluiram: b.concluiram,
    desfechos: b.desfechos,
    // ⚠️ Sem nenhum lead pontuado a média é NULL, não zero: zero afirmaria que a
    // média é zero, quando não houve o que medir.
    pontosMedio: b.comPontos > 0 ? Math.round((b.somaPontos / b.comPontos) * 10) / 10 : null,
  };
}

/**
 * Leads que entraram e o que o bot fez com eles — por DIA e por HORA.
 *
 * ⚠️ **Serve QUALQUER fluxo, porque os bots não têm o mesmo tipo de desfecho.**
 * A Triagem Comercial classifica em quente/frio pelo nó `score` (soma ≥ 9); a
 * Triagem Secretaria não tem nota nenhuma — o cliente escolhe um ASSUNTO
 * ("Documentos/Prova Sub", "Imersão Pres. MMA", "Outros") e cada ramo vai para
 * um atendente. Por isso o desfecho volta em **mapa** (`{"docs": 4}`) e não em
 * colunas fixas: coluna fixa só serve a um bot.
 *
 * ⚠️ **A agregação mora AQUI e o SQL devolve uma linha por lead** (`triagem_leads`,
 * migração 202609041015) — mesmo desenho de `sla_conversations` (0079). O motivo
 * não é preferência: com uma função agregando por dia e outra por hora, o
 * predicado de "entrou" existiria em dois lugares, e os dois gráficos da MESMA
 * tela poderiam se contradizer. Medido: 339 leads em 30 dias, ~20 KB. O dia em
 * que isso virar dezenas de milhares é o dia de voltar a agregar no servidor.
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

  const agora = new Date();
  const ate = diaEm(agora);
  // O passo é dado em cima da DATA LOCAL já resolvida, não no relógio do
  // processo: `agora - N dias` em UTC pode cair no dia anterior em São Paulo.
  const inicio = new Date(`${ate}T12:00:00Z`);
  inicio.setUTCDate(inicio.getUTCDate() - (dias - 1));
  const de = inicio.toISOString().slice(0, 10);

  const { data, error } = await supabase.rpc("triagem_leads", {
    p_location: membership.location_id,
    p_de: de,
    p_ate: ate,
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

  const leads: Lead[] = (data ?? []).map((r: any) => ({
    dia: r.dia as string,
    hora: Number(r.hora ?? 0),
    resultado: (r.resultado as string | null) ?? null,
    pontos: r.pontos == null ? null : Number(r.pontos),
  }));

  /*
   * ⚠️ Os baldes nascem TODOS antes de somar: dia sem lead nenhum e hora sem
   * lead nenhum precisam aparecer como zero. Sem isso o gráfico diário
   * encurtaria e o de horas ficaria com buracos — e no dado real a hora 2 tem
   * zero lead, então o buraco não é hipotético.
   */
  const porDia = new Map<string, Balde>(enumerarDias(de, ate).map((d) => [d, balde()]));
  const porHora = Array.from({ length: 24 }, () => balde());
  const total = balde();

  for (const l of leads) {
    somar(total, l);
    // A hora vem do banco já no fuso da operação; o clamp é só contra dado
    // torto, para um índice fora da faixa não derrubar a rota.
    if (l.hora >= 0 && l.hora <= 23) somar(porHora[l.hora], l);
    const b = porDia.get(l.dia);
    // O dia veio do MESMO período pedido à função, então ele existe no mapa. O
    // guard é rede: se um dia de borda escapar, ele entra em vez de sumir.
    if (b) somar(b, l);
    else porDia.set(l.dia, (() => { const n = balde(); somar(n, l); return n; })());
  }

  // Mais recente primeiro: é a ordem que a tabela da tela usa.
  const linhas = [...porDia.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([dia, b]) => ({ dia, ...fechar(b) }));

  const horas = porHora.map((b, hora) => ({ hora, ...fechar(b) }));

  return Response.json({
    linhas,
    horas,
    total: fechar(total),
    dias,
    flow,
    periodo: { de, ate },
  });
}
