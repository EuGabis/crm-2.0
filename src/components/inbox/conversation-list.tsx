"use client";

import { useCallback, useMemo, useState } from "react";
import { differenceInCalendarDays, format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
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
/**
 * Quando foi a última mensagem, do jeito que o WhatsApp escreve.
 *
 * Antes não havia nada: era preciso ABRIR a conversa para saber se a última
 * mensagem foi de agora ou do mês passado. Numa lista ordenada por atividade,
 * isso deixava a coluna toda igual.
 *
 * A escala é proposital: hoje mostra a HORA (o que importa é "há quanto tempo"),
 * ontem e a semana mostram o DIA (a hora exata já não muda a decisão) e o resto
 * mostra a data. Escrever "25/08/2026 14:32" em tudo ocuparia o dobro do espaço
 * dizendo menos.
 */
function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (isToday(d)) return format(d, "HH:mm");
  if (isYesterday(d)) return "ontem";
  // Até 6 dias atrás o dia da semana é mais legível que a data ("sáb" > "23/08").
  if (differenceInCalendarDays(new Date(), d) < 7) {
    return format(d, "EEE", { locale: ptBR }).replace(".", "");
  }
  // Ano diferente entra na conta: "12/03" de outro ano seria enganoso.
  if (d.getFullYear() !== new Date().getFullYear()) return format(d, "dd/MM/yy");
  return format(d, "dd/MM");
}

import { ChannelIcon } from "@/components/shared/channel-icon";
import { SlaBadge } from "@/components/shared/sla-badge";
import { contactName } from "@/lib/data/repos/contacts";
import { TagPicker } from "@/components/contacts/tag-picker";
import { etiquetasVisiveis, useContactTags } from "@/lib/data/repos/db/tags";
import { temperaturaDe, useDesfechos, type Temperatura } from "@/lib/data/repos/db/bot-desfechos";
import {
  conversationActions,
  useAutomatedConversationIds,
  useConversations,
  useInboxViews,
  useRealtimeStatus,
} from "@/lib/data/repos/db/conversations";
import { useMyMembership, useTeam } from "@/lib/data/repos/db/team";
import { useWhatsappChannels } from "@/lib/data/repos/db/whatsapp";
import { cn } from "@/lib/utils";
import { SORT_OPTIONS, scopeLabel, statusLabel, useInboxUi } from "./inbox-filters";
import { BulkTemplateDialog, type BulkTarget } from "./bulk-template-dialog";
import type { Contact, ConversationFilter, InboxStatusView } from "@/lib/data/types";

const FILTER_TABS: { key: ConversationFilter; label: string }[] = [
  { key: "unread", label: "Não lidos" },
  { key: "all", label: "Todos" },
  { key: "recent", label: "Recentes" },
  { key: "starred", label: "Marcados" },
];

const STATUS_VIEWS: InboxStatusView[] = ["abertas", "finalizadas", "arquivadas", "todas"];

/**
 * O selo de temperatura do lead na linha da conversa.
 *
 * 🔴 **Os DOIS aparecem** (pedido do Gabriel, 2026-09-09). A versão anterior
 * mostrava só o FRIO, com este argumento: "marcar o quente também faria toda
 * linha ter um selo, e aí nenhuma se destaca".
 *
 * ⚠️ O argumento partia de uma premissa errada — a de que sem o selo a linha
 * seria "quente". Não é: **a maioria das conversas não tem nota nenhuma.** Só o
 * fluxo Comercial pontua; o da secretaria decide por assunto e grava
 * `pontos`/`limiar` nulos. Então nem toda linha ganha selo, e o que a ausência
 * dele passa a dizer é preciso: *o bot não pontuou esta conversa* — antes ela
 * misturava isso com "é quente", que são coisas opostas para quem prioriza.
 *
 * ⚠️ A distinção é por PALAVRA e por cor, nunca só pela cor: verde e azul a 9px
 * de altura, num selo de uma palavra, é exatamente o par que a deuteranopia
 * embaralha. O texto é a codificação secundária.
 *
 * As cores são as mesmas do relatório "Leads do dia" (esmeralda = qualificado,
 * azul = frio) — a caixa e o relatório não podem discordar sobre qual cor é o
 * lead bom. Todas com remapeamento de dark em `globals.css` (conferido:
 * `bg-emerald-50`, `text-emerald-700`, `border-emerald-200` e as irmãs em sky).
 */
function SeloTemperatura({ t }: { t: Temperatura }) {
  if (!t) return null;
  const frio = t === "frio";
  return (
    <span
      title={
        frio
          ? "O bot pontuou abaixo do limiar — atenda, mas não é prioridade"
          : "O bot pontuou na meta ou acima — lead qualificado, priorize"
      }
      className={cn(
        "shrink-0 rounded border px-1 text-[9px] font-semibold uppercase tracking-wide",
        frio
          ? "border-sky-200 bg-sky-50 text-sky-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700"
      )}
    >
      {frio ? "Frio" : "Quente"}
    </span>
  );
}

/**
 * As etiquetas do contato na linha da conversa.
 *
 * ⚠️ No MÁXIMO duas, e o resto vira "+N": a lista tem ~300px e contato com seis
 * etiquetas empurraria a prévia da mensagem para fora — a prévia é o que faz
 * decidir se abre a conversa. Vêm do join (`contactTags`), não de baixar os 41
 * mil contatos.
 *
 * 🔴 Passam por `etiquetasVisiveis` antes de aparecer. Sem isso a linha mostrava
 * `lito-avioes-e-musicas_export...` duas vezes e a etiqueta que o vendedor
 * marcou ficava escondida no "+2" — que é o print do relato.
 */
function EtiquetasDaLinha({
  tags,
  catalogo,
  ok,
}: {
  tags?: string[] | null;
  catalogo: { name: string }[];
  ok: boolean;
}) {
  const etiquetas = useMemo(() => etiquetasVisiveis(tags, catalogo, ok), [tags, catalogo, ok]);
  if (etiquetas.length === 0) return null;
  const titulo = etiquetas.join(" · ");
  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      {etiquetas.slice(0, 2).map((t) => (
        <span
          key={t}
          title={titulo}
          className="max-w-[120px] truncate rounded border border-slate-200 bg-slate-50 px-1 text-[9px] font-medium text-slate-600"
        >
          {t}
        </span>
      ))}
      {etiquetas.length > 2 && (
        <span title={titulo} className="text-[9px] font-medium text-slate-400">
          +{etiquetas.length - 2}
        </span>
      )}
    </div>
  );
}

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
  // Filtro por RESPONSÁVEL (só admin): "__none__" = sem responsável.
  const [userFilter, setUserFilter] = useState<string | null>(null);
  /*
   * Filtro por ETIQUETA, e este é de TODO MUNDO — o pedido foi o vendedor
   * filtrar a PRÓPRIA caixa. Vazio = sem filtro. Várias etiquetas mostram quem
   * tem QUALQUER uma delas (decisão do Gabriel): o uso principal é juntar
   * categorias irmãs, como os cinco "INTERESSADO ...".
   */
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  /*
   * Temperatura do lead, do nó `score` do bot. null = sem filtro.
   *
   * ⚠️ Só o fluxo COMERCIAL pontua — o da secretaria decide por assunto e grava
   * `pontos`/`limiar` nulos. Nas conversas da secretaria não há temperatura, e o
   * selo simplesmente não aparece; chamá-las todas de quentes seria inventar uma
   * nota que ninguém deu.
   */
  const [tempFilter, setTempFilter] = useState<"frio" | "quente" | null>(null);
  const desfechos = useDesfechos();
  // O catálogo decide o que é etiqueta: `contacts.tags` traz junto o carimbo
  // da importação, que é o que ocupava as duas vagas da linha.
  const { tags: catalogo, loaded: catalogoOk } = useContactTags();
  const { channels } = useWhatsappChannels();
  const all = useConversations(filter);
  const realtime = useRealtimeStatus();
  const { me, isAdmin } = useMyMembership();
  const { members } = useTeam();
  const unreadRaw = useConversations("unread");
  const automatedIds = useAutomatedConversationIds();
  const views = useInboxViews();
  const activeView = views.find((v) => v.id === activeViewId) ?? null;
  const todas = useConversations("all");

  /**
   * Recorte de NÚMERO e RESPONSÁVEL, num lugar só.
   *
   * 🔴 Estava escrito inline dentro da lista e em nenhum dos contadores. O
   * resultado, relatado em 2026-09-09: escolher um responsável filtrava a lista
   * certo e o selo de "Não lidos" continuava marcando **96** — o total da
   * empresa. O número ao lado da aba contradizia a própria lista embaixo dele.
   *
   * ⚠️ Um recorte que vale para a lista tem de valer para TODO número que
   * acompanha a lista. Como função, é impossível a lista e o contador
   * discordarem; escrito duas vezes, discordar é o padrão — o mesmo raciocínio
   * que fez `aplicarFiltros` existir na aba de Atendimento.
   */
  const aplicaRecorte = useCallback(
    <
      T extends {
        channelId?: string | null;
        assignedTo?: string | null;
        contactTags?: string[] | null;
        id?: string;
      },
    >(
      lista: T[]
    ): T[] => {
      let r = channelFilter ? lista.filter((c) => c.channelId === channelFilter) : lista;
      // "__none__" = sem responsável, que é diferente de "sem filtro".
      if (userFilter === "__none__") r = r.filter((c) => !c.assignedTo);
      else if (userFilter) r = r.filter((c) => c.assignedTo === userFilter);
      // Etiqueta: QUALQUER uma das marcadas (união, não interseção).
      if (tagFilter.length) {
        /*
         * ⚠️ Compara SEM diferenciar maiúsculas. O catálogo é único por
         * `lower(name)`, então o contato pode estar marcado como "interessado
         * pp" e o filtro pedir "INTERESSADO PP" — a MESMA etiqueta. Com
         * `includes` de texto cru, o filtro devolvia "Nenhuma conversa neste
         * filtro" com as conversas ali, marcadas.
         */
        const alvo = new Set(tagFilter.map((t) => t.trim().toLowerCase()));
        r = r.filter((c) => (c.contactTags ?? []).some((t) => alvo.has(t.trim().toLowerCase())));
      }
      // Temperatura: quem não tem nota fica de fora dos DOIS recortes — não é
      // frio nem quente, é "o bot não pontuou".
      if (tempFilter) {
        r = r.filter((c) => (c.id ? temperaturaDe(desfechos.get(c.id)) : null) === tempFilter);
      }
      return r;
    },
    [channelFilter, userFilter, tagFilter, tempFilter, desfechos]
  );

  // Não lidas que ainda pedem ação (finalizada/arquivada não conta) DENTRO do escopo
  // atual — senão o badge conta uma conversa que a lista escopada não mostra.
  const unreadCount = useMemo(() => {
    const open = unreadRaw.filter((c) => !c.closedAt && !c.archivedAt);
    const scoped =
      scope === "mine"
        ? open.filter((c) => c.assignedTo === me?.userId)
        : scope === "offline"
          ? open.filter((c) => c.assignedOffline && c.assignedTo === me?.userId)
          : scope === "bot"
            ? open.filter((c) => automatedIds.has(c.id))
            : open;
    return aplicaRecorte(scoped).length;
  }, [unreadRaw, scope, me?.userId, automatedIds, aplicaRecorte]);

  // Contagem por pilha, mostrada no seletor — evita clicar em "Arquivadas" para
  // descobrir que está vazio. Respeita o mesmo recorte, pelo mesmo motivo do
  // selo de não lidas: "Abertas 12" com um responsável escolhido significa 12
  // DELE, senão o seletor descreve uma lista que não está na tela.
  const statusCounts = useMemo(() => {
    const r = aplicaRecorte(todas);
    return {
      abertas: r.filter((c) => !c.closedAt && !c.archivedAt).length,
      finalizadas: r.filter((c) => !!c.closedAt).length,
      arquivadas: r.filter((c) => !!c.archivedAt).length,
      todas: r.length,
    };
  }, [todas, aplicaRecorte]);

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
    const list =
      scope === "mine"
        ? byStatus.filter((c) => c.assignedTo === me?.userId)
        : scope === "offline"
          ? // Aba Offline = leads recebidos offline AINDA em aberto (não aplica a
            // aba Não lidos/Recentes, mas exclui finalizada/arquivada — lead fechado
            // já foi tratado, não é "fantasma" no badge).
            todas.filter(
              (c) =>
                c.assignedOffline &&
                c.assignedTo === me?.userId &&
                !c.closedAt &&
                !c.archivedAt
            )
          : scope === "bot"
            ? byStatus.filter((c) => automatedIds.has(c.id))
            : byStatus;
    // Número e responsável saem da MESMA função que os contadores usam.
    return aplicaRecorte(list);
  }, [all, todas, status, scope, me?.userId, automatedIds, aplicaRecorte]);

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
          return {
            conversationId: conv.id,
            contactName:
              `${conv.contactFirstName ?? "Contato"} ${conv.contactLastName ?? ""}`.trim(),
            channelId: conv.channel === "whatsapp" ? conv.channelId ?? null : null,
          };
        })
        .filter((t): t is BulkTarget => !!t),
    [selected, todas]
  );

  const q = query.trim().toLowerCase();
  const visible = q
    ? sorted.filter((conv) => {
        const name = `${conv.contactFirstName ?? ""} ${conv.contactLastName ?? ""}`.toLowerCase();
        return (
          name.includes(q) ||
          (conv.contactPhone ?? "").includes(q) ||
          (conv.lastMessagePreview ?? "").toLowerCase().includes(q)
        );
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
      {isAdmin && members.length > 0 && (
        <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Responsável
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button className="flex min-w-0 flex-1 items-center justify-between gap-1 rounded-md border px-2 py-1 text-[11px] hover:bg-slate-50" />
              }
            >
              <span className="truncate text-slate-700">
                {userFilter === "__none__"
                  ? "Sem responsável"
                  : userFilter
                    ? members.find((m) => m.userId === userFilter)?.name ?? "Responsável"
                    : "Todos"}
              </span>
              <ChevronDown className="size-3 shrink-0 text-slate-400" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 w-60 overflow-y-auto">
              <DropdownMenuItem
                className={cn("text-xs", !userFilter && "font-bold text-indigo-600")}
                onClick={() => setUserFilter(null)}
              >
                Todos
              </DropdownMenuItem>
              <DropdownMenuItem
                className={cn("text-xs", userFilter === "__none__" && "font-bold text-indigo-600")}
                onClick={() => setUserFilter("__none__")}
              >
                Sem responsável
              </DropdownMenuItem>
              {members.map((m) => (
                <DropdownMenuItem
                  key={m.userId}
                  className={cn("text-xs", userFilter === m.userId && "font-bold text-indigo-600")}
                  onClick={() => setUserFilter(m.userId)}
                >
                  {m.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {/* Etiquetas: para TODO MUNDO, não só admin — é o filtro que o vendedor
          usa na própria caixa. */}
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Etiquetas
        </span>
        <TagPicker
          value={tagFilter}
          onChange={setTagFilter}
          placeholder="Todas"
          className="h-[26px] min-w-0 flex-1 text-[11px]"
        />
      </div>
      {/* Temperatura. Três botões, sem menu: são poucos, a troca é comparativa,
          e escondido num dropdown o vendedor esquece que o recorte existe. */}
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Lead
        </span>
        <div className="flex gap-1">
          {([null, "frio", "quente"] as const).map((t) => (
            <button
              key={t ?? "todos"}
              onClick={() => setTempFilter(t)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px]",
                tempFilter === t
                  ? "border-indigo-200 bg-indigo-50 font-semibold text-indigo-700"
                  : "text-slate-600 hover:bg-slate-50"
              )}
            >
              {t === null ? "Todos" : t === "frio" ? "Frio" : "Quente"}
            </button>
          ))}
        </div>
      </div>
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
          // Fallback: se o contato ainda não carregou/não é visível, a linha NÃO
          // pode sumir (senão a conversa não aparece). Mostra "Contato" até vir.
          // Nome/telefone vêm DENORMALIZADOS na conversa (join no load) — sem
          // depender da lista cheia de contatos na store.
          const contact = {
            id: conv.contactId,
            firstName: conv.contactFirstName || "Contato",
            lastName: conv.contactLastName || "",
            phone: conv.contactPhone || "",
            email: conv.contactEmail || "",
          } as unknown as Contact;
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
                    <SeloTemperatura t={temperaturaDe(desfechos.get(conv.id))} />
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <SlaBadge days={conv.slaDays} />
                    {/* Horário na primeira linha e contador na segunda — a
                        divisão do WhatsApp. Com os dois juntos aqui, o nome do
                        contato perdia espaço e truncava cedo. */}
                    <span
                      className={cn(
                        "shrink-0 text-[10px]",
                        conv.unreadCount > 0 ? "font-semibold text-indigo-600" : "text-slate-400"
                      )}
                    >
                      {quando(conv.lastMessageAt)}
                    </span>
                  </span>
                </div>
                {/* Etiquetas do contato, na própria linha.
                    ⚠️ No MÁXIMO duas, e o resto vira "+N": a lista tem ~300px e
                    contato com seis etiquetas empurraria a prévia da mensagem
                    para fora — a prévia é o que faz decidir se abre a conversa.
                    Vêm do join (`contactTags`), não de baixar os 41 mil. */}
                <EtiquetasDaLinha tags={conv.contactTags} catalogo={catalogo} ok={catalogoOk} />
                <div className="flex items-center justify-between gap-1">
                  <p className="truncate text-[11px] text-slate-500">{conv.lastMessagePreview}</p>
                  {conv.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-indigo-500 px-1.5 text-[9px] font-bold text-white">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>
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
                : scope === "offline"
                  ? "Nenhum lead recebido enquanto você estava offline. Quando todos do rodízio estiverem fora, os leads caem aqui até você abri-los."
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
