/**
 * Motor do bot conversacional. Roda no webhook (service role) quando chega uma
 * mensagem: se a conversa está numa sessão de bot aguardando resposta, registra
 * a resposta e avança; se o número tem um fluxo e ainda não há sessão, inicia.
 * Best-effort — nunca deve quebrar o 200 do webhook.
 */
import { sendText, sendInteractiveList } from "@/lib/whatsapp/client";
import { toWhatsAppNumber } from "@/lib/whatsapp/phone";
import { normalize, type BotFlow, type BotNode } from "./types";
import { triagemFlow } from "./flows/triagem";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FLOWS: Record<string, BotFlow> = {
  [triagemFlow.key]: triagemFlow,
};

/** Carrega a definição editável do banco (bot_flows); cai no fluxo embutido. */
async function getFlow(
  db: any,
  locationId: string,
  key: string | null | undefined,
): Promise<BotFlow | undefined> {
  if (!key) return undefined;
  try {
    const { data } = await db
      .from("bot_flows")
      .select("definition")
      .eq("location_id", locationId)
      .eq("key", key)
      .maybeSingle();
    if (data?.definition?.nodes && data.definition.start) {
      return data.definition as BotFlow;
    }
  } catch {
    // banco indisponível ou tabela ausente → usa o padrão em código
  }
  return FLOWS[key];
}

interface Ctx {
  db: any;
  channel: { id: string; phone_number_id: string; location_id: string };
  contact: { id: string; phone: string };
  conversationId: string;
  flowKey: string;
}

function render(text: string, vars: Record<string, any>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (vars[k] != null ? String(vars[k]) : ""));
}

/** Grava a mensagem de saída do bot no inbox + atualiza a conversa. */
async function recordOut(ctx: Ctx, body: string, waId: string | null) {
  const nowIso = new Date().toISOString();
  await ctx.db.from("messages").insert({
    location_id: ctx.channel.location_id,
    conversation_id: ctx.conversationId,
    direction: "out",
    type: "text",
    channel: "whatsapp",
    body,
    channel_id: ctx.channel.id,
    wa_message_id: waId,
    status: waId ? "sent" : "failed",
    automated: true,
  });
  await ctx.db
    .from("conversations")
    .update({ last_message_at: nowIso, last_message_preview: body })
    .eq("id", ctx.conversationId);
}

async function botSend(ctx: Ctx, text: string) {
  const to = toWhatsAppNumber(ctx.contact.phone);
  let waId: string | null = null;
  try {
    const resp: any = await sendText(ctx.channel.phone_number_id, to, text);
    waId = resp?.messages?.[0]?.id ?? null;
  } catch {
    // falha de envio não pode derrubar o bot
  }
  await recordOut(ctx, text, waId);
}

async function botSendList(
  ctx: Ctx,
  text: string,
  buttonLabel: string | undefined,
  options: { id: string; title: string }[],
) {
  let waId: string | null = null;
  try {
    const resp: any = await sendInteractiveList(
      ctx.channel.phone_number_id,
      toWhatsAppNumber(ctx.contact.phone),
      text,
      buttonLabel ?? "Ver opções",
      options,
    );
    waId = resp?.messages?.[0]?.id ?? null;
  } catch {
    // idem
  }
  // No inbox mostra a pergunta (as opções são clicáveis no WhatsApp do cliente).
  await recordOut(ctx, text, waId);
}

async function saveSession(
  ctx: Ctx,
  nodeId: string | null,
  status: "ativo" | "aguardando" | "concluido",
  vars: Record<string, any>,
) {
  await ctx.db.from("bot_sessions").upsert(
    {
      conversation_id: ctx.conversationId,
      location_id: ctx.channel.location_id,
      contact_id: ctx.contact.id,
      flow_key: ctx.flowKey,
      node_id: nodeId,
      status,
      vars,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "conversation_id" },
  );
}

/** Status da oportunidade deduzido do nome da etapa (igual ao pipeline.ts). */
function statusForStageName(name: string): "open" | "won" | "lost" {
  const n = (name ?? "").toUpperCase();
  if (n.includes("PERDID")) return "lost";
  if (n.includes("ASSINOU") || n.includes("GANHO") || n.includes("GANHA")) return "won";
  return "open";
}

/** Carrega os funis + todas as etapas da empresa (uma vez por passo de card). */
async function loadPipelines(ctx: Ctx) {
  const loc = ctx.channel.location_id;
  const { data: pipelines } = await ctx.db
    .from("pipelines")
    .select("id, name, position")
    .eq("location_id", loc)
    .order("position");
  const { data: allStages } = await ctx.db
    .from("stages")
    .select("id, name, position, pipeline_id")
    .in("pipeline_id", (pipelines ?? []).map((p: any) => p.id))
    .order("position");
  return { pipelines: pipelines ?? [], allStages: allStages ?? [] };
}

const stagesOf = (allStages: any[], pid: string) =>
  allStages.filter((s: any) => s.pipeline_id === pid);
const stageByName = (stages: any[], name: string) =>
  name ? stages.find((s: any) => normalize(s.name).includes(normalize(name))) : null;

/**
 * Escolhe o FUNIL DE LEADS certo — o contato pode ter card em vários funis.
 * 1) por nome configurado; 2) senão, o funil que mais contém as etapas esperadas
 * (ex.: QUENTE/NOVO LEAD); 3) fallback no primeiro. Evita mexer no funil errado.
 */
function resolvePipeline(pipelines: any[], allStages: any[], name: string | undefined, hints: string[]) {
  if (name) {
    const byName = pipelines.find((p: any) => normalize(p.name).includes(normalize(name)));
    if (byName) return byName;
  }
  let best: any = null;
  let bestScore = -1;
  for (const p of pipelines) {
    const names = stagesOf(allStages, p.id).map((s: any) => normalize(s.name));
    const score = hints.reduce(
      (acc, h) => acc + (h && names.some((n: string) => n.includes(normalize(h))) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore > 0 ? best : pipelines[0];
}

/** Nome do card: usa o que o lead digitou; senão o nome atual do contato. */
async function cardName(ctx: Ctx, vars: Record<string, any>): Promise<string> {
  const v = String(vars.name ?? "").trim();
  if (v) return v;
  const { data: c } = await ctx.db
    .from("contacts")
    .select("first_name, last_name")
    .eq("id", ctx.contact.id)
    .maybeSingle();
  return [c?.first_name, c?.last_name].filter(Boolean).join(" ").trim() || "Lead";
}

/** Garante o card no funil de leads (cria em NOVO LEAD se não existir; senão nada). */
async function ensureCard(
  ctx: Ctx,
  node: { pipeline?: string; stage: string },
  vars: Record<string, any>,
) {
  const { pipelines, allStages } = await loadPipelines(ctx);
  if (!pipelines.length) return;
  const pick = resolvePipeline(pipelines, allStages, node.pipeline, [node.stage]);
  const stages = stagesOf(allStages, pick.id);
  if (!stages.length) return;

  const { data: existing } = await ctx.db
    .from("opportunities")
    .select("id")
    .eq("contact_id", ctx.contact.id)
    .eq("pipeline_id", pick.id)
    .limit(1)
    .maybeSingle();
  if (existing) return; // já tem card nesse funil → segue com o existente

  const entry = stageByName(stages, node.stage) ?? stages[0];
  await ctx.db.from("opportunities").insert({
    location_id: ctx.channel.location_id,
    contact_id: ctx.contact.id,
    pipeline_id: pick.id,
    stage_id: entry.id,
    name: await cardName(ctx, vars),
    source: "Bot",
    value: 0,
    status: statusForStageName(entry.name),
  });
}

/** Move o card do contato no funil de leads: atualiza nome + etapa (quente/frio). */
async function syncCard(
  ctx: Ctx,
  node: { pipeline?: string; var: string; stageMap: Record<string, string> },
  vars: Record<string, any>,
) {
  const { pipelines, allStages } = await loadPipelines(ctx);
  if (!pipelines.length) return;
  const pick = resolvePipeline(pipelines, allStages, node.pipeline, Object.values(node.stageMap));
  const stages = stagesOf(allStages, pick.id);
  if (!stages.length) return;

  const wantName = node.stageMap[normalize(vars[node.var])] ?? "";
  const target = stageByName(stages, wantName);
  const fullName = String(vars.name ?? "").trim();

  // Card do contato NESTE funil de leads (o que a pessoa vê no kanban de leads).
  const { data: opp } = await ctx.db
    .from("opportunities")
    .select("id")
    .eq("contact_id", ctx.contact.id)
    .eq("pipeline_id", pick.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (opp) {
    const patch: any = {};
    if (fullName) patch.name = fullName;
    if (target) {
      patch.stage_id = target.id;
      patch.status = statusForStageName(target.name);
    }
    if (Object.keys(patch).length) {
      await ctx.db.from("opportunities").update(patch).eq("id", opp.id);
    }
  } else {
    const stage = target ?? stages[0];
    await ctx.db.from("opportunities").insert({
      location_id: ctx.channel.location_id,
      contact_id: ctx.contact.id,
      pipeline_id: pick.id,
      stage_id: stage.id,
      name: fullName || (await cardName(ctx, vars)),
      source: "Bot",
      value: 0,
      status: statusForStageName(stage.name),
    });
  }
}

/** Caminha pelos nós até uma pergunta (para e espera) ou o fim. */
async function advance(
  ctx: Ctx,
  flow: BotFlow,
  startNode: string | null,
  vars: Record<string, any>,
) {
  let nodeId: string | null = startNode ?? flow.start;
  for (let i = 0; i < 50 && nodeId; i++) {
    const node = flow.nodes[nodeId] as BotNode | undefined;
    if (!node) break;

    if (node.type === "message") {
      await botSend(ctx, render(node.text, vars));
      nodeId = node.next;
    } else if (node.type === "set_contact") {
      const val = vars[node.fromVar];
      if (val != null && String(val).trim()) {
        await ctx.db.from("contacts").update({ [node.field]: String(val).trim() }).eq("id", ctx.contact.id);
      }
      nodeId = node.next;
    } else if (node.type === "set_name") {
      // 1ª palavra = nome, resto = sobrenome (não estraga o sobrenome existente).
      const full = String(vars[node.fromVar] ?? "").trim().replace(/\s+/g, " ");
      if (full) {
        const parts = full.split(" ");
        const first = parts.shift() ?? full;
        const last = parts.join(" ");
        await ctx.db
          .from("contacts")
          .update({ first_name: first, last_name: last })
          .eq("id", ctx.contact.id);
      }
      nodeId = node.next;
    } else if (node.type === "score") {
      let sum = 0;
      for (const [v, table] of Object.entries(node.weights)) {
        sum += table[normalize(vars[v])] ?? 0;
      }
      vars[node.var] = sum >= node.threshold ? node.hotValue : node.coldValue;
      nodeId = node.next;
    } else if (node.type === "ensure_card") {
      await ensureCard(ctx, node, vars);
      nodeId = node.next;
    } else if (node.type === "sync_card") {
      await syncCard(ctx, node, vars);
      nodeId = node.next;
    } else if (node.type === "condition") {
      nodeId = normalize(vars[node.var]) === normalize(node.equals) ? node.ifTrue : node.ifFalse;
    } else if (node.type === "ask") {
      if (node.options?.length) {
        await botSendList(ctx, render(node.text, vars), node.listButton, node.options);
      } else {
        await botSend(ctx, render(node.text, vars));
      }
      await saveSession(ctx, nodeId, "aguardando", vars);
      return;
    } else if (node.type === "handoff") {
      if (node.text) await botSend(ctx, render(node.text, vars));
      // "humano": pausa o bot (atendente assume). "ia": não pausa — o agente de IA
      // principal responde as próximas mensagens (auto-reply).
      if ((node.to ?? "humano") === "humano") {
        await ctx.db.from("conversations").update({ bot_paused: true }).eq("id", ctx.conversationId);
      }
      await saveSession(ctx, nodeId, "concluido", vars);
      return;
    } else if (node.type === "end") {
      if (node.text) await botSend(ctx, render(node.text, vars));
      await saveSession(ctx, nodeId, "concluido", vars);
      return;
    } else {
      break;
    }
  }
  await saveSession(ctx, nodeId, nodeId ? "ativo" : "concluido", vars);
}

/**
 * Ponto de entrada chamado pelo webhook. Retorna true se o bot tratou a mensagem
 * (o webhook então NÃO chama o auto-responder de IA).
 */
export async function maybeRunBot(
  db: any,
  args: {
    channel: { id: string; phone_number_id: string; location_id: string; bot_flow: string | null };
    conversationId: string;
    contact: { id: string; phone: string };
    text: string;
    replyId: string | null;
  },
): Promise<boolean> {
  const { channel, conversationId, contact } = args;

  // Humano assumiu → bot fica quieto.
  const { data: conv } = await db
    .from("conversations")
    .select("bot_paused")
    .eq("id", conversationId)
    .maybeSingle();
  if (conv?.bot_paused) return false;

  const { data: session } = await db
    .from("bot_sessions")
    .select("*")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  let flow: BotFlow | undefined;
  let vars: Record<string, any> = {};
  let startNode: string | null;

  if (session) {
    flow = await getFlow(db, channel.location_id, session.flow_key);
    if (!flow || session.status === "concluido") return false;
    vars = session.vars ?? {};
    const node = flow.nodes[session.node_id ?? ""] as any;
    if (session.status === "aguardando" && node?.type === "ask") {
      const ctx: Ctx = {
        db,
        channel,
        contact,
        conversationId,
        flowKey: flow.key,
      };
      if (node.options?.length) {
        const opt = node.options.find((o: any) => o.id === args.replyId);
        if (!opt) {
          // Não clicou numa opção válida → pede pra usar as opções e reenvia.
          await botSend(ctx, "Por favor, selecione uma das opções enviadas.");
          await botSendList(ctx, render(node.text, vars), node.listButton, node.options);
          return true;
        }
        vars[node.var] = opt.value ?? opt.title;
      } else {
        vars[node.var] = args.text;
      }
      startNode = node.next;
    } else {
      startNode = session.node_id ?? flow.start;
    }
  } else {
    if (!channel.bot_flow) return false;
    flow = await getFlow(db, channel.location_id, channel.bot_flow);
    if (!flow) return false;
    startNode = flow.start;
  }

  const ctx: Ctx = { db, channel, contact, conversationId, flowKey: flow.key };
  await advance(ctx, flow, startNode, vars);
  return true;
}
