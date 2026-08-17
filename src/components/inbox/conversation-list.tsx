"use client";

import { useMemo, useState } from "react";
import {
  Archive,
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ListChecks,
  Plus,
  Search,
  Star,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
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
  useAutomatedConversationIds,
  useConversations,
  useInboxViews,
  useRealtimeStatus,
} from "@/lib/data/repos/db/conversations";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { useWhatsappChannels } from "@/lib/data/repos/db/whatsapp";
import { cn } from "@/lib/utils";
import { SORT_OPTIONS, scopeLabel, statusLabel, useInboxUi } from "./inbox-filters";
import { BulkTemplateDialog, type BulkTarget } from "./bulk-template-dialog";
import type { ConversationFilter, InboxStatusView } from "@/lib/data/types";

const FILTER_TABS: { key: ConversationFilter; label: string }[] = [
  { key: "unread", label: "Não lidos" },
  { key: "all", label: "Todos" },
  { key: "recent", label: "Recentes" },
  { key: "starred", label: "Marcados" },
];

const STATUS_VIEWS: InboxStatusView[] = ["abertas", "finalizadas", "arquivadas", "todas"];

export function ConversationList({
  selectedId,
  onSelect,
  onNew,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew?: () => void;
}) {
  const {
    scope,
    filter,
    sort,
    query,
    status,
    activeViewId,
    setFilter,
    setSort,
    setQuery,
    setStatus,
    reset,
  } = useInboxUi();
  // Seleção múltipla: fica local porque só a própria lista (checkbox, barra de
  // ações) mexe nela — ao contrário dos filtros, que o rail também controla.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [templateOpen, setTemplateOpen] = useState(false);
  // Filtro por NÚMERO: separa as caixas dos dois números pra não colidirem.
  // null = todos os números.
  const [channelFilter, setChannelFilter] = useState<string | null>(null);
  const { channels } = useWhatsappChannels();
  const all = useConversations(filter);
  const { contacts } = useDbContacts();
  const realtime = useRealtimeStatus();
  const { me } = useMyMembership();
  // Não lidas que ainda pedem ação: finalizada ou arquivada não conta.
  const unreadCount = useConversations("unread").filter(
    (c) => !c.closedAt && !c.archivedAt
  ).length;
  const automatedIds = useAutomatedConversationIds();
  const views = useInboxViews();
  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const todas = useConversations("all");

  // Contagem por pilha, mostrada no seletor — evita clicar em "Arquivadas" para
  // descobrir que está vazio.
  const statusCounts = useMemo(
    () => ({
      abertas: todas.filter((c) => !c.closedAt && !c.archivedAt).length,
      finalizadas: todas.filter((c) => !!c.closedAt).length,
      arquivadas: todas.filter((c) => !!c.archivedAt).length,
      todas: todas.length,
    }),
    [todas]
  );

  // O escopo do rail cruza com as abas (Não lidos/Todos/...) em vez de
  // substituí-las.
  const conversations = useMemo(() => {
    // Pilha primeiro (aberta/finalizada/arquivada), depois o escopo do rail.
    const byStatus = all.filter((c) => {
      if (status === "todas") return true;
      if (status === "finalizadas") return !!c.closedAt;
      if (status === "arquivadas") return !!c.archivedAt;
      return !c.closedAt && !c.archivedAt;
    });
    let list =
      scope === "mine"
        ? byStatus.filter((c) => c.assignedTo === me?.userId)
        : scope === "bot"
          ? byStatus.filter((c) => automatedIds.has(c.id))
          : byStatus;
    // Separa por número quando um está selecionado.
    if (channelFilter) list = list.filter((c) => c.channelId === channelFilter);
    return list;
  }, [all, status, scope, me?.userId, automatedIds, channelFilter]);

  const sorted =
    sort === "Maior atraso de SLA"
      ? [...conversations].sort((a, b) => b.slaDays - a.slaDays)
      : sort === "Mais antigas · Todas as mensagens" || sort === "Mais antigas · Mensagens manuais"
        ? [...conversations].reverse()
        : conversations;

  // Alvos do envio em lote. `channelId` null = conversa sem canal de WhatsApp
  // conectado (e-mail, Instagram, WhatsApp antigo) — o diálogo mostra essas
  // separadas em vez de tentar enviar e falhar.
  const targets: BulkTarget[] = useMemo(
    () =>
      [...selected]
        // Busca em `todas`, não na lista filtrada: se o usuário selecionar e
        // depois trocar de aba, o alvo sumiria da lista e o envio sairia com
        // menos conversas do que o contador mostra.
        .map((id) => {
          const conv = todas.find((c) => c.id === id);
          if (!conv) return null;
          const contact = contacts.find((x) => x.id === conv.contactId);
          return {
            conversationId: conv.id,
            contactName: contact ? contactName(contact) : "Contato",
            channelId: conv.channel === "whatsapp" ? conv.channelId ?? null : null,
          };
        })
        .filter((t): t is BulkTarget => !!t),
    [selected, todas, contacts]
  );

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
        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-slate-800">
          <DropdownMenu>
            <DropdownMenuTrigger
              title="Trocar entre abertas, finalizadas e arquivadas"
              render={
                <button className="flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-slate-100" />
              }
            >
              <span className="truncate">
                {activeView
                  ? activeView.name
                  : status === "abertas"
                    ? "Caixa de entrada"
                    : statusLabel[status]}
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              {STATUS_VIEWS.map((s) => (
                <DropdownMenuItem
                  key={s}
                  onClick={() => setStatus(s)}
                  className={cn("text-xs", status === s && "font-bold text-indigo-600")}
                >
                  {statusLabel[s]}
                  <span className="ml-auto text-[10px] font-normal text-slate-400">
                    {statusCounts[s]}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
          onClick={() => {
            setSelecting((v) => !v);
            setSelected(new Set());
          }}
          title="Selecionar várias conversas"
          className={cn(
            "flex size-7 items-center justify-center rounded-md",
            selecting ? "bg-indigo-100 text-indigo-600" : "text-slate-400 hover:bg-slate-100"
          )}
        >
          <ListChecks className="size-4" />
        </button>
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
      {(scope !== "group" || status !== "abertas" || activeView) && (
        <div className="flex items-center gap-1.5 border-b bg-indigo-50/60 px-3 py-1.5">
          <span className="truncate text-[11px] font-medium text-indigo-700">
            {[
              activeView ? `Visualização · ${activeView.name}` : null,
              scope !== "group" ? scopeLabel[scope] : null,
              status !== "abertas" ? statusLabel[status] : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <button
            onClick={reset}
            title="Voltar à caixa do grupo"
            className="ml-auto flex size-5 shrink-0 items-center justify-center rounded text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
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
      {channels.length > 1 && (
        <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Número
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button className="flex min-w-0 flex-1 items-center justify-between gap-1 rounded-md border px-2 py-1 text-[11px] hover:bg-slate-50" />
              }
            >
              <span className="truncate text-slate-700">
                {channelFilter
                  ? channels.find((c) => c.id === channelFilter)?.name ?? "Número"
                  : "Todos os números"}
              </span>
              <ChevronDown className="size-3 shrink-0 text-slate-400" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
              <DropdownMenuItem
                className={cn("text-xs", !channelFilter && "font-bold text-indigo-600")}
                onClick={() => setChannelFilter(null)}
              >
                Todos os números
              </DropdownMenuItem>
              {channels.map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  className={cn("text-xs", channelFilter === c.id && "font-bold text-indigo-600")}
                  onClick={() => setChannelFilter(c.id)}
                >
                  <span className="truncate">
                    {c.name}
                    {c.phoneE164 ? ` · ${c.phoneE164}` : ""}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {selecting && (
        <div className="flex items-center gap-2 border-b bg-slate-50 px-3 py-1.5">
          <Checkbox
            checked={visible.length > 0 && selected.size === visible.length}
            onCheckedChange={() =>
              setSelected(
                selected.size === visible.length ? new Set() : new Set(visible.map((c) => c.id))
              )
            }
            aria-label="Selecionar todas as conversas visíveis"
          />
          <span className="text-[11px] font-medium text-slate-600">
            {selected.size > 0 ? `${selected.size} selecionada${selected.size > 1 ? "s" : ""}` : "Selecionar"}
          </span>
          <button
            onClick={() => setTemplateOpen(true)}
            disabled={selected.size === 0}
            className="ml-auto rounded-md bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            Enviar template
          </button>
          <button
            onClick={() => {
              setSelecting(false);
              setSelected(new Set());
            }}
            title="Sair da seleção"
            className="flex size-5 items-center justify-center rounded text-slate-400 hover:bg-slate-200"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
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
            <div
              key={conv.id}
              className={cn(
                "flex w-full items-start border-b hover:bg-slate-50",
                selectedId === conv.id && "bg-indigo-50/70",
                selecting && selected.has(conv.id) && "bg-indigo-50"
              )}
            >
              {selecting && (
                <span className="flex shrink-0 items-center self-stretch pl-3">
                  <Checkbox
                    checked={selected.has(conv.id)}
                    onCheckedChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(conv.id)) next.delete(conv.id);
                        else next.add(conv.id);
                        return next;
                      })
                    }
                    aria-label={`Selecionar conversa com ${contactName(contact)}`}
                  />
                </span>
              )}
            <button
              onClick={() => {
                onSelect(conv.id);
                conversationActions.markRead(conv.id);
              }}
              className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5 text-left"
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
                  <span className="flex min-w-0 items-center gap-1">
                    {conv.closedAt && (
                      <CheckCircle2
                        className="size-3 shrink-0 text-emerald-500"
                        aria-label="Finalizada"
                      />
                    )}
                    {conv.archivedAt && (
                      <Archive className="size-3 shrink-0 text-slate-400" aria-label="Arquivada" />
                    )}
                    <span className="truncate text-xs font-semibold text-slate-800">
                      {contactName(contact)}
                    </span>
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
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="p-6 text-center text-[11px] leading-relaxed text-slate-400">
            {q
              ? `Nenhuma conversa com “${query.trim()}” neste filtro.`
              : status === "finalizadas"
                ? "Nenhuma conversa finalizada. Use “Finalizar” no cabeçalho da conversa quando o atendimento terminar."
                : status === "arquivadas"
                  ? "Nenhuma conversa arquivada. Arquivar tira a conversa da caixa sem excluir nada."
                  : scope === "mine"
                ? "Nenhuma conversa atribuída a você. Abra uma conversa e use “Atribuir” no cabeçalho."
                : scope === "bot"
                  ? "Nenhuma conversa tocada por automação ainda. Assim que um fluxo registrar nota ou responder um contato, a conversa aparece aqui."
                  : "Nenhuma conversa neste filtro"}
          </p>
        )}
      </div>
      <BulkTemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        targets={targets}
        onDone={() => {
          setSelected(new Set());
          setSelecting(false);
        }}
      />
    </div>
  );
}
