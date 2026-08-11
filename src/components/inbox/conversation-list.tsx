"use client";

import { useState } from "react";
import { ArrowUpDown, Plus, Search, Star } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChannelIcon } from "@/components/shared/channel-icon";
import { SlaBadge } from "@/components/shared/sla-badge";
import { contactName } from "@/lib/data/repos/contacts";
import { useDbContacts } from "@/lib/data/repos/db/contacts";
import {
  conversationActions,
  useConversations,
  useRealtimeStatus,
  type ConversationFilter,
} from "@/lib/data/repos/db/conversations";
import { cn } from "@/lib/utils";

const FILTER_TABS: { key: ConversationFilter; label: string }[] = [
  { key: "unread", label: "Não lidos" },
  { key: "all", label: "Todos" },
  { key: "recent", label: "Recentes" },
  { key: "starred", label: "Marcados" },
];

const SORT_OPTIONS = [
  "Mais recentes · Todas as mensagens",
  "Mais antigas · Todas as mensagens",
  "Mais recentes · Mensagens manuais",
  "Mais antigas · Mensagens manuais",
  "Maior atraso de SLA",
  "Próxima meta de SLA",
];

export function ConversationList({
  selectedId,
  onSelect,
  onNew,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew?: () => void;
}) {
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [sort, setSort] = useState(SORT_OPTIONS[0]);
  const [query, setQuery] = useState("");
  const conversations = useConversations(filter);
  const { contacts } = useDbContacts();
  const realtime = useRealtimeStatus();
  const unreadCount = useConversations("unread").length;

  const sorted =
    sort === "Maior atraso de SLA"
      ? [...conversations].sort((a, b) => b.slaDays - a.slaDays)
      : sort === "Mais antigas · Todas as mensagens" || sort === "Mais antigas · Mensagens manuais"
        ? [...conversations].reverse()
        : conversations;

  const q = query.trim().toLowerCase();
  const visible = q
    ? sorted.filter((conv) => {
        const c = contacts.find((x) => x.id === conv.contactId);
        const name = c ? `${c.firstName} ${c.lastName}`.toLowerCase() : "";
        return name.includes(q) || (conv.lastMessagePreview ?? "").toLowerCase().includes(q);
      })
    : sorted;

  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col border-r bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
          Caixa de entrada
          {realtime === "on" && (
            <span
              title="Realtime conectado — mensagens chegam ao vivo"
              className="flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> Ao vivo
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1">
        <button
          onClick={onNew}
          title="Nova conversa"
          className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"
        >
          <Plus className="size-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100" />
            }
          >
            <ArrowUpDown className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {SORT_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt}
                onClick={() => setSort(opt)}
                className={cn("text-xs", sort === opt && "font-bold text-indigo-600")}
              >
                {opt}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>
      <div className="flex gap-1 border-b px-2 py-1.5">
        {FILTER_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium",
              filter === t.key
                ? "bg-indigo-100 text-indigo-700"
                : "text-slate-500 hover:bg-slate-100"
            )}
          >
            {t.label}
            {t.key === "unread" && unreadCount > 0 && (
              <span className="rounded-full bg-indigo-500 px-1.5 text-[9px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="border-b px-2 py-1.5">
        <div className="flex items-center gap-1.5 rounded-md border px-2">
          <Search className="size-3.5 text-slate-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome ou mensagem"
            className="h-7 border-0 p-0 text-xs shadow-none focus-visible:ring-0"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        {visible.map((conv) => {
          const contact = contacts.find((c) => c.id === conv.contactId);
          if (!contact) return null;
          return (
            <button
              key={conv.id}
              onClick={() => {
                onSelect(conv.id);
                conversationActions.markRead(conv.id);
              }}
              className={cn(
                "flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left hover:bg-slate-50",
                selectedId === conv.id && "bg-indigo-50/70"
              )}
            >
              <div className="relative shrink-0">
                <Avatar className="size-9">
                  <AvatarFallback className="bg-slate-200 text-[11px] font-bold text-slate-600">
                    {(contact.firstName[0] ?? "?").toUpperCase()}
                    {(contact.lastName[0] ?? "").toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute -bottom-0.5 -right-0.5">
                  <ChannelIcon channel={conv.channel} size={14} />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-semibold text-slate-800">
                    {contactName(contact)}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <SlaBadge days={conv.slaDays} />
                    {conv.unreadCount > 0 && (
                      <span className="rounded-full bg-indigo-500 px-1.5 text-[9px] font-bold text-white">
                        {conv.unreadCount}
                      </span>
                    )}
                  </span>
                </div>
                <p className="truncate text-[11px] text-slate-500">{conv.lastMessagePreview}</p>
              </div>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  conversationActions.star(conv.id);
                }}
                className="mt-0.5 shrink-0"
              >
                <Star
                  className={cn(
                    "size-3.5",
                    conv.starred ? "fill-amber-400 text-amber-400" : "text-slate-300"
                  )}
                />
              </span>
            </button>
          );
        })}
        {sorted.length === 0 && (
          <p className="p-6 text-center text-xs text-slate-400">Nenhuma conversa neste filtro</p>
        )}
      </div>
    </div>
  );
}
