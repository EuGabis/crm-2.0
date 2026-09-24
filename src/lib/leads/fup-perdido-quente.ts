import { createAdminClient } from "@/lib/supabase/admin";
import { listTemplates, sendTemplate } from "@/lib/whatsapp/client";
import { toWhatsAppNumber } from "@/lib/whatsapp/phone";
import { temperaturaDe } from "@/lib/leads/temperatura";

/**
 * FUP único do lead QUENTE que parou de responder (pedido de 2026-09-24).
 *
 * Regra do Gabriel: lead com nota QUENTE na triagem do bot, conversa aberta, o
 * VENDEDOR mandou a última mensagem e o cliente ficou **48 horas corridas** sem
 * responder → o card vai para **Comercial → Perdido Quente** e sai UMA mensagem,
 * o template `fup_unico_autom_tico` (convite para o grupo).
 *
 * ⚠️ É template, e não texto livre, por imposição da Meta: depois de 24h sem
 * mensagem do cliente a janela fechou e só template aprovado passa.
 *
 * ⚠️ "Único" é garantido pelo próprio FIO: a mensagem do template fica gravada
 * com `template_name`, e conversa que já tem uma (enviada OU falhada) não entra
 * de novo. Sem coluna nova — e sem o risco de uma marca num lugar e o envio em
 * outro discordarem.
 */

export const FUP_TEMPLATE = "fup_unico_autom_tico";
export const FUP_ESPERA_MS = 48 * 60 * 60 * 1000;
const FUNIL = "Comercial";
const FASE = "Perdido Quente";
/** Envios por tique: rede contra rajada (a cota diária do número é compartilhada). */
const POR_TIQUE = 20;
/** O tique também roda automações, agendadas e rodízio — não pode estourar o tempo. */
const ORCAMENTO_MS = 20_000;

/**
 * A regra de tempo, pura para ter teste.
 *
 * ⚠️ "O vendedor mandou mensagem" = a última SAÍDA HUMANA é posterior à última
 * entrada do cliente. Resposta do bot, nota interna e evento do fio não contam:
 * o bot responde em segundos, e contando com ele toda conversa pareceria
 * "vendedor falou por último".
 */
export function elegivelParaFup(p: {
  ultimaEntrada: string | null;
  ultimaSaidaHumana: string | null;
  jaEnviado: boolean;
  agora: number;
}): boolean {
  if (p.jaEnviado) return false;
  if (!p.ultimaSaidaHumana) return false;
  const saida = Date.parse(p.ultimaSaidaHumana);
  if (!Number.isFinite(saida)) return false;
  if (p.ultimaEntrada) {
    const entrada = Date.parse(p.ultimaEntrada);
    // Cliente respondeu depois do vendedor: a bola é nossa, não é silêncio dele.
    if (Number.isFinite(entrada) && entrada >= saida) return false;
  }
  return p.agora - saida >= FUP_ESPERA_MS;
}

/** Quantas variáveis `{{n}}` o corpo do template tem. */
export function variaveisDoCorpo(components: unknown[]): number {
  const body = (components ?? []).find(
    (c: any) => String(c?.type ?? "").toUpperCase() === "BODY",
  ) as any;
  const txt: string = body?.text ?? "";
  const nums = [...txt.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

type Resultado = { enviados: number; falhas: number; movidos: number };

export async function fupPerdidoQuente(): Promise<Resultado> {
  const db = createAdminClient();
  const inicio = Date.now();
  const res: Resultado = { enviados: 0, falhas: 0, movidos: 0 };

  /*
   * 1) Leads quentes. `bot_desfechos` é append-only e a conversa reaberta passa
   * pela triagem de novo, então vale o desfecho MAIS RECENTE de cada conversa —
   * o mesmo critério do selo da caixa. 30 dias bastam: quem está parado há mais
   * que isso já teria sido pego.
   */
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const vistos = new Set<string>();
  const quentes: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("bot_desfechos")
      .select("conversation_id, pontos, limiar, created_at")
      .not("conversation_id", "is", null)
      .not("pontos", "is", null)
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + 999);
    if (error) {
      console.warn("[fup] falha ao ler bot_desfechos:", error.message);
      return res;
    }
    for (const d of data ?? []) {
      if (vistos.has(d.conversation_id)) continue;
      vistos.add(d.conversation_id);
      if (temperaturaDe(d) === "quente") quentes.push(d.conversation_id);
    }
    if ((data?.length ?? 0) < 1000) break;
  }
  if (!quentes.length) return res;

  const templatesPorWaba = new Map<string, { language: string; vars: number } | null>();
  const funilPorLocation = new Map<string, { pipelineId: string; stageId: string } | null>();

  for (let i = 0; i < quentes.length; i += 200) {
    const lote = quentes.slice(i, i + 200);
    const { data: convs } = await db
      .from("conversations")
      .select("id, location_id, contact_id, channel_id")
      .in("id", lote)
      .is("closed_at", null)
      .is("archived_at", null)
      .not("assigned_to", "is", null)
      .not("channel_id", "is", null);

    for (const conv of convs ?? []) {
      if (res.enviados + res.falhas >= POR_TIQUE) return res;
      if (Date.now() - inicio > ORCAMENTO_MS) return res;

      const [entrada, saida, ja] = await Promise.all([
        db.from("messages").select("created_at").eq("conversation_id", conv.id)
          .eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("messages").select("created_at").eq("conversation_id", conv.id)
          .eq("direction", "out").neq("type", "event").not("internal", "is", true)
          .not("automated", "is", true)
          .order("created_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("messages").select("id", { count: "exact", head: true })
          .eq("conversation_id", conv.id).eq("template_name", FUP_TEMPLATE),
      ]);
      if (
        !elegivelParaFup({
          ultimaEntrada: entrada.data?.created_at ?? null,
          ultimaSaidaHumana: saida.data?.created_at ?? null,
          jaEnviado: (ja.count ?? 0) > 0,
          agora: Date.now(),
        })
      ) {
        continue;
      }

      // 2) Move o card ANTES de enviar: a regra é "48h sem resposta = perdido
      // quente", e ela vale mesmo que a Meta recuse o template.
      if (await moverParaPerdidoQuente(db, conv, funilPorLocation)) res.movidos++;

      // 3) O FUP.
      const r = await enviarFup(db, conv, templatesPorWaba);
      if (r) res.enviados++;
      else res.falhas++;
    }
  }
  return res;
}

async function funilDestino(db: any, locationId: string, cache: Map<string, any>) {
  if (cache.has(locationId)) return cache.get(locationId);
  const { data: pip } = await db.from("pipelines").select("id")
    .eq("location_id", locationId).eq("name", FUNIL).limit(1).maybeSingle();
  let alvo: { pipelineId: string; stageId: string } | null = null;
  if (pip) {
    const { data: st } = await db.from("stages").select("id")
      .eq("pipeline_id", pip.id).ilike("name", FASE).limit(1).maybeSingle();
    if (st) alvo = { pipelineId: pip.id, stageId: st.id };
  }
  /*
   * ⚠️ Nome configurado que não resolve é ERRO VISÍVEL, não palpite — a lição do
   * funil "Controle de Leads" (202609081500), em que a adivinhação jogou 365
   * cards no funil errado.
   */
  if (!alvo) console.warn(`[fup] funil "${FUNIL}" / fase "${FASE}" não encontrado em ${locationId}`);
  cache.set(locationId, alvo);
  return alvo;
}

async function moverParaPerdidoQuente(db: any, conv: any, cache: Map<string, any>) {
  const alvo = await funilDestino(db, conv.location_id, cache);
  if (!alvo) return false;
  /*
   * O card do contato no Comercial, se houver; senão o mais recente dele em
   * qualquer funil (é o do bot, no Controle de Leads) — que passa ao Comercial.
   * Sem card nenhum, não cria: card inventado pelo robô sem ninguém ter
   * trabalhado o lead sujaria o funil do time.
   */
  const { data: cards } = await db.from("opportunities")
    .select("id, pipeline_id, stage_id")
    .eq("contact_id", conv.contact_id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(20);
  if (!cards?.length) return false;
  const card = cards.find((c: any) => c.pipeline_id === alvo.pipelineId) ?? cards[0];
  if (card.pipeline_id === alvo.pipelineId && card.stage_id === alvo.stageId) return false;
  const { error } = await db.from("opportunities")
    .update({ pipeline_id: alvo.pipelineId, stage_id: alvo.stageId, status: "lost" })
    .eq("id", card.id);
  if (error) {
    console.warn(`[fup] não moveu o card ${card.id}: ${error.message}`);
    return false;
  }
  await db.from("messages").insert({
    location_id: conv.location_id,
    conversation_id: conv.id,
    direction: "out",
    type: "event",
    channel: "whatsapp",
    body: `Lead movido para ${FUNIL} → ${FASE} · 48h sem resposta do cliente`,
  });
  return true;
}

async function enviarFup(db: any, conv: any, cache: Map<string, any>): Promise<boolean> {
  const [{ data: canal }, { data: contato }] = await Promise.all([
    db.from("whatsapp_channels").select("id, phone_number_id, waba_id, active, daily_limit")
      .eq("id", conv.channel_id).maybeSingle(),
    db.from("contacts").select("first_name, phone").eq("id", conv.contact_id).maybeSingle(),
  ]);

  const registrar = async (patch: Record<string, unknown>) => {
    const { data: msg } = await db.from("messages").insert({
      location_id: conv.location_id,
      conversation_id: conv.id,
      direction: "out",
      type: "text",
      channel: "whatsapp",
      channel_id: conv.channel_id,
      body: `[template: ${FUP_TEMPLATE}]`,
      template_name: FUP_TEMPLATE,
      // Robô, não gente: não conta como atendimento no SLA e entra no filtro
      // "com automação" — mesma marca da resposta automática.
      automated: true,
      ...patch,
    }).select("created_at").single();
    return msg;
  };

  /*
   * ⚠️ Toda recusa GRAVA a mensagem como falha, com o motivo. É ela que torna o
   * FUP "único" (a conversa não entra de novo) e é ela que diz ao vendedor, no
   * fio, por que o convite não saiu — "falhou" sem motivo custou quinze rodadas
   * na investigação do áudio.
   */
  const falhar = async (motivo: string) => {
    await registrar({ status: "failed", error_detail: motivo, failed_at: new Date().toISOString() });
    console.warn(`[fup] conversa ${conv.id}: ${motivo}`);
    return false;
  };

  if (!canal || !canal.active) return falhar("Canal de WhatsApp inativo");
  const to = toWhatsAppNumber(contato?.phone);
  if (!to) return falhar("Contato sem telefone");

  if (canal.daily_limit) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const { count } = await db.from("messages").select("id", { count: "exact", head: true })
      .eq("channel_id", canal.id).eq("direction", "out").gte("created_at", hoje.toISOString());
    // Limite atingido NÃO grava falha: é transitório, e o próximo dia deve tentar.
    if ((count ?? 0) >= canal.daily_limit) return false;
  }

  if (!cache.has(canal.waba_id)) {
    try {
      const tpls = await listTemplates(canal.waba_id);
      const t = tpls.find((x) => x.name === FUP_TEMPLATE);
      cache.set(canal.waba_id, t ? { language: t.language, vars: variaveisDoCorpo(t.components) } : null);
    } catch (e) {
      // Falha ao LISTAR é transitória (rede, token) — não queima o FUP único.
      console.warn("[fup] não consegui listar templates:", e instanceof Error ? e.message : e);
      return false;
    }
  }
  const tpl = cache.get(canal.waba_id);
  if (!tpl) return falhar(`Template "${FUP_TEMPLATE}" não está aprovado neste número`);

  const nome = (contato?.first_name ?? "").trim().split(/\s+/)[0] || "tudo bem";
  const params = Array.from({ length: tpl.vars }, () => ({ type: "text", text: nome }));
  const components = params.length ? [{ type: "body", parameters: params }] : undefined;

  try {
    const r: any = await sendTemplate(canal.phone_number_id, to, FUP_TEMPLATE, tpl.language, components);
    const msg = await registrar({ status: "sent", wa_message_id: r?.messages?.[0]?.id ?? null });
    if (msg?.created_at) {
      await db.from("conversations")
        .update({ last_message_at: msg.created_at, last_message_preview: "📨 FUP: convite para o grupo" })
        .eq("id", conv.id);
    }
    return true;
  } catch (e) {
    return falhar(e instanceof Error ? e.message : "Falha na Cloud API");
  }
}
