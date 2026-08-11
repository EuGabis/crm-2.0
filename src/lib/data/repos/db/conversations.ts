"use client";

import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { Channel, Conversation, Message } from "@/lib/data/types";
import { useDbStore } from "./contacts";

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
  load: () => Promise<void>;
  patch: (p: Partial<Pick<ConvState, "conversations" | "messages" | "snippets" | "realtime">>) => void;
}

export const useConvStore = create<ConvState>((set, get) => ({
  loaded: false,
  loading: false,
  realtime: "off",
  conversations: [],
  messages: [],
  snippets: [],

  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    await useDbStore.getState().load();
    const supabase = createClient();
    const [convs, msgs, snips] = await Promise.all([
      supabase.from("conversations").select("*"),
      supabase.from("messages").select("*").order("created_at"),
      supabase.from("snippets").select("*").order("created_at"),
    ]);
    set({
      loaded: true,
      loading: false,
      conversations: (convs.data ?? []).map(mapConversation),
      messages: (msgs.data ?? []).map(mapMessage),
      snippets: (snips.data ?? []).map((r: any) => ({ id: r.id, name: r.name, content: r.content })),
    });

    // Realtime: mensagens e conversas chegam ao vivo (RLS filtra por tenant)
    supabase
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
        if (status === "SUBSCRIBED") set({ realtime: "on" });
      });
  },

  patch: (p) => set(p),
}));

export type ConversationFilter = "unread" | "all" | "recent" | "starred";

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

const loc = () => useDbStore.getState().locationId;

export const conversationActions = {
  async send(
    conversationId: string,
    msg: Omit<Message, "id" | "conversationId" | "at">
  ): Promise<boolean> {
    const location = loc();
    if (!location) return false;
    const supabase = createClient();
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
        scheduled_for: msg.scheduledFor ?? null,
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

  /**
   * Envia uma mídia (imagem, arquivo ou áudio): sobe o binário para o bucket
   * privado e cria a mensagem com os metadados. `duration` só para áudio.
   */
  async sendMedia(
    conversationId: string,
    opts: { file: File; kind: "image" | "file" | "audio"; channel: Channel; duration?: string }
  ): Promise<{ ok: boolean; error?: string }> {
    const location = loc();
    if (!location) return { ok: false, error: "Empresa não encontrada" };
    const { file, kind, channel, duration } = opts;
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

    const preview =
      kind === "image" ? "📷 Imagem" : kind === "audio" ? "🎤 Áudio" : `📎 ${file.name}`;
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
    return { ok: true };
  },

  /** URL assinada temporária (bucket é privado) para exibir/baixar a mídia. */
  async mediaUrl(path: string, expiresIn = 3600): Promise<string | null> {
    const supabase = createClient();
    const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, expiresIn);
    return data?.signedUrl ?? null;
  },

  async markRead(conversationId: string): Promise<void> {
    const supabase = createClient();
    await supabase.from("conversations").update({ unread_count: 0 }).eq("id", conversationId);
    const s = useConvStore.getState();
    s.patch({
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c
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

  /** Exclui a conversa e todas as mensagens dela. */
  async remove(conversationId: string): Promise<boolean> {
    const supabase = createClient();
    // remove mensagens primeiro (cobre o caso sem ON DELETE CASCADE)
    await supabase.from("messages").delete().eq("conversation_id", conversationId);
    const { error } = await supabase.from("conversations").delete().eq("id", conversationId);
    if (error) return false;
    const s = useConvStore.getState();
    s.patch({
      conversations: s.conversations.filter((c) => c.id !== conversationId),
      messages: s.messages.filter((m) => m.conversationId !== conversationId),
    });
    return true;
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
    const { data, error } = await supabase
      .from("conversations")
      .insert({ location_id: location, contact_id: contactId, channel })
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
