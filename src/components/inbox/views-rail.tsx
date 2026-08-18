"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bot, Eye, Plus, Search, Trash2, User, Users, WifiOff } from "lucide-react";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { contactName } from "@/lib/data/repos/contacts";
import { useDbContacts } from "@/lib/data/repos/db/contacts";
import {
  conversationActions,
  inboxViewActions,
  useConvStore,
  useConversations,
  useInboxViews,
} from "@/lib/data/repos/db/conversations";
import { cn } from "@/lib/utils";
import { currentViewConfig, useInboxUi } from "./inbox-filters";
import type { InboxScope } from "@/lib/data/types";

import { useConfirm } from "@/components/shared/confirm";
export type { InboxScope } from "@/lib/data/types";

function RailButton({
  icon: Icon,
  label,
  onClick,
  active,
  badge,
}: {
  icon: typeof User;
  label: string;
  onClick?: () => void;
  active?: boolean;
  badge?: number;
}) {
  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              onClick={onClick}
              aria-pressed={active}
              className={cn(
                "flex size-8 items-center justify-center rounded-md",
                active ? "bg-indigo-100 text-indigo-600" : "text-slate-400 hover:bg-slate-100"
              )}
            />
          }
        >
          <Icon className="size-4" />
        </TooltipTrigger>
        <TooltipContent side="right" className="text-[11px]">
          {label}
        </TooltipContent>
      </Tooltip>
      {badge ? (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </div>
  );
}

/* ---------- Busca global (procura no texto de todas as mensagens) ---------- */

interface SearchHit {
  conversationId: string;
  name: string;
  excerpt: string;
  at: string;
  matchedMessage: boolean;
}

/** Recorta ~70 caracteres em volta do trecho encontrado. */
function excerptAround(body: string, term: string) {
  const i = body.toLowerCase().indexOf(term);
  if (i < 0) return body.slice(0, 70);
  const start = Math.max(0, i - 25);
  const end = Math.min(body.length, i + term.length + 45);
  return `${start > 0 ? "…" : ""}${body.slice(start, end)}${end < body.length ? "…" : ""}`;
}

function GlobalSearch({ onSelect }: { onSelect: (conversationId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const conversations = useConversations();
  const messages = useConvStore((s) => s.messages);
  const { contacts } = useDbContacts();

  const hits = useMemo<SearchHit[]>(() => {
    const q = term.trim().toLowerCase();
    if (q.length < 2) return [];

    const convById = new Map(conversations.map((c) => [c.id, c]));
    const nameOf = (contactId: string) => {
      const c = contacts.find((x) => x.id === contactId);
      return c ? contactName(c) : "Contato";
    };

    const out: SearchHit[] = [];
    const seen = new Set<string>();

    // 1) mensagens que contêm o termo (o que a busca da lista não alcança)
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m.body || !m.body.toLowerCase().includes(q)) continue;
      if (seen.has(m.conversationId)) continue;
      const conv = convById.get(m.conversationId);
      if (!conv) continue;
      seen.add(conv.id);
      out.push({
        conversationId: conv.id,
        name: nameOf(conv.contactId),
        excerpt: excerptAround(m.body, q),
        at: m.at,
        matchedMessage: true,
      });
    }

    // 2) conversas cujo contato bate com o termo
    for (const conv of conversations) {
      if (seen.has(conv.id)) continue;
      if (!nameOf(conv.contactId).toLowerCase().includes(q)) continue;
      seen.add(conv.id);
      out.push({
        conversationId: conv.id,
        name: nameOf(conv.contactId),
        excerpt: conv.lastMessagePreview || "Sem mensagens",
        at: conv.lastMessageAt,
        matchedMessage: false,
      });
    }

    return out.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, 25);
  }, [term, messages, conversations, contacts]);

  const q = term.trim();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        title="Buscar em todas as conversas"
        render={
          <button className="flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100" />
        }
      >
        <Search className="size-4" />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-80 gap-2 p-2">
        <div className="flex items-center gap-1.5 rounded-md border px-2">
          <Search className="size-3.5 text-slate-400" />
          <Input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar em todas as mensagens"
            className="h-7 border-0 p-0 text-xs shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-80 overflow-y-auto [scrollbar-width:thin]">
          {q.length < 2 ? (
            <p className="px-1 py-3 text-center text-[11px] text-slate-400">
              Digite ao menos 2 letras — procura no texto de todas as conversas.
            </p>
          ) : hits.length === 0 ? (
            <p className="px-1 py-3 text-center text-[11px] text-slate-400">
              Nada encontrado para “{q}”.
            </p>
          ) : (
            hits.map((h) => (
              <button
                key={h.conversationId}
                onClick={() => {
                  onSelect(h.conversationId);
                  void conversationActions.markRead(h.conversationId);
                  setOpen(false);
                  setTerm("");
                }}
                className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-slate-800">{h.name}</span>
                  {h.at && (
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {format(new Date(h.at), "dd/MM", { locale: ptBR })}
                    </span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-slate-500">{h.excerpt}</span>
              </button>
            ))
          )}
        </div>
        {hits.length > 0 && (
          <p className="px-1 text-[10px] text-slate-400">
            {hits.length} conversa{hits.length > 1 ? "s" : ""} · clique para abrir
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ---------- Visualizações salvas (reais, tabela inbox_views) ---------- */

function SavedViews() {
  const confirm = useConfirm();
  const views = useInboxViews();
  const { activeViewId, applyView } = useInboxUi();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? views.filter((v) => v.name.toLowerCase().includes(q)) : views;
  }, [views, filter]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Dê um nome à visualização");
      return;
    }
    setSaving(true);
    const ok = await inboxViewActions.add(trimmed, currentViewConfig());
    setSaving(false);
    if (!ok) {
      toast.error("Não foi possível salvar a visualização");
      return;
    }
    toast.success(`Visualização “${trimmed}” salva`);
    setName("");
    setCreating(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        title="Visualizações salvas"
        render={
          <button
            className={cn(
              "flex size-8 items-center justify-center rounded-md",
              activeViewId ? "bg-indigo-100 text-indigo-600" : "text-slate-400 hover:bg-slate-100"
            )}
          />
        }
      >
        <Eye className="size-4" />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-64 gap-2 p-2">
        <p className="px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          Visualizações
        </p>
        {views.length > 3 && (
          <div className="flex items-center gap-1.5 rounded-md border px-2">
            <Search className="size-3 text-slate-400" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Pesquisar"
              className="h-6 border-0 p-0 text-xs shadow-none focus-visible:ring-0"
            />
          </div>
        )}

        {creating ? (
          <div className="space-y-1.5">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void save()}
              placeholder="Nome da visualização"
              className="h-7 text-xs"
            />
            <p className="text-[10px] leading-tight text-slate-400">
              Guarda o escopo, a aba, a ordenação e a busca desta caixa agora.
            </p>
            <div className="flex gap-1.5">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-md bg-indigo-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-60"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setName("");
                }}
                className="rounded-md px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
          >
            <Plus className="size-3" /> Salvar visualização atual
          </button>
        )}

        <div className="max-h-64 overflow-y-auto [scrollbar-width:thin]">
          {views.length === 0 ? (
            <p className="px-1 py-2 text-[11px] leading-tight text-slate-400">
              Nenhuma visualização ainda. Ajuste os filtros da caixa e salve para voltar a
              ela com um clique.
            </p>
          ) : visible.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-slate-400">Nenhuma com esse nome.</p>
          ) : (
            visible.map((v) => (
              <div
                key={v.id}
                className={cn(
                  "group flex items-center gap-1 rounded-md",
                  activeViewId === v.id ? "bg-indigo-50" : "hover:bg-slate-50"
                )}
              >
                <button
                  onClick={() => {
                    applyView(v.id, v.config);
                    setOpen(false);
                  }}
                  className={cn(
                    "min-w-0 flex-1 truncate px-2 py-1 text-left text-xs",
                    activeViewId === v.id ? "font-semibold text-indigo-700" : "text-slate-700"
                  )}
                >
                  {v.name}
                </button>
                <button
                  onClick={async () => {
                    if (!(await confirm({ title: `Excluir a visualização "${v.name}"?`, confirmLabel: "Excluir", destructive: true }))) return;
                    (await inboxViewActions.remove(v.id))
                      ? toast.success("Visualização excluída")
                      : toast.error("Não foi possível excluir");
                  }}
                  title="Excluir"
                  className="mr-1 shrink-0 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ---------- Rail ---------- */

export function ViewsRail({
  onNew,
  onSelectConversation,
}: {
  onNew?: () => void;
  onSelectConversation: (conversationId: string) => void;
}) {
  const { scope, setScope } = useInboxUi();
  const pick = (next: InboxScope) => setScope(next);
  const conversations = useConversations();
  const { me } = useMyMembership();
  const offlineCount = useMemo(
    () => conversations.filter((c) => c.assignedOffline && c.assignedTo === me?.userId).length,
    [conversations, me?.userId],
  );

  return (
    <div className="flex h-full w-12 shrink-0 flex-col items-center gap-1 border-r bg-white py-2">
      <button
        onClick={onNew}
        title="Nova conversa"
        className="mb-1 flex size-8 items-center justify-center rounded-md bg-indigo-500 text-white hover:bg-indigo-600"
      >
        <Plus className="size-4" />
      </button>
      <GlobalSearch onSelect={onSelectConversation} />
      <RailButton
        icon={User}
        label="Atribuídas a mim"
        active={scope === "mine"}
        onClick={() => pick("mine")}
      />
      <RailButton
        icon={Users}
        label="Caixa de entrada do grupo"
        active={scope === "group"}
        onClick={() => pick("group")}
      />
      <RailButton
        icon={Bot}
        label="Conversas com automação"
        active={scope === "bot"}
        onClick={() => pick("bot")}
      />
      <RailButton
        icon={WifiOff}
        label="Recebidas enquanto eu estava offline"
        active={scope === "offline"}
        onClick={() => pick("offline")}
        badge={offlineCount}
      />
      <SavedViews />
    </div>
  );
}
