import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Meta de primeira resposta, em minutos ÚTEIS (decisão do Gabriel). */
export const SLA_TARGET_MIN = 15;
/** Expediente que o `private.business_minutes` aplica — só para exibir na tela. */
export const EXPEDIENTE = "seg a sex, 8h às 19h";

const PERIODOS: Record<string, number> = { "7": 7, "30": 30, "90": 90 };

function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ord = [...valores].sort((a, b) => a - b);
  const pos = (ord.length - 1) * p;
  const baixo = Math.floor(pos);
  const alto = Math.ceil(pos);
  if (baixo === alto) return ord[baixo];
  return ord[baixo] + (ord[alto] - ord[baixo]) * (pos - baixo);
}

/** Dia no fuso de São Paulo — para o gráfico bater com o relógio de quem olha. */
function brDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * Análise de atendimento: SLA de primeira resposta.
 *
 * O trabalho pesado (minutos úteis, primeira resposta humana, quem nunca foi
 * respondido) é do Postgres — `public.sla_conversations`. Aqui só se agrega o
 * que a tela desenha.
 *
 * ⚠️ A agregação por atendente usa `conversations.assigned_to`, NÃO
 * `messages.created_by`: 86% das saídas estão com autor nulo, e foi por isso que
 * a aba Agentes mostrava "sem dados" para 8 dos 10 atendentes. Conversa sem
 * responsável entra como uma linha própria ("Sem responsável") em vez de ser
 * descartada — são a maioria, e isso é justamente o que a gestão precisa ver.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "não autenticado" }, { status: 401 });

  const { data: membership } = await supabase
    .from("location_members")
    .select("location_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return Response.json({ error: "empresa não encontrada" }, { status: 400 });
  if (membership.role !== "admin") {
    return Response.json({ error: "apenas administradores" }, { status: 403 });
  }

  const url = new URL(req.url);
  const dias = PERIODOS[url.searchParams.get("dias") ?? "30"] ?? 30;
  const meta = Number(url.searchParams.get("meta") ?? SLA_TARGET_MIN) || SLA_TARGET_MIN;
  const ate = new Date();
  const de = new Date(ate.getTime() - dias * 24 * 60 * 60 * 1000);

  const [{ data: linhas, error }, { data: profiles }] = await Promise.all([
    supabase.rpc("sla_conversations", {
      p_location: membership.location_id,
      p_from: de.toISOString(),
      p_to: ate.toISOString(),
      p_target_min: meta,
    }),
    supabase.from("profiles").select("id, name"),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (linhas ?? []) as any[];
  const nomeDe = new Map((profiles ?? []).map((p: any) => [p.id, p.name]));

  const respondidas = rows.filter((r) => r.respondida);
  const esperas = respondidas.map((r) => Number(r.espera_util_min));
  const semResposta = rows.filter((r) => !r.respondida);
  // "Esperando agora" é o que dá ação HOJE: sem resposta e a conversa não foi
  // finalizada. Sem resposta numa conversa já fechada é histórico, não fila.
  const esperandoAgora = semResposta.filter((r) => !r.fechada);

  const kpis = {
    recebidas: rows.length,
    respondidas: respondidas.length,
    sem_resposta: semResposta.length,
    esperando_agora: esperandoAgora.length,
    dentro_da_meta: rows.filter((r) => r.dentro_da_meta).length,
    // A conta do cumprimento tem as NÃO RESPONDIDAS no denominador de
    // propósito: medir só entre as respondidas premiaria abandonar a conversa.
    pct_na_meta: rows.length
      ? Math.round((rows.filter((r) => r.dentro_da_meta).length / rows.length) * 1000) / 10
      : 0,
    mediana_min: percentil(esperas, 0.5),
    p90_min: percentil(esperas, 0.9),
    maior_espera_aberta: esperandoAgora.length
      ? Math.max(...esperandoAgora.map((r) => Number(r.espera_util_min)))
      : null,
    respondidas_so_pelo_bot: semResposta.filter((r) => r.respondida_por_bot).length,
  };

  // Faixas: mostram a FORMA da distribuição, que a mediana sozinha esconde.
  const FAIXAS: { rotulo: string; teste: (m: number) => boolean }[] = [
    { rotulo: "até 5 min", teste: (m) => m <= 5 },
    { rotulo: "5 a 15 min", teste: (m) => m > 5 && m <= 15 },
    { rotulo: "15 a 60 min", teste: (m) => m > 15 && m <= 60 },
    { rotulo: "1h a 4h", teste: (m) => m > 60 && m <= 240 },
    { rotulo: "mais de 4h", teste: (m) => m > 240 },
  ];
  const distribuicao = [
    ...FAIXAS.map((f) => ({
      faixa: f.rotulo,
      conversas: respondidas.filter((r) => f.teste(Number(r.espera_util_min))).length,
      violacao: f.rotulo !== "até 5 min" && f.rotulo !== "5 a 15 min",
    })),
    { faixa: "sem resposta", conversas: semResposta.length, violacao: true },
  ];

  // Por atendente (responsável da conversa).
  const porAgente = new Map<
    string,
    { nome: string; conversas: number; na_meta: number; esperas: number[]; sem_resposta: number }
  >();
  for (const r of rows) {
    const chave = r.assigned_to ?? "__sem__";
    const cur =
      porAgente.get(chave) ??
      {
        nome: r.assigned_to ? (nomeDe.get(r.assigned_to) ?? "Atendente") : "Sem responsável",
        conversas: 0,
        na_meta: 0,
        esperas: [] as number[],
        sem_resposta: 0,
      };
    cur.conversas += 1;
    if (r.dentro_da_meta) cur.na_meta += 1;
    if (r.respondida) cur.esperas.push(Number(r.espera_util_min));
    else cur.sem_resposta += 1;
    porAgente.set(chave, cur);
  }
  const agentes = [...porAgente.entries()]
    .map(([id, v]) => ({
      userId: id,
      nome: v.nome,
      conversas: v.conversas,
      na_meta: v.na_meta,
      pct_na_meta: v.conversas ? Math.round((v.na_meta / v.conversas) * 1000) / 10 : 0,
      mediana_min: percentil(v.esperas, 0.5),
      p90_min: percentil(v.esperas, 0.9),
      sem_resposta: v.sem_resposta,
    }))
    .sort((a, b) => b.conversas - a.conversas);

  // Por canal.
  const porCanal = new Map<string, { conversas: number; na_meta: number; esperas: number[] }>();
  for (const r of rows) {
    const cur = porCanal.get(r.canal) ?? { conversas: 0, na_meta: 0, esperas: [] as number[] };
    cur.conversas += 1;
    if (r.dentro_da_meta) cur.na_meta += 1;
    if (r.respondida) cur.esperas.push(Number(r.espera_util_min));
    porCanal.set(r.canal, cur);
  }
  const canais = [...porCanal.entries()]
    .map(([canal, v]) => ({
      canal,
      conversas: v.conversas,
      pct_na_meta: v.conversas ? Math.round((v.na_meta / v.conversas) * 1000) / 10 : 0,
      mediana_min: percentil(v.esperas, 0.5),
    }))
    .sort((a, b) => b.conversas - a.conversas);

  // Série diária: cumprimento ao longo do tempo.
  const porDia = new Map<string, { recebidas: number; na_meta: number; esperas: number[] }>();
  for (const r of rows) {
    const dia = brDay(r.primeira_entrada);
    const cur = porDia.get(dia) ?? { recebidas: 0, na_meta: 0, esperas: [] as number[] };
    cur.recebidas += 1;
    if (r.dentro_da_meta) cur.na_meta += 1;
    if (r.respondida) cur.esperas.push(Number(r.espera_util_min));
    porDia.set(dia, cur);
  }
  const serie = [...porDia.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, v]) => ({
      dia,
      rotulo: dia.slice(8, 10) + "/" + dia.slice(5, 7),
      recebidas: v.recebidas,
      pct_na_meta: v.recebidas ? Math.round((v.na_meta / v.recebidas) * 100) : 0,
      mediana_min: percentil(v.esperas, 0.5),
    }));

  // Casos que pedem ação: quem está esperando agora (mais antigo primeiro) e,
  // depois, as violações já respondidas. É a parte da tela que vira trabalho.
  const criticos = [
    ...esperandoAgora
      .sort((a, b) => Number(b.espera_util_min) - Number(a.espera_util_min))
      .map((r) => ({ ...r, situacao: "esperando" as const })),
    ...respondidas
      .filter((r) => !r.dentro_da_meta)
      .sort((a, b) => Number(b.espera_util_min) - Number(a.espera_util_min))
      .map((r) => ({ ...r, situacao: "violou" as const })),
  ]
    .slice(0, 50)
    .map((r) => ({
      conversationId: r.conversation_id,
      contactId: r.contact_id,
      contato: r.contato,
      canal: r.canal,
      responsavel: r.assigned_to ? (nomeDe.get(r.assigned_to) ?? "Atendente") : null,
      primeiraEntrada: r.primeira_entrada,
      esperaUtilMin: Number(r.espera_util_min),
      situacao: r.situacao,
      fechada: r.fechada,
      soBot: r.respondida_por_bot,
    }));

  return Response.json({
    periodo: { dias, de: de.toISOString(), ate: ate.toISOString() },
    meta,
    expediente: EXPEDIENTE,
    kpis,
    distribuicao,
    agentes,
    canais,
    serie,
    criticos,
  });
}
