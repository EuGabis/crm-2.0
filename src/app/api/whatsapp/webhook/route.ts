import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdvance } from "@/lib/whatsapp/status-rank";
import { maybeAutoReply } from "@/lib/whatsapp/auto-reply";
import { getMediaInfo, downloadMedia } from "@/lib/whatsapp/client";
import { maybeRunBot } from "@/lib/bot/engine";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Nunca cachear: cada chamada é um evento novo. */
export const dynamic = "force-dynamic";

/**
 * Webhook do WhatsApp (Meta Cloud API). Fora do matcher do proxy — chamada
 * máquina-a-máquina, sem sessão. GET faz o handshake da Meta; POST valida a
 * assinatura (HMAC do corpo cru com WHATSAPP_APP_SECRET) e grava nas Conversas
 * com a service role (aparece no inbox pelo Realtime já publicado).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const verify = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && verify && verify === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

function validSignature(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("assinatura inválida", { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("payload inválido", { status: 400 });
  }

  let db;
  try {
    db = createAdminClient();
  } catch {
    return Response.json({ error: "webhook sem credenciais no servidor" }, { status: 503 });
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const { data: channel } = await db
        .from("whatsapp_channels")
        .select("id, location_id, daily_limit, phone_number_id, bot_flow")
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();
      if (!channel) continue; // número não cadastrado aqui — ignora

      for (const m of value.messages ?? []) {
        try {
          await handleIncoming(db, channel, value, m);
        } catch {
          // best-effort: uma mensagem malformada/sem suporte nunca derruba o webhook.
        }
      }
      for (const st of value.statuses ?? []) {
        if (st?.id && st?.status) {
          try {
            await applyStatus(db, st);
          } catch {
            // best-effort: idem para status.
          }
        }
      }
    }
  }

  return Response.json({ ok: true });
}

/**
 * Prévia da conversa para mídia recebida.
 *
 * ⚠️ O webhook gravava `last_message_preview: body` direto, e `body` é a LEGENDA
 * — vazia na maioria das fotos. Resultado: a linha da conversa ficava em branco
 * na lista (30 conversas neste banco). Aqui a legenda é usada quando existe e,
 * quando não, entra o rótulo com ícone — a MESMA convenção que o composer já usa
 * no envio (`📷 Imagem`, `🎤 Áudio`...), para receber e enviar não descreverem a
 * mesma coisa de dois jeitos na mesma lista.
 */
function previaDeMidia(msgType: string, legenda: string, nomeArquivo?: string): string {
  const texto = (legenda ?? "").trim();
  if (texto) {
    return msgType === "image"
      ? `📷 ${texto}`
      : msgType === "video"
        ? `🎬 ${texto}`
        : msgType === "file"
          ? `📎 ${texto}`
          : texto;
  }
  if (msgType === "image") return "📷 Imagem";
  if (msgType === "video") return "🎬 Vídeo";
  if (msgType === "audio") return "🎤 Áudio";
  if (msgType === "file") return `📎 ${nomeArquivo || "Arquivo"}`;
  return texto;
}

async function handleIncoming(db: any, channel: any, value: any, m: any) {
  const waId = m.id;
  if (!waId) return;

  // idempotência: mesma mensagem chega mais de uma vez
  const { data: dup } = await db
    .from("messages")
    .select("id")
    .eq("wa_message_id", waId)
    .maybeSingle();
  if (dup) return;

  const phone: string = m.from ?? "";
  if (!phone) return;
  const profileName: string = value?.contacts?.[0]?.profile?.name || phone;
  const nowIso = new Date().toISOString();

  // contato por telefone dentro da empresa — busca NORMALIZADA (0047): casa
  // "(21) 99717-0842", "5521997170842", etc. como o mesmo número. Antes era `eq`
  // por texto exato, o que criava um contato novo a cada formato diferente.
  const { data: foundId } = await db.rpc("find_contact_by_phone", {
    p_location: channel.location_id,
    p_phone: phone,
  });
  let contact: { id: string } | null = foundId ? { id: foundId as string } : null;
  if (!contact) {
    const parts = profileName.trim().split(/\s+/);
    const first = parts.shift() || phone;
    const { data: created } = await db
      .from("contacts")
      .insert({
        location_id: channel.location_id,
        first_name: first,
        last_name: parts.join(" "),
        phone,
        last_activity_channel: "whatsapp",
        last_activity_at: nowIso,
      })
      .select("id")
      .single();
    contact = created;
  }
  if (!contact) return;

  /*
   * ⚠️ **REAÇÃO NÃO É MENSAGEM — sai daqui antes de virar linha em `messages`.**
   *
   * Sem este desvio a reação caía no `else` genérico do resolvedor de conteúdo e
   * virava uma bolha com o texto `[reaction]`, solta no fio: sem o emoji, sem
   * dizer a qual mensagem se referia, e sem sumir quando o contato desreagia.
   *
   * O payload da Meta é `{ type: "reaction", reaction: { message_id, emoji } }`,
   * onde `message_id` é o wamid da mensagem REAGIDA e `emoji` VAZIO significa
   * "desreagiu" — a remoção chega como o mesmo evento.
   *
   * `set_message_reaction` faz o ler-modificar-escrever do jsonb de forma
   * atômica: reagir e desreagir em sequência são dois webhooks concorrentes, e no
   * código a segunda escrita apagaria a primeira.
   */
  if (m.type === "reaction") {
    const alvo = m.reaction?.message_id as string | undefined;
    if (!alvo) return;
    const { data: alvoId, error: erroReacao } = await db.rpc("set_message_reaction", {
      p_location: channel.location_id,
      p_target_wa_id: alvo,
      p_emoji: m.reaction?.emoji ?? "",
      // "contact": quem reagiu foi o cliente. Reação NOSSA (se um dia o CRM
      // enviar) usaria outra origem, e a função troca só a da mesma origem.
      p_by: "contact",
      p_at: nowIso,
    });
    if (erroReacao) {
      console.warn("[webhook] reação não gravada:", erroReacao.message);
    } else if (!alvoId) {
      // Alvo fora da nossa base (mensagem anterior à integração, por exemplo).
      // Ignorar é o comportamento do WhatsApp: reação sem alvo não aparece.
      console.log(`[webhook] reação a mensagem desconhecida (${alvo}) — ignorada`);
    }
    // Não mexe em conversa: reação não é atividade que reabre, não conta como
    // não lida e não muda a prévia da lista. É assim no WhatsApp.
    return;
  }

  // Resolve o conteúdo: texto, ou mídia (imagem/áudio/vídeo) baixada da Meta.
  let msgType = "text";
  let body = "";
  const media: {
    media_path?: string;
    media_name?: string;
    media_mime?: string;
    media_size?: number;
  } = {};

  if (m.type === "text") {
    body = m.text?.body ?? "";
  } else if (m.type === "interactive") {
    // Resposta de botão/lista do bot: o título escolhido vira o corpo (aparece no
    // inbox), e o `id` (button_reply/list_reply) será usado pelo motor do bot.
    const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
    body = r?.title ?? "[resposta]";
  } else if (
    m.type === "image" ||
    m.type === "audio" ||
    m.type === "video" ||
    m.type === "document"
  ) {
    // Documento (PDF etc.) é guardado como `file` — o tipo `document` não existe
    // no CHECK de messages. Os demais mantêm o próprio tipo.
    const isDoc = m.type === "document";
    msgType = isDoc ? "file" : m.type;
    const node = m[m.type] ?? {};
    body = node.caption ?? "";
    try {
      const info = await getMediaInfo(node.id);
      const dl = await downloadMedia(info.url);
      const mime = dl.mime || info.mime || node.mime_type || "application/octet-stream";
      const ext = (mime.split("/")[1] || "bin").split(";")[0];
      const path = `${channel.location_id}/${contact.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await db.storage
        .from("conversation-media")
        .upload(path, new Uint8Array(dl.bytes), { contentType: mime, upsert: false });
      if (upErr) throw upErr;
      media.media_path = path;
      // Documento chega com o nome real do arquivo; mídia comum não tem nome útil.
      media.media_name = isDoc ? node.filename ?? `documento.${ext}` : `${m.type}.${ext}`;
      media.media_mime = mime;
      media.media_size = dl.bytes.byteLength;
    } catch {
      // Não conseguiu baixar/guardar — grava a mensagem com rótulo (nunca quebra o webhook).
      if (!body) body = `[${m.type}]`;
    }
  } else {
    body = `[${m.type ?? "mídia"}]`;
  }

  // Uma conversa por NÚMERO: casa contato + channel_id (o número que recebeu),
  // não uma conversa única por contato. Assim cada número tem seu próprio
  // histórico e o número da conversa nunca "migra".
  // order+limit: defensivo contra eventuais duplicatas antigas (o maybeSingle
  // "cru" QUEBRA com >1 linha — foi o que fazia o webhook criar conversa nova a
  // cada mensagem). Com o índice único (0075) há no máximo uma.
  const findConv = () =>
    db
      .from("conversations")
      .select(
        "id, unread_count, closed_at, archived_at, closed_by, archived_by, bot_paused, assigned_to",
      )
      .eq("location_id", channel.location_id)
      .eq("contact_id", contact.id)
      .eq("channel_id", channel.id)
      .order("created_at")
      .limit(1)
      .maybeSingle();

  let { data: conv } = await findConv();
  // Conversa fechada/arquivada + cliente escreveu de novo = reabrir.
  const wasFinalized = !!(conv && conv.closed_at);
  const wasArchivedOnly = !!(conv && conv.archived_at && !conv.closed_at);
  const wasClosed = wasFinalized || wasArchivedOnly;
  // Distinção importante ao reabrir:
  //  - ARQUIVADA (sem finalizar) por um humano que está atendendo → o cliente
  //    voltou no MEIO do atendimento: mantém com esse humano e o bot PAUSADO
  //    (o bot não pode roubar uma conversa ativa). É o caso do "assumiu via
  //    template e arquivou".
  //  - FINALIZADA → o atendimento foi encerrado. Se o cliente volta, é um novo
  //    contato e o bot DEVE triar de novo (não é roubar, é recomeçar).
  const keepWithHuman =
    wasArchivedOnly && !!(conv && (conv.bot_paused || conv.archived_by || conv.assigned_to));
  const reopenHandler: string | null = conv
    ? conv.archived_by ?? conv.assigned_to ?? null
    : null;
  if (!conv) {
    // Número COM bot: o bot tria TODO mundo — inclusive contato conhecido. É o
    // motivo de ligar o bot ali; mandar direto pro dono pularia a triagem.
    // Número SEM bot: contato com dono vai DIRETO pra ele (é o lead dele) — não
    // há quem triar. Só entra na fila quando o contato ainda não tem dono.
    const { data: ct } = await db
      .from("contacts")
      .select("owner_id")
      .eq("id", contact.id)
      .maybeSingle();
    let ownerId: string | null = ct?.owner_id ?? null;

    // ⚠️ Dono do contato NÃO é o mesmo que atendente responsável, e tratar os
    // dois como sinônimo dava um bug grande: `contacts.owner_id` é gravado com
    // quem INSERIU o contato, então a importação do CRM antigo deixou um admin
    // como dono de 32 mil contatos. Cada um deles que mandasse mensagem caía
    // direto na caixa desse admin — com `bot_paused`, então nem o bot atendia,
    // nem o rodízio distribuía.
    //
    // A intenção original vale (o cliente volta e cai com quem já o atendia),
    // mas só faz sentido para quem ATENDE: admin não entra em fila.
    if (ownerId) {
      const { data: donoMembro } = await db
        .from("location_members")
        .select("role")
        .eq("user_id", ownerId)
        .eq("location_id", channel.location_id)
        .maybeSingle();
      if (donoMembro?.role !== "user") ownerId = null;
    }
    // Duas condições INDEPENDENTES, e as duas precisam valer: o dono tem de ser
    // atendente (acima) E o número não pode ter bot — com bot, quem tria é ele,
    // inclusive para contato conhecido. Sem dono elegível ou com bot no número,
    // a conversa segue o caminho normal (bot → rodízio → fila do setor).
    const assignToOwner = ownerId && !channel.bot_flow;
    const { data: created, error: convErr } = await db
      .from("conversations")
      .insert({
        location_id: channel.location_id,
        contact_id: contact.id,
        channel: "whatsapp",
        channel_id: channel.id,
        unread_count: 1,
        last_message_at: nowIso,
        last_message_preview: previaDeMidia(msgType, body, media.media_name),
        ...(assignToOwner ? { assigned_to: ownerId, bot_paused: true } : {}),
      })
      .select("id")
      .single();
    if (convErr) {
      // Corrida: outra entrega criou a conversa em paralelo e o índice único
      // (0075) barrou este insert — pega a existente em vez de duplicar.
      const { data: again } = await findConv();
      conv = again;
    } else {
      conv = created;
    }
  } else {
    await db
      .from("conversations")
      .update({
        // channel_id NÃO é reescrito: a conversa já é a deste número e fica nele.
        unread_count: (conv.unread_count ?? 0) + 1,
        last_message_at: nowIso,
        last_message_preview: previaDeMidia(msgType, body, media.media_name),
        // O cliente escreveu: a conversa volta para a caixa mesmo que alguém
        // tenha finalizado ou arquivado antes (0029). Perder mensagem de
        // cliente é pior do que desfazer um arquivamento.
        closed_at: null,
        closed_by: null,
        archived_at: null,
        archived_by: null,
        // Arquivada por quem está atendendo: mantém com esse humano e o bot
        // PAUSADO (não rouba conversa ativa).
        ...(keepWithHuman
          ? { bot_paused: true, ...(reopenHandler ? { assigned_to: reopenHandler } : {}) }
          : {}),
        // Finalizada, ou era 100% do bot: solta o bot para recomeçar e, se o
        // número tem fluxo, volta pra FILA (tira o dono pra triar/redistribuir).
        ...(wasClosed && !keepWithHuman ? { bot_paused: false } : {}),
        ...(wasClosed && !keepWithHuman && channel.bot_flow ? { assigned_to: null } : {}),
      })
      .eq("id", conv.id);
  }
  if (!conv) return;

  // Reabriu finalizada (ou era 100% do bot): zera a sessão para o bot iniciar de
  // novo. Se um humano arquivou no meio do atendimento, a sessão fica intacta.
  if (wasClosed && !keepWithHuman) {
    await db.from("bot_sessions").delete().eq("conversation_id", conv.id);
  }

  // Responder (0077): o cliente citou uma mensagem? A Meta manda o id dela em
  // context.id — resolvemos para o id local para mostrar a citação na bolha.
  let inReplyToLocal: string | null = null;
  const ctxWaId: string | null = (m as any).context?.id ?? null;
  if (ctxWaId) {
    const { data: quoted } = await db
      .from("messages")
      .select("id")
      .eq("wa_message_id", ctxWaId)
      .maybeSingle();
    inReplyToLocal = quoted?.id ?? null;
  }

  const { error: insErr } = await db.from("messages").insert({
    location_id: channel.location_id,
    conversation_id: conv.id,
    direction: "in",
    type: msgType,
    channel: "whatsapp",
    body,
    channel_id: channel.id,
    wa_message_id: waId,
    status: "delivered",
    // Só grava quando há citação — mantém o insert válido antes da migração 0077.
    ...(inReplyToLocal ? { reply_to: inReplyToLocal } : {}),
    ...media,
  });
  if (insErr) {
    // corrida: entrega duplicada da Meta — o índice único barra o 2º insert.
    // Nesse caso NÃO responde de novo (evita auto-reply duplicado).
    if ((insErr as any).code !== "23505") throw insErr;
    return;
  }

  // Bot conversacional primeiro (fluxo com passos/botões). Se ele não tratar a
  // mensagem, cai no auto-responder de IA single-turn. Best-effort.
  const replyId =
    m.interactive?.list_reply?.id ?? m.interactive?.button_reply?.id ?? null;
  const botHandled = await maybeRunBot(db, {
    channel: {
      id: channel.id,
      phone_number_id: channel.phone_number_id,
      location_id: channel.location_id,
      bot_flow: channel.bot_flow ?? null,
    },
    conversationId: conv.id,
    contact: { id: contact.id, phone },
    text: body,
    replyId,
  }).catch(() => false);

  if (!botHandled && m.text?.body) {
    await maybeAutoReply(db, {
      locationId: channel.location_id,
      conversationId: conv.id,
      channelId: channel.id,
      phoneNumberId: channel.phone_number_id,
      toPhone: phone,
      dailyLimit: channel.daily_limit ?? 1000,
    });
  }
}

async function applyStatus(db: any, st: any) {
  const { data: msg } = await db
    .from("messages")
    .select("id, status, delivered_at, error_detail")
    .eq("wa_message_id", st.id)
    .maybeSingle();
  if (!msg) return; // status de mensagem que não gravamos — ignora
  if (!isAdvance(msg.status, st.status)) return; // não rebaixa entregue/lido

  const patch: Record<string, unknown> = { status: st.status };
  const nowIso = st.timestamp
    ? new Date(Number(st.timestamp) * 1000).toISOString()
    : new Date().toISOString();
  if (st.status === "delivered") patch.delivered_at = nowIso;
  if (st.status === "read") {
    patch.read_at = nowIso;
    // "Lido" implica "entregue": a Meta às vezes pula o evento de entrega e manda
    // só o read. Sem isto, a coluna Entregue ficaria "—" numa mensagem já lida.
    if (!msg.delivered_at) patch.delivered_at = nowIso;
  }
  if (st.status === "failed") {
    patch.failed_at = nowIso;
    /*
     * ⚠️ **`title` é a CATEGORIA do erro, não o motivo.** Guardar só ele foi o
     * que deixou o áudio em "Media upload error" por várias rodadas de
     * investigação: esse rótulo cobre arquivo vazio, codec errado, canais
     * demais e tamanho — sem distinguir nenhum. O motivo específico vem em
     * `error_data.details`, e era exatamente ele que se perdia.
     *
     * A ordem é do mais específico para o mais genérico, e o código entra junto
     * porque é por ele que se acha a causa na documentação da Meta.
     */
    const err = st.errors?.[0] as
      | { code?: number; title?: string; message?: string; error_data?: { details?: string } }
      | undefined;
    const partes = [
      err?.error_data?.details,
      err?.title,
      err?.message,
      err?.code != null ? `#${err.code}` : null,
    ].filter(Boolean);
    /*
     * ⚠️ **Preserva o `[diag]` que a rota de envio gravou.** A frase da Meta
     * descreve o SINTOMA ("não consegui processar"); o retrato do arquivo, que
     * só quem enviou pode montar, é o que explica a causa. Sobrescrevendo, o
     * balão fica com a metade inútil da informação — foi o que aconteceu por
     * seis rodadas de investigação deste mesmo erro.
     */
    const diagAnterior = String(msg.error_detail ?? "").startsWith("[diag]")
      ? msg.error_detail
      : null;
    const texto = partes.length ? partes.join(" · ") : "Falha na entrega";
    patch.error_detail = (diagAnterior ? `${texto} · ${diagAnterior}` : texto).slice(0, 900);
    if (err) console.log(`[webhook] falha em ${msg.id}: ${JSON.stringify(err)}`);
  }
  await db.from("messages").update(patch).eq("id", msg.id);
}
