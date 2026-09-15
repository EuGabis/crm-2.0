"use client";

import { memo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import { format } from "date-fns";
import {
  Calendar,
  CheckSquare,
  FileText,
  MessageCircle,
  Phone,
  Tag,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LeadDetailDialog } from "@/components/pipeline/lead-detail-dialog";
import {
  dbContactActions,
  fetchContactById,
  useDbContact,
  useDbTeam,
} from "@/lib/data/repos/db/contacts";
import { conversationActions } from "@/lib/data/repos/db/conversations";
import { oppActions } from "@/lib/data/repos/db/pipeline";
import { taskActions } from "@/lib/data/repos/db/contacts-module";
import { appointmentActions } from "@/lib/data/repos/db/appointments";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { CURSOS } from "@/lib/data/cursos";
import type { Opportunity, User } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { telHref } from "@/lib/phone";

/**
 * Ações rápidas do card. Antes eram seis ícones que só chamavam
 * `stopPropagation()` — nenhum tinha ação. Agora cada um mexe no dado real do
 * contato dono da oportunidade. "Nota" grava um comentário interno na conversa,
 * que é onde o CRM já guarda nota (mesma coisa que a ação `nota-interna` das
 * automações faz).
 */

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Phone;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={label}
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            className="flex size-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          />
        }
      >
        <Icon className="size-3" />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-[10px]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Botão que abre um formulariozinho no lugar (tags, nota, tarefa, compromisso). */
function ActionPopover({
  icon: Icon,
  label,
  children,
  open,
  onOpenChange,
}: {
  icon: typeof Phone;
  label: string;
  children: React.ReactNode;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        title={label}
        aria-label={label}
        render={
          <button
            onClick={(e) => e.stopPropagation()}
            className="flex size-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          />
        }
      >
        <Icon className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-2 p-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}

function OpportunityCardBase({
  opportunity,
  owner,
  dragging,
  selected,
  onToggleSelect,
}: {
  opportunity: Opportunity;
  owner?: User;
  dragging?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: opportunity.id,
  });
  const router = useRouter();
  const team = useDbTeam();

  const [openAction, setOpenAction] = useState<string | null>(null);
  /**
   * 🔴 O que fazia a tela travar não era o arrasto: era o CUSTO DE CADA CARD.
   * Medido em produção: a fase "NOVO LEAD" do funil Controle de Leads tem
   * **1.518 cards**, e o funil inteiro 3.206 — todos montados de uma vez.
   *
   * `ativo` só liga quando o ponteiro ENTRA no card, e é o que destrava as 45
   * opções do seletor de curso. Montadas sempre, eram ~68 mil elementos
   * `<option>` numa coluna só; e o dnd-kit re-renderiza TODO draggable a cada
   * movimento do ponteiro, então esse DOM era repintado a cada pixel arrastado.
   */
  const [ativo, setAtivo] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [note, setNote] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [apptTitle, setApptTitle] = useState("");
  const [apptDate, setApptDate] = useState("");
  const [apptTime, setApptTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  /*
   * ⚠️ O contato só é buscado quando o popover de TAGS abre — é o único lugar
   * que precisa dele reativo (a lista de etiquetas). As outras ações usam
   * `opportunity.contactId`, que já está no card, ou buscam na hora do clique.
   */
  const { contact, refresh: recarregarContato } = useDbContact(
    openAction === "tag" ? opportunity.contactId : null
  );
  // Onde o dedo/ponteiro desceu. O PointerSensor do kanban só começa a arrastar
  // depois de 6px, mas o `click` do navegador dispara mesmo depois de um
  // arrasto que voltou para perto do começo — sem esta guarda, soltar o card na
  // mesma coluna abriria o detalhe sem ninguém ter pedido.
  const pressAt = useRef<{ x: number; y: number } | null>(null);

  const close = () => setOpenAction(null);

  /* ---- ações ---- */

  const call = async () => {
    // ⚠️ O telefone é buscado NO CLIQUE, não por hook: um `useDbContact` por
    // card custava uma consulta por card ao abrir o funil.
    const c = contact ?? (await fetchContactById(opportunity.contactId));
    if (!c?.phone?.trim()) {
      toast.error("Contato sem telefone cadastrado");
      return;
    }
    // Quem liga é o discador do APARELHO — o webphone do CRM foi removido por
    // prometer ligação sem ter provedor de voz.
    window.location.href = telHref(c.phone);
  };

  const openConversation = async () => {
    setBusy(true);
    // Reaproveita a conversa que o contato já tem — nunca abre um chat novo
    // por cima de um existente.
    const res = await conversationActions.openForContact(opportunity.contactId);
    setBusy(false);
    if (!res.id) {
      toast.error(res.error ?? "Não foi possível abrir a conversa");
      return;
    }
    router.push(`/conversas?c=${res.id}`);
  };

  const assignOwner = async (userId: string | null) => {
    const ok = await oppActions.assign(opportunity.id, userId);
    if (!ok) {
      toast.error("Não foi possível alterar o responsável");
      return;
    }
    const t = userId ? team.find((u) => u.id === userId)?.name ?? "usuário" : null;
    toast.success(t ? `Responsável: ${t}` : "Responsável removido");
  };

  const setCourse = async (course: string) => {
    const ok = await oppActions.setCourse(opportunity.id, course || null);
    if (!ok) {
      toast.error("Não foi possível salvar o curso");
      return;
    }
    toast.success(course ? `Curso: ${course}` : "Curso removido");
  };

  const addTag = async () => {
    const t = tagInput.trim();
    if (!t) return;
    setBusy(true);
    const ok = await dbContactActions.addTag([opportunity.contactId], t);
    setBusy(false);
    if (!ok) {
      toast.error("Não foi possível adicionar a tag");
      return;
    }
    toast.success(`Tag "${t}" adicionada ao contato`);
    setTagInput("");
    // ⚠️ O contato aqui vem de um fetch por id, não da store — `addTag` grava no
    // banco e na store, e sem esta recarga o popover continuaria mostrando a
    // lista de antes. Mesmo defeito que o seletor de etiquetas do composer teve.
    recarregarContato();
  };

  const removeTag = async (t: string) => {
    const ok = await dbContactActions.removeTag([opportunity.contactId], t);
    if (!ok) {
      toast.error("Não foi possível remover a tag");
      return;
    }
    toast.success(`Tag "${t}" removida`);
    recarregarContato();
  };

  const saveNote = async () => {
    const body = note.trim();
    if (!body) return;
    setBusy(true);
    const conversationId = (await conversationActions.openForContact(opportunity.contactId)).id;
    const ok =
      !!conversationId &&
      (
        await conversationActions.send(conversationId, {
          direction: "out",
          type: "text",
          channel: "whatsapp",
          body,
          internal: true,
        })
      ).ok;
    setBusy(false);
    if (!ok) {
      toast.error("Não foi possível salvar a nota");
      return;
    }
    toast.success("Nota interna registrada na conversa");
    setNote("");
    close();
  };

  const saveTask = async () => {
    const title = taskTitle.trim();
    if (!title) return;
    setBusy(true);
    const ok = await taskActions.add({
      title,
      contactId: opportunity.contactId,
      assigneeId: opportunity.ownerId ?? null,
      dueAt: taskDue ? new Date(`${taskDue}T09:00:00`).toISOString() : null,
    });
    setBusy(false);
    if (!ok) {
      toast.error("Não foi possível criar a tarefa");
      return;
    }
    toast.success("Tarefa criada — veja em Contatos → Tarefas");
    setTaskTitle("");
    setTaskDue("");
    close();
  };

  const saveAppointment = async () => {
    const title = apptTitle.trim();
    if (!title || !apptDate) {
      toast.error("Preencha título e data");
      return;
    }
    const start = new Date(`${apptDate}T${apptTime}:00`);
    setBusy(true);
    const ok = await appointmentActions.add({
      title,
      contactId: opportunity.contactId,
      start: start.toISOString(),
      end: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    });
    setBusy(false);
    if (!ok) {
      toast.error("Não foi possível agendar");
      return;
    }
    toast.success("Compromisso criado — veja em Calendários");
    setApptTitle("");
    setApptDate("");
    close();
  };

  return (
    /*
     * O CARD INTEIRO é o punho do arrasto. Antes só o "corpo" (título e os três
     * rótulos) arrastava, então era preciso acertar o nome do lead para mover —
     * a queixa que originou esta mudança.
     *
     * ⚠️ O que fazia os listeners no raiz "competirem" com a barra de ações não
     * era o arrasto: é que `stopPropagation` estava só no `onClick` dos
     * controles, e o gesto começa no `pointerdown`. Cada controle interno
     * (checkbox, avatar, seletor de curso, barra de ações) para a propagação
     * dos DOIS eventos — é o que deixa o resto do card livre para arrastar.
     */
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onPointerEnter={() => setAtivo(true)}
      onPointerDown={(e) => {
        pressAt.current = { x: e.clientX, y: e.clientY };
        setAtivo(true);
        listeners?.onPointerDown?.(e);
      }}
      onClick={(e) => {
        const from = pressAt.current;
        pressAt.current = null;
        if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 6) return;
        setDetailOpen(true);
      }}
      title="Arraste para mover · clique para ver os detalhes"
      style={
        transform
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
          : undefined
      }
      className={cn(
        "cursor-grab rounded-lg border bg-white p-2.5 shadow-sm transition-shadow hover:shadow active:cursor-grabbing",
        (isDragging || dragging) && "opacity-60 shadow-lg ring-2 ring-indigo-300",
        selected && "border-indigo-300 bg-indigo-50/60 ring-1 ring-indigo-300"
      )}
    >
      <div>
        <div className="flex items-start justify-between gap-2">
          {onToggleSelect && (
            // Fora do drag: marcar não pode arrastar o card junto.
            <span
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 shrink-0"
            >
              <Checkbox
                checked={!!selected}
                onCheckedChange={() => onToggleSelect(opportunity.id)}
                aria-label={`Selecionar ${opportunity.name}`}
                className="size-3.5"
              />
            </span>
          )}
          <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">
            {opportunity.name}
          </p>
          {/* Fora do gesto de arrastar: abrir o menu não pode mover o card. */}
          <span
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0"
          >
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    title={owner ? `Responsável: ${owner.name}` : "Atribuir responsável"}
                    className="rounded-full"
                  />
                }
              >
                {owner ? (
                  <Avatar className="size-5">
                    <AvatarFallback
                      className="text-[8px] font-bold text-white"
                      style={{ background: owner.color }}
                    >
                      {owner.name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <span className="flex size-5 items-center justify-center rounded-full border border-dashed text-slate-400 hover:border-indigo-300 hover:text-indigo-500">
                    <UserPlus className="size-3" />
                  </span>
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-64 w-48 overflow-y-auto">
                {team.map((u) => (
                  <DropdownMenuItem
                    key={u.id}
                    className="text-xs"
                    onClick={() => void assignOwner(u.id)}
                  >
                    {u.name}
                  </DropdownMenuItem>
                ))}
                {opportunity.ownerId && (
                  <DropdownMenuItem
                    className="text-xs text-slate-500"
                    onClick={() => void assignOwner(null)}
                  >
                    Remover responsável
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>
        <p className="mt-1 truncate text-[10px] text-slate-500">
          Fonte: <span className="text-slate-600">{opportunity.source}</span>
        </p>
        <p className="text-[10px] text-slate-500">
          Valor:{" "}
          <span className="font-semibold text-slate-700">{formatBRL(opportunity.value)}</span>
        </p>
        <p className="truncate text-[10px] text-slate-500">
          Responsável:{" "}
          <span className="font-medium text-slate-700">{owner?.name ?? "—"}</span>
        </p>
      </div>

      {/* Seletor de curso — fora do gesto de arrastar/abrir detalhe. */}
      <span
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="mt-1.5 block"
      >
        <select
          value={opportunity.course ?? ""}
          onChange={(e) => void setCourse(e.target.value)}
          title={opportunity.course ?? "Selecionar curso"}
          className="h-6 w-full truncate rounded border bg-white px-1 text-[10px] text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        >
          <option value="">Curso: selecionar…</option>
          {/*
            ⚠️ As 45 formações só montam depois que o ponteiro entra no card.
            Montadas sempre eram ~68 mil `<option>` numa coluna de 1.518 cards —
            a maior fatia do DOM da tela, repintada a cada pixel de arrasto.
            O hover chega muito antes do clique, então o menu abre completo; e a
            opção ATUAL fica sempre montada para o `value` do campo controlado
            nunca ficar sem par (senão o card diria "selecionar…" num lead que
            tem curso).
          */}
          {ativo ? (
            CURSOS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))
          ) : opportunity.course ? (
            <option value={opportunity.course}>{opportunity.course}</option>
          ) : null}
        </select>
      </span>

      {/* Fora do gesto de arrastar: clicar numa ação não pode mover o card.
          Com os listeners no raiz, é ESTE `stopPropagation` no pointerdown que
          faz os popovers continuarem abrindo. */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="mt-2 flex items-center gap-1 border-t pt-1.5"
      >
        <ActionButton icon={Phone} label="Ligar" onClick={() => void call()} />
        <ActionButton
          icon={MessageCircle}
          label="Abrir conversa"
          onClick={() => void openConversation()}
        />

        <ActionPopover
          icon={Tag}
          label="Tags do contato"
          open={openAction === "tag"}
          onOpenChange={(o) => setOpenAction(o ? "tag" : null)}
        >
          {contact && contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {contact.tags.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
                >
                  {t}
                  <button
                    onClick={() => void removeTag(t)}
                    className="text-slate-400 hover:text-red-500"
                  >
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void addTag()}
              placeholder="Nova tag"
              className="h-7 text-xs"
            />
            <button
              onClick={() => void addTag()}
              disabled={busy}
              className="shrink-0 rounded-md bg-indigo-500 px-2 text-[11px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-60"
            >
              Adicionar
            </button>
          </div>
        </ActionPopover>

        <ActionPopover
          icon={FileText}
          label="Nota interna"
          open={openAction === "note"}
          onOpenChange={(o) => setOpenAction(o ? "note" : null)}
        >
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="O que ficou combinado?"
            className="min-h-16 text-xs"
          />
          <p className="text-[10px] leading-tight text-slate-400">
            Fica como comentário interno na conversa do contato — o cliente não vê.
          </p>
          <button
            onClick={() => void saveNote()}
            disabled={busy}
            className="rounded-md bg-indigo-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-60"
          >
            {busy ? "Salvando..." : "Salvar nota"}
          </button>
        </ActionPopover>

        <ActionPopover
          icon={CheckSquare}
          label="Nova tarefa"
          open={openAction === "task"}
          onOpenChange={(o) => setOpenAction(o ? "task" : null)}
        >
          <Input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Ex.: ligar para confirmar interesse"
            className="h-7 text-xs"
          />
          <Input
            type="date"
            value={taskDue}
            onChange={(e) => setTaskDue(e.target.value)}
            className="h-7 text-xs"
          />
          <button
            onClick={() => void saveTask()}
            disabled={busy}
            className="rounded-md bg-indigo-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-60"
          >
            {busy ? "Criando..." : "Criar tarefa"}
          </button>
        </ActionPopover>

        <ActionPopover
          icon={Calendar}
          label="Agendar compromisso"
          open={openAction === "appt"}
          onOpenChange={(o) => {
            setOpenAction(o ? "appt" : null);
            if (o && !apptTitle) setApptTitle(`Reunião · ${opportunity.name}`);
            if (o && !apptDate) setApptDate(format(new Date(), "yyyy-MM-dd"));
          }}
        >
          <Input
            value={apptTitle}
            onChange={(e) => setApptTitle(e.target.value)}
            placeholder="Título"
            className="h-7 text-xs"
          />
          <div className="flex gap-1.5">
            <Input
              type="date"
              value={apptDate}
              onChange={(e) => setApptDate(e.target.value)}
              className="h-7 text-xs"
            />
            <Input
              type="time"
              value={apptTime}
              onChange={(e) => setApptTime(e.target.value)}
              className="h-7 w-24 text-xs"
            />
          </div>
          <p className="text-[10px] text-slate-400">Duração de 1 hora.</p>
          <button
            onClick={() => void saveAppointment()}
            disabled={busy}
            className="rounded-md bg-indigo-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-60"
          >
            {busy ? "Agendando..." : "Agendar"}
          </button>
        </ActionPopover>
      </div>

      {/* ⚠️ Montado só quando abre. Um `<Dialog>` por card são 1.518 diálogos
          na árvore de uma coluna só — cada um com portal, foco e escuta de
          teclado — para uma tela que quase nunca é aberta. */}
      {detailOpen && (
        <LeadDetailDialog opportunity={opportunity} open onOpenChange={setDetailOpen} />
      )}
    </div>
  );
}

/**
 * ⚠️ `memo` não é micro-otimização aqui: o dnd-kit re-renderiza TODO draggable
 * a cada movimento do ponteiro durante o arrasto. Com 1.518 cards na coluna,
 * era 1.518 re-renderizações por pixel — o travamento relatado.
 */
export const OpportunityCard = memo(OpportunityCardBase);
