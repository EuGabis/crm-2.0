"use client";

import { useEffect, useMemo } from "react";
import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type {
  Channel,
  Conversation,
  ConversationFilter,
  InboxView,
  InboxViewConfig,
  Message,
} from "@/lib/data/types";
import { useDbStore } from "./contacts";

export type { ConversationFilter } from "@/lib/data/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Snippet {
  id: string;
  name: string;
  content: string;
}

const mapConversation = (r: any): Conversation => ({
  id: r.id,
  contactId: r.contact_id,
  channel: r.channel,
  unreadCount: r.unread_count,
  lastMessageAt: r.last_message_at ?? r.created_at,
  lastMessagePreview: r.last_message_preview ?? "",
  starred: r.starred,
  slaDays: r.sla_days,
  channelId: r.channel_id ?? undefined,
  assignedTo: r.assigned_to ?? null,
  closedAt: r.closed_at ?? null,
  closedBy: r.closed_by ?? null,
  archivedAt: r.archived_at ?? null,
  archivedBy: r.archived_by ?? null,
  createdAt: r.created_at,
  botPaused: r.bot_paused ?? false,
  awaitingDistribution: r.awaiting_distribution ?? false,
  assignedOffline: r.assigned_offline ?? false,
});

const mapMessage = (r: any): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  direction: r.direction,
  type: r.type,
  channel: r.channel,
  body: r.body,
  at: r.created_at,
  internal: r.internal || undefined,
  scheduledFor: r.scheduled_for ?? undefined,
  mediaPath: r.media_path ?? undefined,
  mediaName: r.media_name ?? undefined,
  mediaMime: r.media_mime ?? undefined,
  mediaSize: r.media_size ?? undefined,
  waMessageId: r.wa_message_id ?? undefined,
  status: r.status ?? undefined,
  deliveredAt: r.delivered_at ?? undefined,
  readAt: r.read_at ?? undefined,
  automated: r.automated || undefined,
  createdBy: r.created_by ?? null,
  scheduledBy: r.scheduled_by ?? null,
  scheduleStatus: r.schedule_status ?? undefined,
  dispatchedAt: r.dispatched_at ?? undefined,
  scheduleError: r.schedule_error ?? undefined,
});

const mapView = (r: any): InboxView => ({
  id: r.id,
  name: r.name,
  config: {
    scope: r.config?.scope ?? "group",
    filter: r.config?.filter ?? "all",
    sort: r.config?.sort ?? "",
    query: r.config?.query ?? "",
    status: r.config?.status ?? "abertas", // salvas antes da 0029 não têm o campo
  },
});

export const MEDIA_BUCKET = "conversation-media";
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024; // 15 MB

interface ConvState {
  loaded: boolean;
  loading: boolean;
  realtime: "off" | "on";
  conversations: Conversation[];
  messages: Message[];
  snippets: Snippet[];
  views: InboxView[];
  load: () => Promise<void>;
  patch: (
    p: Partial<Pick<ConvState, "conversations" | "messages" | "snippets" | "views" | "realtime">>
  ) => void;
}

export const useConvStore = create<ConvState>((set, get) => ({
  loaded: false,
  loading: false,
  realtime: "off",
  conversations: [],
  messages: [],
  snippets: [],
  views: [],

  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    await useDbStore.getState().load();
    const supabase = createClient();
    const [convs, msgs, snips, views] = await Promise.all([
      supabase.from("conversations").select("*"),
      supabase.from("messages").select("*").order("created_at"),
      supabase.from("snippets").select("*").order("created_at"),
      supabase.from("inbox_views").select("*").order("created_at"),
    ]);
    set({
      loaded: true,
      loading: false,
      conversations: (convs.data ?? []).map(mapConversation),
      messages: (msgs.data ?? []).map(mapMessage),
      snippets: (snips.data ?? []).map((r: any) => ({ id: r.id, name: r.name, content: r.content })),
      views: (views.data ?? []).map(mapView),
    });

    subscribeInbox();
  },

  patch: (p) => set(p),
}));

/**
 * Assina o Realtime da caixa de entrada — e pode ser chamada DE NOVO.
 *
 * O `.subscribe()` original só tratava `SUBSCRIBED`. Quando o websocket morre
 * (notebook suspenso, rede oscilando, proxy cortando conexão ociosa), o canal
 * fica em `CLOSED`/`CHANNEL_ERROR`, ninguém reinscreve e o selo continuava
 * dizendo "Ao vivo" — a caixa parava de atualizar sem nenhum sinal, e só um F5
 * resolvia. Era o sintoma relatado.
 */
let inboxChannel: RealtimeChannel | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export function subscribeInbox() {
  const supabase = createClient();
  const set = useConvStore.setState;
  const get = useConvStore.getState;

  if (inboxChannel) {
    void supabase.removeChannel(inboxChannel);
    inboxChannel = null;
  }

  inboxChannel = supabase
      .channel("lito-inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = mapMessage(payload.new);
          const s = get();
          if (s.messages.some((m) => m.id === msg.id)) return; // já inserida (otimista)
          set({ messages: [...s.messages, msg] });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const msg = mapMessage(payload.new);
          const s = get();
          set({ messages: s.messages.map((m) => (m.id === msg.id ? msg : m)) });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations" },
        (payload) => {
          const conv = mapConversation(payload.new);
          const s = get();
          if (s.conversations.some((c) => c.id === conv.id)) return;
          set({ conversations: [conv, ...s.conversations] });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations" },
        (payload) => {
          const conv = mapConversation(payload.new);
          const s = get();
          set({
            conversations: s.conversations.map((c) => (c.id === conv.id ? conv : c)),
          });
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          set({ realtime: "on" });
          return;
        }
        // Qualquer outro estado final = não estamos mais recebendo nada. Dizer
        // isso ("Ao vivo" apaga) importa: o usuário precisa saber que a lista
        // pode estar velha. A varredura de `useInboxLiveSync` cobre o buraco.
        if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          set({ realtime: "off" });
          if (retryTimer) clearTimeout(retryTimer);
          // Espera antes de tentar de novo: reinscrever em rajada durante uma
          // queda de rede só multiplica o erro.
          retryTimer = setTimeout(() => subscribeInbox(), 5000);
        }
      });
}

/**
 * Cursor da varredura: a mensagem mais recente que já temos, MENOS uma
 * sobreposição.
 *
 * A sobreposição não é preciosismo: com `created_at > cursor`, duas mensagens
 * gravadas no mesmo instante fariam a segunda ser pulada para sempre. Os poucos
 * registros repetidos que a janela traz de volta são descartados pelo filtro de
 * id logo depois — barato, e fecha o buraco.
 */
const SYNC_OVERLAP_MS = 30_000;

function syncCursor(): string | null {
  const { messages } = useConvStore.getState();
  let max: string | null = null;
  // Compara sempre `at` (created_at): misturar `dispatchedAt` empurraria o
  // cursor para além do que a coluna consultada contém, e aí sim haveria salto.
  for (const m of messages) {
    if (!max || m.at > max) max = m.at;
  }
  if (!max) return null;
  const t = new Date(max).getTime();
  return Number.isNaN(t) ? max : new Date(t - SYNC_OVERLAP_MS).toISOString();
}

/**
 * Busca o que chegou DEPOIS do cursor e emenda na store. Silenciosa de
 * propósito: não mexe em `loading`, não recarrega a lista inteira e não
 * substitui nada que já esteja lá — só acrescenta o que falta. Sem isso, o
 * "refresh automático" piscaria a tela e jogaria o scroll da conversa.
 */
export async function syncInboxDelta(): Promise<number> {
  const supabase = createClient();
  const cursor = syncCursor();
  let query = supabase.from("messages").select("*").order("created_at").limit(300);
  // Sem cursor (store vazia) não há delta a buscar — quem carrega é o load().
  if (!cursor) return 0;
  query = query.gt("created_at", cursor);

  const { data, error } = await query;
  if (error || !data || data.length === 0) return 0;

  const s = useConvStore.getState();
  const known = new Set(s.messages.map((m) => m.id));
  const fresh = data.map(mapMessage).filter((m) => !known.has(m.id));
  if (fresh.length === 0) return 0;

  useConvStore.setState({ messages: [...s.messages, ...fresh] });

  // As conversas tocadas precisam vir junto: prévia, contador de não lidas e
  // reabertura por mensagem de entrada mudam na linha da conversa, não na
  // mensagem. Só as afetadas — recarregar todas a cada varredura seria caro.
  const touched = [...new Set(fresh.map((m) => m.conversationId))];
  const { data: convs } = await supabase.from("conversations").select("*").in("id", touched);
  if (convs?.length) {
    const byId = new Map(convs.map((c: any) => [c.id, mapConversation(c)]));
    const cur = useConvStore.getState();
    const updated = cur.conversations.map((c) => byId.get(c.id) ?? c);
    const novas = [...byId.values()].filter((c) => !cur.conversations.some((x) => x.id === c.id));
    useConvStore.setState({ conversations: [...novas, ...updated] });
  }
  return fresh.length;
}

export function useConversations(filter: ConversationFilter = "all") {
  const { conversations, load } = useConvStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useMemo(() => {
    let list = [...conversations];
    if (filter === "unread") list = list.filter((c) => c.unreadCount > 0);
    if (filter === "starred") list = list.filter((c) => c.starred);
    list.sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
    if (filter === "recent") list = list.slice(0, 8);
    return list;
  }, [conversations, filter]);
}

export function useConversation(id: string | null) {
  return useConvStore((s) => (id ? s.conversations.find((c) => c.id === id) ?? null : null));
}

export function useMessages(conversationId: string | null) {
  const messages = useConvStore((s) => s.messages);
  return useMemo(
    () =>
      conversationId
        ? messages
            .filter((m) => m.conversationId === conversationId)
            .sort((a, b) => a.at.localeCompare(b.at))
        : [],
    [messages, conversationId]
  );
}

export function useSnippets() {
  const { snippets, load } = useConvStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return snippets;
}

export function useRealtimeStatus() {
  return useConvStore((s) => s.realtime);
}

/** Visualizações salvas da caixa de entrada (compartilhadas com a equipe). */
export function useInboxViews() {
  const { views, load } = useConvStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return views;
}

/**
 * Log de mensagens agendadas: tudo que passou pelo "Programar", da mais
 * recente para a mais antiga (migração 0028).
 */
export function useScheduledMessages() {
  const { messages, load } = useConvStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useMemo(
    () =>
      messages
        .filter((m) => !!m.scheduleStatus)
        .sort((a, b) => (b.scheduledFor ?? "").localeCompare(a.scheduledFor ?? "")),
    [messages]
  );
}

export const scheduleActions = {
  /** Cancela um agendamento ainda pendente (não mexe no que já saiu). */
  async cancel(messageId: string): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("messages")
      .update({ schedule_status: "cancelada" })
      .eq("id", messageId)
      .eq("schedule_status", "pendente") // corrida com o disparador: quem chegar primeiro vence
      .select()
      .maybeSingle();
    if (error || !data) return false;
    const s = useConvStore.getState();
    s.patch({
      messages: s.messages.map((m) => (m.id === messageId ? mapMessage(data) : m)),
    });
    return true;
  },
};

/**
 * Ids das conversas que têm ao menos uma mensagem escrita por automação/IA —
 * o que sustenta o escopo "bot" do rail.
 */
export function useAutomatedConversationIds() {
  const messages = useConvStore((s) => s.messages);
  return useMemo(() => {
    const ids = new Set<string>();
    messages.forEach((m) => {
      if (m.automated) ids.add(m.conversationId);
    });
    return ids;
  }, [messages]);
}

const loc = () => useDbStore.getState().locationId;

export const conversationActions = {
  async send(
    conversationId: string,
    msg: Omit<Message, "id" | "conversationId" | "at">
  ): Promise<boolean> {
    const location = loc();
    if (!location) return false;
    const supabase = createClient();
    // Agendou? Registra quem e entra na fila como pendente (migração 0028).
    const scheduling = msg.scheduledFor
      ? {
          scheduled_for: msg.scheduledFor,
          scheduled_by: (await supabase.auth.getUser()).data.user?.id ?? null,
          schedule_status: "pendente",
        }
      : { scheduled_for: null };
    const { data, error } = await supabase
      .from("messages")
      .insert({
        location_id: location,
        conversation_id: conversationId,
        direction: msg.direction,
        type: msg.type,
        channel: msg.channel,
        body: msg.body,
        internal: msg.internal ?? false,
        // Autor (0051): é o que permite o próprio excluir a nota que escreveu.
        created_by: useDbStore.getState().userId,
        ...scheduling,
      })
      .select()
      .single();
    if (error || !data) return false;

    const preview = msg.internal
      ? "Comentário interno"
      : msg.scheduledFor
        ? "Mensagem agendada"
        : msg.body;
    await supabase
      .from("conversations")
      .update({ last_message_at: data.created_at, last_message_preview: preview, sla_days: 0 })
      .eq("id", conversationId);

    const s = useConvStore.getState();
    if (!s.messages.some((m) => m.id === data.id)) {
      s.patch({ messages: [...s.messages, mapMessage(data)] });
    }
    s.patch({
      conversations: s.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, lastMessageAt: data.created_at, lastMessagePreview: preview, slaDays: 0 }
          : c
      ),
    });
    return true;
  },

  /** Insere otimisticamente uma mensagem já gravada no servidor (envio WhatsApp),
   *  com dedup por id (o Realtime pode reentregar a mesma). */
  pushSent(row: any): void {
    if (!row) return;
    const m = mapMessage(row);
    const s = useConvStore.getState();
    if (!s.messages.some((x) => x.id === m.id)) s.patch({ messages: [...s.messages, m] });
  },

  /**
   * Envia uma mídia (imagem, arquivo ou áudio): sobe o binário para o bucket
   * privado e cria a mensagem com os metadados. `duration` só para áudio.
   */
  async sendMedia(
    conversationId: string,
    opts: {
      file: File;
      kind: "image" | "file" | "audio" | "video";
      channel: Channel;
      duration?: string;
      /**
       * Anexo INTERNO (padrão: false). O painel "Arquivos" do contato sobe
       * documento sem despachar nada para o cliente — só esta função grava a
       * mensagem, quem entrega no WhatsApp é a rota `send-media` chamada pelo
       * composer. Sem esta marca o arquivo apareceria no thread com cara de
       * enviado, e o cliente nunca recebeu.
       */
      internal?: boolean;
    }
  ): Promise<{ ok: boolean; error?: string; messageId?: string; mediaPath?: string; mime?: string }> {
    const location = loc();
    if (!location) return { ok: false, error: "Empresa não encontrada" };
    const { file, kind, channel, duration, internal = false } = opts;
    if (file.size > MAX_MEDIA_BYTES) return { ok: false, error: "Arquivo maior que 15 MB" };

    const supabase = createClient();
    const ext =
      (file.name.includes(".") ? file.name.split(".").pop() : file.type.split("/")[1]) || "bin";
    const path = `${location}/${conversationId}/${crypto.randomUUID()}.${ext.toLowerCase()}`;

    const { error: upErr } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (upErr) return { ok: false, error: `Falha no upload: ${upErr.message}` };

    const body = kind === "audio" ? duration ?? "" : kind === "file" ? file.name : "";
    const { data, error } = await supabase
      .from("messages")
      .insert({
        location_id: location,
        conversation_id: conversationId,
        direction: "out",
        type: kind,
        channel,
        body,
        internal,
        created_by: useDbStore.getState().userId,
        media_path: path,
        media_name: file.name,
        media_mime: file.type || null,
        media_size: file.size,
      })
      .select()
      .single();

    if (error || !data) {
      await supabase.storage.from(MEDIA_BUCKET).remove([path]); // não deixa binário órfão
      return { ok: false, error: error?.message ?? "Não foi possível enviar a mídia" };
    }

    const preview = internal
      ? "Comentário interno"
      : kind === "image"
        ? "📷 Imagem"
        : kind === "audio"
          ? "🎤 Áudio"
          : kind === "video"
            ? "🎬 Vídeo"
            : `📎 ${file.name}`;
    await supabase
      .from("conversations")
      .update({ last_message_at: data.created_at, last_message_preview: preview, sla_days: 0 })
      .eq("id", conversationId);

    const s = useConvStore.getState();
    if (!s.messages.some((m) => m.id === data.id)) {
      s.patch({ messages: [...s.messages, mapMessage(data)] });
    }
    s.patch({
      conversations: s.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, lastMessageAt: data.created_at, lastMessagePreview: preview, slaDays: 0 }
          : c
      ),
    });
    return { ok: true, messageId: data.id, mediaPath: path, mime: file.type || undefined };
  },

  /** URL assinada temporária (bucket é privado) para exibir/baixar a mídia. */
  async mediaUrl(path: string, expiresIn = 3600): Promise<string | null> {
    const supabase = createClient();
    const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, expiresIn);
    return data?.signedUrl ?? null;
  },

  async markRead(conversationId: string): Promise<void> {
    const supabase = createClient();
    const s = useConvStore.getState();
    const conv = s.conversations.find((c) => c.id === conversationId);
    // Se o próprio atendente abre um lead que caiu enquanto ele estava offline,
    // some da aba "Offline" (já foi visto).
    const clearOffline =
      !!conv?.assignedOffline && conv.assignedTo === useDbStore.getState().userId;
    const patch: Record<string, unknown> = { unread_count: 0 };
    if (clearOffline) patch.assigned_offline = false;
    await supabase.from("conversations").update(patch).eq("id", conversationId);
    s.patch({
      conversations: s.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, unreadCount: 0, ...(clearOffline ? { assignedOffline: false } : {}) }
          : c
      ),
    });
  },

  /**
   * Marca como NÃO lida (volta a aparecer como pendente na lista). Oposto do
   * markRead; mantém a contagem se já havia não lidas. Ao reabrir a conversa,
   * o markRead (disparado no clique da lista) zera de novo.
   */
  async markUnread(conversationId: string): Promise<void> {
    const supabase = createClient();
    const s = useConvStore.getState();
    const conv = s.conversations.find((c) => c.id === conversationId);
    const next = Math.max(1, conv?.unreadCount ?? 0);
    await supabase.from("conversations").update({ unread_count: next }).eq("id", conversationId);
    s.patch({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: next } : c
      ),
    });
  },

  async star(conversationId: string): Promise<void> {
    const s = useConvStore.getState();
    const conv = s.conversations.find((c) => c.id === conversationId);
    if (!conv) return;
    const supabase = createClient();
    await supabase
      .from("conversations")
      .update({ starred: !conv.starred })
      .eq("id", conversationId);
    s.patch({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, starred: !conv.starred } : c
      ),
    });
  },

  /** Define o responsável pela conversa; `null` devolve para a caixa do grupo. */
  async assign(conversationId: string, userId: string | null): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase
      .from("conversations")
      .update({ assigned_to: userId })
      .eq("id", conversationId);
    if (error) return false;
    const s = useConvStore.getState();
    s.patch({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, assignedTo: userId } : c
      ),
    });
    return true;
  },

  /**
   * Registra uma ação como evento inline (pílula cinza no meio da conversa):
   * "Fulano transferiu para Beltrano", "mudou a fase para X", etc. Reaproveita
   * o tipo `event` das mensagens — vira histórico de quem fez o quê, no contexto.
   * O texto do corpo já vem montado (quem + ação) por quem chama.
   */
  async logEvent(conversationId: string, body: string): Promise<void> {
    const location = loc();
    if (!location) return;
    const s = useConvStore.getState();
    const conv = s.conversations.find((c) => c.id === conversationId);
    const supabase = createClient();
    const { data } = await supabase
      .from("messages")
      .insert({
        location_id: location,
        conversation_id: conversationId,
        direction: "out",
        type: "event",
        channel: conv?.channel ?? "whatsapp",
        body,
      })
      .select()
      .single();
    // Inserção otimista; o Realtime (INSERT em messages) deduplica pelo id.
    if (data) {
      const s2 = useConvStore.getState();
      if (!s2.messages.some((m) => m.id === data.id)) {
        s2.patch({ messages: [...s2.messages, mapMessage(data)] });
      }
    }
  },

  /**
   * Finaliza (atendimento resolvido) ou reabre. Arquivar é outro eixo — uma
   * conversa pode estar finalizada e não arquivada, e vice-versa (0029).
   */
  async close(conversationId: string, done: boolean): Promise<boolean> {
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const patch = done
      ? { closed_at: new Date().toISOString(), closed_by: auth.user?.id ?? null }
      : { closed_at: null, closed_by: null };
    const { data, error } = await supabase
      .from("conversations")
      .update(patch)
      .eq("id", conversationId)
      .select()
      .single();
    if (error || !data) return false;
    const s = useConvStore.getState();
    s.patch({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? mapConversation(data) : c
      ),
    });
    return true;
  },

  /** Arquiva (tira de vista) ou desarquiva. Não mexe no "finalizada". */
  async archive(conversationId: string, archived: boolean): Promise<boolean> {
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const patch = archived
      ? { archived_at: new Date().toISOString(), archived_by: auth.user?.id ?? null }
      : { archived_at: null, archived_by: null };
    const { data, error } = await supabase
      .from("conversations")
      .update(patch)
      .eq("id", conversationId)
      .select()
      .single();
    if (error || !data) return false;
    const s = useConvStore.getState();
    s.patch({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? mapConversation(data) : c
      ),
    });
    return true;
  },

  /** Exclui a conversa e todas as mensagens dela. */
  /** Só administrador (a RLS da 0040 recusa os demais). */
  /**
    * Exclui UMA mensagem — hoje só usado para nota interna, no painel
    * Observações.
    *
    * Confere as linhas devolvidas em vez do `error`: DELETE recusado pela RLS
    * não vem com erro nenhum, só sem linhas. Sem esta checagem a tela diria
    * "excluída" com a nota ainda no banco (o mesmo tropeço que já aconteceu
    * com a exclusão de conversa).
    */
  async removeMessage(id: string): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase.from("messages").delete().eq("id", id).select("id");
    if (error || !data || data.length === 0) return false;
    const s = useConvStore.getState();
    s.patch({ messages: s.messages.filter((m) => m.id !== id) });
    return true;
  },

  async remove(conversationId: string): Promise<boolean> {
    const supabase = createClient();
    // Só a conversa: `messages.conversation_id` tem ON DELETE CASCADE, então
    // as mensagens vão junto. Apagá-las antes, à mão, destruía o histórico
    // mesmo quando a exclusão da conversa era recusada logo depois.
    const { data, error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", conversationId)
      .select("id");
    // Zero linhas sem erro = a RLS recusou. `error` sozinho não detecta isso,
    // e a tela diria "conversa excluída" com ela ainda no banco.
    if (error || !data?.length) return false;
    const s = useConvStore.getState();
    s.patch({
      conversations: s.conversations.filter((c) => c.id !== conversationId),
      messages: s.messages.filter((m) => m.conversationId !== conversationId),
    });
    return true;
  },

  /**
   * Reaproveita a conversa mais recente do contato, em qualquer canal, e só
   * cria uma se ele ainda não tiver nenhuma. É o que o botão "Abrir conversa"
   * (card do kanban) precisa: abrir o que já existe, não um chat novo.
   */
  async openForContact(contactId: string): Promise<string | null> {
    const supabase = createClient();
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .eq("contact_id", contactId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      const conv = mapConversation(data);
      const s = useConvStore.getState();
      if (!s.conversations.some((c) => c.id === conv.id)) {
        s.patch({ conversations: [conv, ...s.conversations] });
      }
      return conv.id;
    }
    return conversationActions.open(contactId, "whatsapp");
  },

  /** Cria (ou reaproveita) a conversa de um contato num canal. Retorna o id. */
  async open(contactId: string, channel: Channel): Promise<string | null> {
    const s = useConvStore.getState();
    const existing = s.conversations.find(
      (c) => c.contactId === contactId && c.channel === channel
    );
    if (existing) return existing.id;
    const location = loc();
    if (!location) return null;
    const supabase = createClient();

    // A store só tem dado depois que o módulo Conversas carregou. Chamado de
    // fora dele (kanban, por exemplo) ela está vazia, e confiar só nela criava
    // uma conversa duplicada. Confere no banco antes de inserir.
    const { data: found } = await supabase
      .from("conversations")
      .select("*")
      .eq("contact_id", contactId)
      .eq("channel", channel)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (found) {
      const conv = mapConversation(found);
      if (!useConvStore.getState().conversations.some((c) => c.id === conv.id)) {
        useConvStore.getState().patch({
          conversations: [conv, ...useConvStore.getState().conversations],
        });
      }
      return conv.id;
    }
    let channelId: string | null = null;
    if (channel === "whatsapp") {
      const { data: ch } = await supabase
        .from("whatsapp_channels")
        .select("id")
        .eq("location_id", location)
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      channelId = (ch as { id: string } | null)?.id ?? null;
    }
    const { data, error } = await supabase
      .from("conversations")
      .insert({
        location_id: location,
        contact_id: contactId,
        channel,
        ...(channelId ? { channel_id: channelId } : {}),
      })
      .select()
      .single();
    if (error || !data) return null;
    const conv = mapConversation(data);
    if (!useConvStore.getState().conversations.some((c) => c.id === conv.id)) {
      useConvStore.getState().patch({
        conversations: [conv, ...useConvStore.getState().conversations],
      });
    }
    return conv.id;
  },

  /**
   * Cria/reaproveita a conversa de um contato num NÚMERO específico (channel_id).
   * É o que "Nova conversa" usa quando o usuário escolhe por qual número falar —
   * e a conversa fica travada nesse número.
   */
  async openForChannel(contactId: string, channelId: string): Promise<string | null> {
    const location = loc();
    if (!location) return null;
    const supabase = createClient();
    const { data: found } = await supabase
      .from("conversations")
      .select("*")
      .eq("contact_id", contactId)
      .eq("channel_id", channelId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const patchIn = (row: any) => {
      const conv = mapConversation(row);
      const s = useConvStore.getState();
      if (!s.conversations.some((c) => c.id === conv.id)) {
        s.patch({ conversations: [conv, ...s.conversations] });
      }
      return conv.id;
    };
    if (found) return patchIn(found);
    const { data, error } = await supabase
      .from("conversations")
      .insert({ location_id: location, contact_id: contactId, channel: "whatsapp", channel_id: channelId })
      .select()
      .single();
    if (error || !data) return null;
    return patchIn(data);
  },
};

export const inboxViewActions = {
  async add(name: string, config: InboxViewConfig): Promise<boolean> {
    const location = loc();
    if (!location) return false;
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("inbox_views")
      .insert({
        location_id: location,
        name,
        config,
        created_by: auth.user?.id ?? null,
      })
      .select()
      .single();
    if (error || !data) return false;
    const s = useConvStore.getState();
    s.patch({ views: [...s.views, mapView(data)] });
    return true;
  },

  async remove(id: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("inbox_views").delete().eq("id", id);
    if (error) return false;
    const s = useConvStore.getState();
    s.patch({ views: s.views.filter((v) => v.id !== id) });
    return true;
  },
};

export const snippetActions = {
  async add(name: string, content: string): Promise<boolean> {
    const location = loc();
    if (!location) return false;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("snippets")
      .insert({ location_id: location, name, content })
      .select()
      .single();
    if (error || !data) return false;
    const s = useConvStore.getState();
    s.patch({ snippets: [...s.snippets, { id: data.id, name: data.name, content: data.content }] });
    return true;
  },
  async remove(id: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("snippets").delete().eq("id", id);
    if (error) return false;
    const s = useConvStore.getState();
    s.patch({ snippets: s.snippets.filter((x) => x.id !== id) });
    return true;
  },
};

/**
 * Refresh silencioso da caixa de entrada — montado SÓ na página de Conversas.
 *
 * Por que existe, mesmo havendo Realtime: o websocket cai por motivos que o CRM
 * não controla (notebook suspenso, wi-fi trocando de rede, proxy corporativo
 * cortando conexão ociosa, token expirando). Quando cai, a caixa simplesmente
 * para de atualizar e o usuário só descobre quando estranha o silêncio — a
 * queixa foi exatamente "preciso dar F5 para ver mensagem nova".
 *
 * Três gatilhos, porque cada um cobre um caso diferente:
 *   * intervalo — a rede voltou mas o canal não;
 *   * voltar para a aba — o navegador congela timers em aba oculta, então o
 *     intervalo NÃO é confiável em segundo plano; sem isto a pessoa voltaria
 *     para uma lista velha;
 *   * `online` — sai do modo avião / cabo reconectado.
 *
 * Em aba oculta a varredura é pulada de propósito: gastar consulta a cada 15 s
 * numa aba que ninguém está vendo não ajuda, e o gatilho de foco cobre.
 *
 * "Não perceptível" é requisito: `syncInboxDelta` só ACRESCENTA (nunca troca a
 * lista nem toca em `loading`), então não há piscada, spinner nem salto de
 * scroll. Se de fato chegou mensagem, o thread rola para o fim — isso é o
 * comportamento esperado de um chat, não efeito colateral do refresh.
 */
export function useInboxLiveSync(intervalMs = 15000) {
  useEffect(() => {
    let alive = true;
    let running = false;

    const tick = async () => {
      // Uma varredura por vez: numa conexão lenta, duas rodando juntas
      // duplicariam a mesma emenda.
      if (!alive || running || typeof document === "undefined") return;
      if (document.hidden) return;
      running = true;
      try {
        await syncInboxDelta();
      } finally {
        running = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // Voltou para a aba: se o canal caiu enquanto ela estava oculta, reassina
      // antes de varrer — senão a próxima mensagem também não chegaria sozinha.
      if (useConvStore.getState().realtime === "off") subscribeInbox();
      void tick();
    };

    const timer = setInterval(() => void tick(), intervalMs);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [intervalMs]);
}
