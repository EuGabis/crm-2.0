"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  CheckSquare,
  Clock,
  ChevronDown,
  FileText,
  Pencil,
  Target,
  User,
  UserPlus,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ContactPaymentsSummary, formatDoc } from "@/components/payments/lead-payments-panel";
import {
  AppointmentsPanel,
  FilesPanel,
  NotesPanel,
  TasksPanel,
} from "./contact-side-panels";
import { SendToPipelineDialog } from "./send-to-pipeline-dialog";
import { contactName } from "@/lib/data/repos/contacts";
import { useDbAppointments } from "@/lib/data/repos/db/appointments";
import { useDbContact, useDbTeam } from "@/lib/data/repos/db/contacts";
import { useContactsModule } from "@/lib/data/repos/db/contacts-module";
import { useContactActivityCounts } from "@/lib/data/repos/db/contact-files";
import { conversationActions } from "@/lib/data/repos/db/conversations";
import { oppActions, usePipelineDb } from "@/lib/data/repos/db/pipeline";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { formatBRL } from "@/lib/data/repos/opportunities";
import type { Opportunity, Pipeline, Stage, User as TeamUser } from "@/lib/data/types";
import { cn } from "@/lib/utils";

type Panel = "campos" | "tarefas" | "notas" | "compromissos" | "arquivos";

const fmtShort = (v: string, withTime = false) =>
  format(new Date(v), withTime ? "dd/MM 'às' HH:mm" : "dd/MM", { locale: ptBR });

/**
 * Editor da oportunidade do contato dentro do painel da conversa: dá pra MOVER
 * a fase e trocar o RESPONSÁVEL sem sair pra tela de Leads. Cada ação vira um
 * evento inline na conversa (log de quem fez o quê).
 */
function OppEditor({
  opportunity,
  pipeline,
  team,
  conversationId,
}: {
  opportunity: Opportunity;
  pipeline?: Pipeline;
  team: TeamUser[];
  conversationId?: string;
}) {
  const stages = pipeline?.stages ?? [];
  const stage = stages.find((s) => s.id === opportunity.stageId);
  const owner = team.find((u) => u.id === opportunity.ownerId);
  const { me } = useMyMembership();
  const actor = team.find((u) => u.id === me?.userId)?.name ?? "Alguém";

  const changeStage = async (s: Stage) => {
    if (s.id === opportunity.stageId) return;
    const ok = await oppActions.move(opportunity.id, s.id);
    if (!ok) {
      toast.error("Não foi possível mover a etapa");
      return;
    }
    toast.success(`Movido para "${s.name}"`);
    if (conversationId) {
      void conversationActions.logEvent(
        conversationId,
        `${actor} moveu "${opportunity.name}" para ${s.name}`
      );
    }
  };

  const changeOwner = async (userId: string | null) => {
    const ok = await oppActions.assign(opportunity.id, userId);
    if (!ok) {
      toast.error("Não foi possível alterar o responsável");
      return;
    }
    const target = userId ? team.find((u) => u.id === userId)?.name ?? "usuário" : null;
    toast.success(target ? `Responsável: ${target}` : "Responsável removido");
    if (conversationId) {
      void conversationActions.logEvent(
        conversationId,
        target
          ? `${actor} definiu ${target} como responsável por "${opportunity.name}"`
          : `${actor} removeu o responsável de "${opportunity.name}"`
      );
    }
  };

  const trigger =
    "flex items-center justify-between gap-1 rounded border px-1.5 py-1 text-[11px] hover:bg-slate-50";

  return (
    <div className="rounded-md border bg-white p-2">
      <div className="flex items-center justify-between gap-1">
        <span className="min-w-0 truncate text-[11px] font-semibold text-slate-700">
          {pipeline?.name ?? "Pipeline"}
        </span>
        <span className="shrink-0 text-[10px] font-bold text-slate-600">
          {formatBRL(opportunity.value)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        {/* Fase */}
        <DropdownMenu>
          <DropdownMenuTrigger render={<button title="Mover de fase" className={trigger} />}>
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
              />
              <span className="truncate text-slate-700">{stage?.name ?? "Escolher fase"}</span>
            </span>
            <ChevronDown className="size-3 shrink-0 text-slate-400" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 w-48 overflow-y-auto">
            {stages.map((s) => (
              <DropdownMenuItem key={s.id} className="gap-1.5 text-xs" onClick={() => void changeStage(s)}>
                <span className="size-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                {s.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Responsável */}
        <DropdownMenu>
          <DropdownMenuTrigger render={<button title="Definir responsável" className={trigger} />}>
            <span className="flex min-w-0 items-center gap-1.5">
              {owner ? (
                <Avatar className="size-4">
                  <AvatarFallback
                    className="text-[7px] font-bold text-white"
                    style={{ background: owner.color }}
                  >
                    {owner.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <UserPlus className="size-3 text-slate-400" />
              )}
              <span className="truncate text-slate-700">{owner?.name ?? "Responsável"}</span>
            </span>
            <ChevronDown className="size-3 shrink-0 text-slate-400" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 w-48 overflow-y-auto">
            {team.map((u) => (
              <DropdownMenuItem key={u.id} className="text-xs" onClick={() => void changeOwner(u.id)}>
                {u.name}
              </DropdownMenuItem>
            ))}
            {opportunity.ownerId && (
              <DropdownMenuItem
                className="text-xs text-slate-500"
                onClick={() => void changeOwner(null)}
              >
                Remover responsável
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

const PANELS: { key: Panel; icon: typeof User; label: string }[] = [
  { key: "campos", icon: User, label: "Contato" },
  { key: "tarefas", icon: CheckSquare, label: "Tarefas" },
  { key: "notas", icon: Pencil, label: "Observações" },
  { key: "compromissos", icon: CalendarDays, label: "Compromissos" },
  { key: "arquivos", icon: FileText, label: "Arquivos" },
];

export function ContactPanel({
  contactId,
  conversationId,
}: {
  contactId: string;
  conversationId?: string;
}) {
  const [panel, setPanel] = useState<Panel>("campos");
  const [tab, setTab] = useState<"todos" | "dnd" | "acoes">("todos");
  const [pipelineOpen, setPipelineOpen] = useState(false);
  // Seções abertas do acordeão. Controlado (e não `defaultValue`) porque
  // "Resumo pagamentos" só consulta a Guru quando o usuário abre a seção.
  const [sections, setSections] = useState<string[]>(["contato"]);
  const { can } = useMyMembership();
  const canPayments = can("pagamentos");
  const { contact } = useDbContact(contactId);
  const team = useDbTeam();
  const { pipelines, opportunities: allOpps } = usePipelineDb();
  const opportunities = allOpps.filter((o) => o.contactId === contactId);
  // Contagens dos indicadores. Tarefas e compromissos saem de stores já
  // carregadas (de graça); comentários e arquivos vêm de duas contagens
  // `head` (nenhuma linha trafega) — ver useContactActivityCounts.
  const { tasks } = useContactsModule();
  const { appointments } = useDbAppointments();
  const { notes: notesCount, files: filesCount } = useContactActivityCounts(contactId);
  // Inicializador preguiçoso: relógio no corpo do render quebra a regra de
  // pureza do React. Só separa passado de futuro, não precisa acompanhar o
  // minuto.
  const [nowIso] = useState(() => new Date().toISOString());

  const pendingTasks = tasks
    .filter((t) => t.contactId === contactId && t.status === "pending")
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  const contactAppointments = appointments
    .filter((a) => a.contactId === contactId)
    .sort((a, b) => a.start.localeCompare(b.start));
  const nextAppointment = contactAppointments.find((a) => a.start >= nowIso);
  const counts: Record<Panel, number> = {
    campos: 0,
    tarefas: pendingTasks.length,
    notas: notesCount,
    compromissos: contactAppointments.length,
    arquivos: filesCount,
  };

  if (!contact) return null;

  return (
    <div className="hidden w-[340px] shrink-0 border-l bg-white xl:flex">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {panel === "campos" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b px-3 py-2">
              <p className="text-xs font-bold text-slate-700">{contactName(contact)}</p>
              <Link
                href={`/contatos/${contact.id}`}
                className="text-[10px] text-indigo-600 hover:underline"
              >
                Ver contato completo
              </Link>
              {/* Botão E situação no funil ficam no cabeçalho, e não dentro da
                  aba "Ações": saber que o contato JÁ está num pipeline é a
                  informação que evita mandar o mesmo lead duas vezes — não
                  pode depender de trocar de aba pra aparecer. */}
              <button
                onClick={() => setPipelineOpen(true)}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 py-1.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
              >
                <Target className="size-3" /> Enviar para pipeline
              </button>
              {/* Pendências à vista, sem trocar de painel: o atendente abre a
                  conversa e já vê que existe tarefa em aberto ou reunião
                  marcada — que é o ponto de "não esquecer". */}
              {(pendingTasks.length > 0 || nextAppointment) && (
                <div className="mt-2 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2">
                  {pendingTasks.slice(0, 3).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setPanel("tarefas")}
                      className="flex w-full items-start gap-1.5 text-left"
                    >
                      <CheckSquare className="mt-0.5 size-3 shrink-0 text-amber-600" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] text-slate-700">{t.title}</span>
                        <span className="block text-[10px] text-amber-700">
                          {t.dueAt ? `Prazo ${fmtShort(t.dueAt)}` : "Sem prazo"}
                          {t.reminderMinutes !== null && t.reminderMinutes !== undefined
                            ? " · com lembrete"
                            : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                  {pendingTasks.length > 3 && (
                    <button
                      onClick={() => setPanel("tarefas")}
                      className="text-[10px] font-semibold text-amber-700 hover:underline"
                    >
                      +{pendingTasks.length - 3} outra(s) tarefa(s)
                    </button>
                  )}
                  {nextAppointment && (
                    <button
                      onClick={() => setPanel("compromissos")}
                      className="flex w-full items-start gap-1.5 text-left"
                    >
                      <Clock className="mt-0.5 size-3 shrink-0 text-amber-600" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] text-slate-700">
                          {nextAppointment.title}
                        </span>
                        <span className="block text-[10px] text-amber-700">
                          {fmtShort(nextAppointment.start, true)}
                        </span>
                      </span>
                    </button>
                  )}
                </div>
              )}
              {opportunities.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    {opportunities.length === 1 ? "No pipeline" : "Nos pipelines"}
                  </p>
                  {opportunities.map((o) => (
                    <OppEditor
                      key={o.id}
                      opportunity={o}
                      pipeline={pipelines.find((p) => p.id === o.pipelineId)}
                      team={team}
                      conversationId={conversationId}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-1 border-b px-2 py-1.5">
              {(
                [
                  ["todos", "Todos os campos"],
                  ["dnd", "DND"],
                  ["acoes", "Ações"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[10px] font-medium",
                    tab === key ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin]">
              {tab === "todos" && (
                <Accordion value={sections} onValueChange={(v) => setSections(v as string[])}>
                  <AccordionItem value="contato">
                    <AccordionTrigger className="py-2 text-xs font-bold">Contato</AccordionTrigger>
                    <AccordionContent className="space-y-2">
                      {[
                        ["Nome", contact.firstName],
                        ["Sobrenome", contact.lastName],
                        ["E-mail", contact.email],
                        ["Telefone", contact.phone],
                        ["CPF/CNPJ", contact.doc ? formatDoc(contact.doc) : "—"],
                        ["Empresa", contact.company ?? "—"],
                        // A seção "Campos personalizados" era um cabeçalho com
                        // nada embaixo em toda empresa que não criou campo
                        // nenhum. Quem TEM campo continua vendo o valor — agora
                        // junto do resto, sem seção separada só para isso.
                        ...Object.entries(contact.customFields),
                      ].map(([k, v]) => (
                        <div key={k}>
                          <p className="text-[10px] text-slate-400">{k}</p>
                          <p className="truncate text-xs text-slate-700">{v}</p>
                        </div>
                      ))}
                    </AccordionContent>
                  </AccordionItem>

                  {/* Só existe para quem enxerga o módulo Pagamentos. */}
                  {canPayments && (
                    <AccordionItem value="pagamentos">
                      <AccordionTrigger className="py-2 text-xs font-bold">
                        Resumo pagamentos
                      </AccordionTrigger>
                      <AccordionContent>
                        {/* Montado só quando a seção está aberta: o cruzamento com
                            a Guru é uma consulta, e ela não deve rodar a cada
                            conversa que o atendente abre. */}
                        {sections.includes("pagamentos") && (
                          <ContactPaymentsSummary contact={contact} />
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  )}
                </Accordion>
              )}
              {tab === "dnd" && (
                <div className="space-y-2 text-xs text-slate-600">
                  <p className="font-semibold">Não Perturbe (DND)</p>
                  <p className="text-[11px] text-slate-400">
                    {contact.dnd
                      ? "Este contato optou por não receber comunicações."
                      : "Este contato aceita receber comunicações em todos os canais."}
                  </p>
                  <Badge variant={contact.dnd ? "destructive" : "secondary"}>
                    {contact.dnd ? "DND ativado" : "DND desativado"}
                  </Badge>
                </div>
              )}
              {tab === "acoes" && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    Oportunidades
                  </p>
                  {opportunities.length === 0 && (
                    <p className="text-[11px] text-slate-400">
                      Nenhuma oportunidade — use “Enviar para pipeline” acima.
                    </p>
                  )}
                  {opportunities.map((o) => {
                    const pipeline = pipelines.find((p) => p.id === o.pipelineId);
                    const stage = pipeline?.stages.find((s) => s.id === o.stageId);
                    return (
                      <div key={o.id} className="rounded-lg border p-2.5">
                        <p className="text-[10px] font-semibold text-slate-500">
                          {pipeline?.name} &gt; {stage?.name}
                        </p>
                        <div className="mt-0.5 flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-800">{o.name}</span>
                          <span className="text-xs font-bold">{formatBRL(o.value)}</span>
                        </div>
                      </div>
                    );
                  })}
                  {/* Aqui havia dois nomes de automação FIXOS no código
                      ("Boas-vindas | Novo Lead · Follow-up 3 dias"), iguais para
                      todo contato — parecia dado e não era. Enquanto o motor não
                      expõe as inscrições por contato, é melhor dizer isso. */}
                  <p className="pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    Fluxos de trabalho ativos
                  </p>
                  <p className="text-[11px] text-slate-400">
                    As inscrições em automações por contato ainda não são exibidas aqui — veja
                    em Automações.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : panel === "tarefas" ? (
          <TasksPanel contactId={contact.id} />
        ) : panel === "notas" ? (
          <NotesPanel contactId={contact.id} />
        ) : panel === "compromissos" ? (
          <AppointmentsPanel contactId={contact.id} />
        ) : (
          <FilesPanel contactId={contact.id} />
        )}
      </div>
      <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-l py-2">
        {PANELS.map(({ key, icon: Icon, label }) => (
          <Tooltip key={key}>
            <TooltipTrigger
              render={
                <button
                  onClick={() => setPanel(key)}
                  className={cn(
                    "relative flex size-8 items-center justify-center rounded-md",
                    panel === key
                      ? "bg-indigo-100 text-indigo-600"
                      : "text-slate-400 hover:bg-slate-100"
                  )}
                />
              }
            >
              <Icon className="size-4" />
              {/* O que existe ali dentro, sem precisar abrir. Tarefas conta só
                  as PENDENTES: um selo que nunca zera vira enfeite. */}
              {counts[key] > 0 && (
                <span
                  className={cn(
                    "absolute -right-0.5 -top-0.5 flex min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] font-bold leading-[14px] text-white",
                    key === "tarefas" ? "bg-amber-500" : "bg-indigo-500"
                  )}
                >
                  {counts[key] > 9 ? "9+" : counts[key]}
                </span>
              )}
            </TooltipTrigger>
            <TooltipContent side="left" className="text-[10px]">
              {label}
              {counts[key] > 0 ? ` (${counts[key]})` : ""}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <SendToPipelineDialog
        open={pipelineOpen}
        onOpenChange={setPipelineOpen}
        contactId={contact.id}
        contactName={contactName(contact)}
      />
    </div>
  );
}
