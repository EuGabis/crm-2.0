/**
 * Motor do bot conversacional. Roda no webhook (service role) quando chega uma
 * mensagem: se a conversa está numa sessão de bot aguardando resposta, registra
 * a resposta e avança; se o número tem um fluxo e ainda não há sessão, inicia.
 * Best-effort — nunca deve quebrar o 200 do webhook.
 */
import { sendText, sendInteractiveList } from "@/lib/whatsapp/client";
import { toWhatsAppNumber } from "@/lib/whatsapp/phone";
import { chat } from "@/lib/ai/openai";
import { channelDepartmentId, distributeOne, assignLeadTo } from "@/lib/leads/distribution";
import { normalize, type BotFlow, type BotNode, type BotOption } from "./types";
import { triagemFlow } from "./flows/triagem";
import { secretariaFlow } from "./flows/secretaria";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FLOWS: Record<string, BotFlow> = {
  [triagemFlow.key]: triagemFlow,
  [secretariaFlow.key]: secretariaFlow,
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
  // first_name é o único nome opcional. Quando vazio (a pessoa recusou/não deu o
  // nome), remove o placeholder E a pontuação órfã ao redor pra não sair
  // "Perfeito, !" nem ", clique...".
  const firstName = vars.first_name != null ? String(vars.first_name).trim() : "";
  let out = text;
  if (!firstName) {
    out = out
      // "{{first_name}}, " (nome + pontuação logo depois)
      .replace(/\{\{\s*first_name\s*\}\}\s*[,:;–-]\s*/g, "")
      // ", {{first_name}}" (pontuação antes) ou o placeholder sozinho
      .replace(/\s*[,:;–-]?\s*\{\{\s*first_name\s*\}\}/g, "");
  }
  out = out.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (vars[k] != null ? String(vars[k]) : ""));
  out = out.replace(/\s+([,.!?;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
  // Se removemos o nome do começo, recapitaliza a 1ª letra.
  if (!firstName && out) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

const NOT_A_NAME = new Set([
  "oi", "ola", "opa", "eae", "bom dia", "boa tarde", "boa noite", "quero", "preco",
  "valor", "sim", "nao", "talvez", "sei la", "deus", "teste", "aviao", "curso",
]);

/** Heurística de nome (fallback sem IA): rejeita dígitos/frases-comando óbvias. */
function heuristicName(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned || /\d/.test(cleaned)) return null;
  if (cleaned.replace(/[^\p{L}]/gu, "").length < 2) return null;
  if (NOT_A_NAME.has(normalize(cleaned))) return null;
  return cleaned.split(" ").slice(0, 4).join(" ");
}

/**
 * Extrai/valida o nome da resposta do lead de forma inteligente. Usa a IA para
 * decidir se é um nome de pessoa real (rejeita "deus", "oi", número, xingamento)
 * e tira o nome de frases ("meu nome é Gabriel" → "Gabriel"). Sem IA/erro, cai na
 * heurística. Retorna o nome limpo ou null (=> reperguntar).
 */
async function extractName(text: string): Promise<string | null> {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  if (raw.replace(/[^\p{L}]/gu, "").length < 2) return null;
  if (!process.env.OPENAI_API_KEY) return heuristicName(raw);
  try {
    const { text: out } = await chat(
      [
        {
          role: "system",
          content:
            "Você extrai o NOME PRÓPRIO de uma pessoa a partir da resposta dela à " +
            "pergunta 'Qual é o seu nome?'. Responda APENAS o nome (com sobrenome se " +
            "houver), sem pontuação nem frases. Se a mensagem NÃO contiver um nome de " +
            "pessoa real (ex.: 'deus', 'oi', 'quero preço', xingamento, número, emoji), " +
            "responda exatamente: NONE.",
        },
        { role: "user", content: raw },
      ],
      { temperature: 0 },
    );
    const clean = out.trim().replace(/^["']+|["'.]+$/g, "").trim();
    if (!clean || /^none$/i.test(clean)) return null;
    return clean.split(/\s+/).slice(0, 4).join(" ");
  } catch {
    return heuristicName(raw);
  }
}

const REFUSAL = [
  "nao quero", "prefiro nao", "nao vou", "nao informar", "nao direi", "nao falo",
  "nao quero dizer", "nao quero falar", "nao respondo", "segredo", "sigilo",
  "pula", "pular", "proxima", "proximo", "skip", "deixa", "tanto faz", "next",
];

/** A pessoa recusou responder (segue pra próxima pergunta sem travar). */
function looksLikeRefusal(text: string): boolean {
  const t = normalize(text);
  if (!t) return false;
  if (t === "nao" || t === "n" || t === "no") return true;
  return REFUSAL.some((r) => t.includes(r));
}

/** Casa a resposta com uma opção: pelo clique (replyId) ou pelo texto digitado. */
function matchOption(options: BotOption[], replyId: string | null, text: string): BotOption | null {
  if (replyId) {
    const byId = options.find((o) => o.id === replyId);
    if (byId) return byId;
  }
  const t = normalize(text);
  if (!t) return null;
  return (
    options.find((o) => normalize(o.value ?? o.title) === t || normalize(o.title) === t) ?? null
  );
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
  options: { id: string; title: string; description?: string }[],
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

/** Registra um evento inline na conversa (pílula cinza) — histórico do que o bot fez. */
async function botLogEvent(ctx: Ctx, body: string) {
  await ctx.db.from("messages").insert({
    location_id: ctx.channel.location_id,
    conversation_id: ctx.conversationId,
    direction: "out",
    type: "event",
    channel: "whatsapp",
    body,
  });
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
  // Sempre recompõe pelo nome atual (vars.name ou o do contato) — assim um card
  // criado antes do nome ("E"/telefone) se conserta neste sync.
  const fullName = await cardName(ctx, vars);

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
    if (target) await botLogEvent(ctx, `Card movido para a etapa "${target.name}"`);
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
    await botLogEvent(ctx, `Card criado no funil na etapa "${stage.name}"`);
  }
}

/**
 * Distribui o lead quente por rodízio entre o pool do DEPARTAMENTO do número que
 * está online (lógica em @/lib/leads/distribution). Sem departamento vinculado ou
 * ninguém online → segura para o admin/varredura distribuir depois (Etapa B).
 */
async function distributeLead(ctx: Ctx, node: { pipeline?: string }) {
  const deptId = await channelDepartmentId(ctx.db, ctx.channel.id);
  if (deptId) {
    const user = await distributeOne(ctx.db, {
      locationId: ctx.channel.location_id,
      deptId,
      conversationId: ctx.conversationId,
      contactId: ctx.contact.id,
      pipelineName: node.pipeline,
    });
    if (user) return; // assignLeadTo já registrou o log da transferência
  }
  await ctx.db
    .from("conversations")
    .update({ awaiting_distribution: true })
    .eq("id", ctx.conversationId);
  await botLogEvent(ctx, "Nenhum atendente no rodízio — lead aguardando distribuição");
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
        // Disponibiliza {{first_name}} nas mensagens (chamar só pelo 1º nome) e o
        // nome completo para os nós de card (ensure_card/sync_card usam vars.name).
        vars.first_name = first;
        vars.last_name = last;
        vars.name = [first, last].filter(Boolean).join(" ").trim();
        // O card pode ter sido criado ANTES do nome (ficou "E"/telefone). Assim
        // que o bot descobre o nome, renomeia os cards ABERTOS do contato — é o
        // "filling" que faz o kanban refletir o lead na hora.
        if (vars.name) {
          await ctx.db
            .from("opportunities")
            .update({ name: vars.name })
            .eq("contact_id", ctx.contact.id)
            .eq("status", "open");
        }
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
    } else if (node.type === "distribute") {
      if (node.text) await botSend(ctx, render(node.text, vars));
      await distributeLead(ctx, node);
      await saveSession(ctx, nodeId, "concluido", vars);
      return;
    } else if (node.type === "handoff") {
      if (node.text) await botSend(ctx, render(node.text, vars));
      const to = node.to ?? "humano";
      if (to === "ia") {
        // IA principal responde as próximas mensagens (auto-reply).
        await botLogEvent(ctx, "Conversa transferida de Bot para o Agente de IA");
      } else if (to === "usuario" && node.assignTo) {
        // Atendente FIXO escolhido no fluxo: recebe a conversa + o card e o bot
        // pausa (mesma mecânica do rodízio, mas sem rodízio).
        await assignLeadTo(
          ctx.db,
          {
            conversationId: ctx.conversationId,
            contactId: ctx.contact.id,
            locationId: ctx.channel.location_id,
          },
          node.assignTo,
        );
      } else {
        // "humano" = passar pro atendimento: distribui por rodízio (escolhe UM
        // atendente e registra pra quem foi), igual ao nó "distribuir". Assim o
        // lead nunca fica sem dono e o log nomeia quem recebeu.
        await distributeLead(ctx, {});
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
        const opt = matchOption(node.options, args.replyId, args.text);
        if (!opt) {
          // Resposta fora da lista → repergunta (essencial pra qualificação).
          await botSend(ctx, "Para eu continuar, escolha uma das opções da lista, por favor. 🙂");
          await botSendList(ctx, render(node.text, vars), node.listButton, node.options);
          return true;
        }
        vars[node.var] = opt.value ?? opt.title;
      } else if (node.validate === "name") {
        const name = await extractName(args.text);
        if (name) {
          vars[node.var] = name;
          delete vars._nameAttempts;
        } else {
          const attempts = Number(vars._nameAttempts ?? 0) + 1;
          // 1ª falha "de interpretação" (sem recusa) → pede de novo, uma vez só.
          if (!looksLikeRefusal(args.text) && attempts < 2) {
            vars._nameAttempts = attempts;
            await botSend(
              ctx,
              'Não consegui identificar seu nome 😅. Pode me dizer só o seu nome? (ou responda "pular")',
            );
            await saveSession(ctx, session.node_id ?? null, "aguardando", vars);
            return true;
          }
          // Recusou ou já tentou demais → NÃO trava e NÃO chama por nome nenhum:
          // segue sem `first_name` (o render omite o nome e ajusta a pontuação).
          delete vars._nameAttempts;
          vars.first_name = "";
        }
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
    // Sessão NOVA: semeia o estado do contato para a Condição inicial poder
    // ramificar (ex.: já cadastrado?). `tem_cadastro` = "sim" se o contato tem a
    // etiqueta "cadastrado". `email` fica disponível nas mensagens ({{email}}).
    const { data: c } = await db
      .from("contacts")
      .select("tags, email")
      .eq("id", contact.id)
      .maybeSingle();
    const tags: string[] = Array.isArray(c?.tags) ? c!.tags : [];
    vars.tem_cadastro = tags.some((t) => normalize(t) === "cadastrado") ? "sim" : "nao";
    vars.email = c?.email ?? "";
  }

  const ctx: Ctx = { db, channel, contact, conversationId, flowKey: flow.key };
  await advance(ctx, flow, startNode, vars);
  return true;
}
