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

/** Atualiza o card do contato no funil (nome + etapa); cria se não existir. */
async function syncCard(
  ctx: Ctx,
  node: { pipeline?: string; var: string; stageMap: Record<string, string> },
  vars: Record<string, any>,
) {
  const loc = ctx.channel.location_id;
  const { data: pipelines } = await ctx.db
    .from("pipelines")
    .select("id, name, position")
    .eq("location_id", loc)
    .order("position");
  if (!pipelines?.length) return;
  const pick =
    (node.pipeline
      ? pipelines.find((p: any) => normalize(p.name) === normalize(node.pipeline))
      : null) ?? pipelines[0];
  const { data: stages } = await ctx.db
    .from("stages")
    .select("id, name, position")
    .eq("pipeline_id", pick.id)
    .order("position");
  if (!stages?.length) return;

  const wantName = node.stageMap[normalize(vars[node.var])] ?? "";
  const target = wantName
    ? stages.find((s: any) => normalize(s.name).includes(normalize(wantName)))
    : null;
  const fullName = String(vars.name ?? "").trim();

  const { data: opp } = await ctx.db
    .from("opportunities")
    .select("id")
    .eq("contact_id", ctx.contact.id)
    .eq("pipeline_id", pick.id)
    .order("created_at")
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
      location_id: loc,
      contact_id: ctx.contact.id,
      pipeline_id: pick.id,
      stage_id: stage.id,
      name: fullName || "Lead",
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
      await ctx.db.from("conversations").update({ bot_paused: true }).eq("id", ctx.conversationId);
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
    flow = FLOWS[session.flow_key];
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
    flow = FLOWS[channel.bot_flow];
    if (!flow) return false;
    startNode = flow.start;
  }

  const ctx: Ctx = { db, channel, contact, conversationId, flowKey: flow.key };
  await advance(ctx, flow, startNode, vars);
  return true;
}
