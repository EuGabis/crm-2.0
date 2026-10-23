"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlarmClock,
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { useConfirm } from "@/components/shared/confirm";
import { ContactPicker } from "@/components/contacts/contact-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { contactName } from "@/lib/data/repos/contacts";
import { useDbStore, useDbTeam } from "@/lib/data/repos/db/contacts";
import { useContactsByIds } from "@/lib/data/repos/db/contacts-search";
import {
  taskActions,
  useContactsModule,
  type DbTask,
} from "@/lib/data/repos/db/contacts-module";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { hojeSP } from "@/lib/periodo";
import { diaDoPrazo, diasDeAtraso, situacaoDoPrazo, type SituacaoPrazo } from "@/lib/tasks/prazo";
import { cn } from "@/lib/utils";

/* Recortes da lista. "Pendentes" é o padrão: é a pergunta de todo dia. */
type Vista = "pendentes" | "atrasadas" | "hoje" | "proximas" | "sem-prazo" | "concluidas" | "todas";

const VISTAS: { key: Vista; label: string }[] = [
  { key: "pendentes", label: "Pendentes" },
  { key: "atrasadas", label: "Atrasadas" },
  { key: "hoje", label: "Hoje" },
  { key: "proximas", label: "Próximos 7 dias" },
  { key: "sem-prazo", label: "Sem prazo" },
  { key: "concluidas", label: "Concluídas" },
  { key: "todas", label: "Todas" },
];

const NA_VISTA: Record<Vista, (s: SituacaoPrazo) => boolean> = {
  pendentes: (s) => s !== "concluida",
  atrasadas: (s) => s === "atrasada",
  hoje: (s) => s === "hoje",
  proximas: (s) => s === "amanha" || s === "semana",
  "sem-prazo": (s) => s === "sem-prazo",
  concluidas: (s) => s === "concluida",
  todas: () => true,
};

/** Ordem de trabalho: o que já venceu primeiro, o concluído por último. */
const PESO: Record<SituacaoPrazo, number> = {
  atrasada: 0,
  hoje: 1,
  amanha: 2,
  semana: 3,
  depois: 4,
  "sem-prazo": 5,
  concluida: 6,
};

/** Responsável no filtro: "" = todos; "__eu__" = só as minhas; "__sem__" = sem responsável. */
const EU = "__eu__";
const SEM = "__sem__";

function iniciais(nome: string) {
  return nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function SeloPrazo({ t, hoje }: { t: DbTask; hoje: string }) {
  const s = situacaoDoPrazo(t, hoje);
  if (s === "sem-prazo") return <span className="text-slate-400">Sem prazo</span>;
  const data = t.dueAt ? format(new Date(t.dueAt), "d MMM yyyy", { locale: ptBR }) : "";
  const selo =
    s === "atrasada"
      ? { txt: `Atrasada ${diasDeAtraso(t.dueAt, hoje)}d`, cls: "bg-red-100 text-red-700" }
      : s === "hoje"
        ? { txt: "Hoje", cls: "bg-amber-100 text-amber-700" }
        : s === "amanha"
          ? { txt: "Amanhã", cls: "bg-indigo-100 text-indigo-700" }
          : null;
  return (
    <span className="flex items-center gap-2">
      <span className={cn(s === "concluida" ? "text-slate-400" : "text-slate-600")}>{data}</span>
      {selo && (
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", selo.cls)}>
          {selo.txt}
        </span>
      )}
    </span>
  );
}

export function TasksTab() {
  const confirm = useConfirm();
  const { tasks, loaded } = useContactsModule();
  const team = useDbTeam();
  const { me, isAdmin } = useMyMembership();
  const userId = useDbStore((s) => s.userId);
  // Só os contatos que as tarefas citam — não os 41 mil.
  const contactsById = useContactsByIds(tasks.map((t) => t.contactId));
  const hoje = hojeSP();

  const [vista, setVista] = useState<Vista>("pendentes");
  const [resp, setResp] = useState("");
  const [editando, setEditando] = useState<DbTask | "nova" | null>(null);

  // Quem não vê tudo recebe só as próprias e as sem responsável pela RLS
  // (202610231400) — a tela diz isso, senão "sumiram as tarefas" parece defeito.
  const recortado = !!me && !isAdmin && me.onlyAssigned;
  const nomeDe = (id: string | null) => (id ? (team.find((u) => u.id === id)?.name ?? "—") : "—");

  const porResp = useMemo(() => {
    if (!resp) return tasks;
    if (resp === EU) return tasks.filter((t) => t.assigneeId === userId);
    if (resp === SEM) return tasks.filter((t) => !t.assigneeId);
    return tasks.filter((t) => t.assigneeId === resp);
  }, [tasks, resp, userId]);

  const contagem = useMemo(() => {
    const c = Object.fromEntries(VISTAS.map((v) => [v.key, 0])) as Record<Vista, number>;
    for (const t of porResp) {
      const s = situacaoDoPrazo(t, hoje);
      for (const v of VISTAS) if (NA_VISTA[v.key](s)) c[v.key]++;
    }
    return c;
  }, [porResp, hoje]);

  const linhas = useMemo(
    () =>
      porResp
        .filter((t) => NA_VISTA[vista](situacaoDoPrazo(t, hoje)))
        .sort((a, b) => {
          const pa = PESO[situacaoDoPrazo(a, hoje)];
          const pb = PESO[situacaoDoPrazo(b, hoje)];
          if (pa !== pb) return pa - pb;
          return (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
        }),
    [porResp, vista, hoje],
  );

  // O filtro de responsável só faz sentido quando há mais de uma pessoa na lista.
  const responsaveis = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.assigneeId).filter(Boolean) as string[]);
    return team.filter((u) => ids.has(u.id));
  }, [tasks, team]);

  const columns: Column<DbTask>[] = [
    {
      key: "done",
      header: "",
      // Botão redondo, não caixa: a caixa da linha é a de SELEÇÃO (ações em massa).
      render: (t) => (
        <button
          aria-label={t.status === "done" ? "Reabrir tarefa" : "Concluir tarefa"}
          title={t.status === "done" ? "Reabrir" : "Concluir"}
          onClick={async () => {
            if (!(await taskActions.toggle(t.id))) toast.error("Não foi possível atualizar a tarefa");
          }}
          className={cn(
            "flex size-5 items-center justify-center rounded-full border transition",
            t.status === "done"
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500",
          )}
        >
          <Check className="size-3" />
        </button>
      ),
    },
    {
      key: "titulo",
      header: "Tarefa",
      sortable: true,
      sortValue: (t) => t.title.toLowerCase(),
      render: (t) => (
        <span className="flex items-center gap-1.5">
          <span
            className={
              t.status === "done" ? "text-slate-400 line-through" : "font-medium text-slate-800"
            }
          >
            {t.title}
          </span>
          {t.reminderMinutes != null && t.status !== "done" && (
            <Bell className="size-3 text-slate-400" aria-label="Com lembrete" />
          )}
        </span>
      ),
    },
    {
      key: "contato",
      header: "Contato",
      render: (t) => {
        if (!t.contactId) return <span className="text-slate-400">—</span>;
        const c = contactsById.get(t.contactId);
        return (
          <Link
            href={`/contatos/${t.contactId}`}
            className="text-slate-600 hover:text-indigo-600 hover:underline"
          >
            {c ? contactName(c) : "Carregando..."}
          </Link>
        );
      },
    },
    {
      key: "resp",
      header: "Responsável",
      sortable: true,
      sortValue: (t) => nomeDe(t.assigneeId),
      render: (t) => {
        if (!t.assigneeId) return <span className="text-amber-700">Sem responsável</span>;
        const nome = nomeDe(t.assigneeId);
        return (
          <span className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700">
              {iniciais(nome)}
            </span>
            <span className="text-slate-700">
              {nome}
              {t.assigneeId === userId && <span className="ml-1 text-slate-400">(você)</span>}
            </span>
          </span>
        );
      },
    },
    {
      key: "prazo",
      header: "Prazo",
      sortable: true,
      sortValue: (t) => t.dueAt ?? "9999",
      render: (t) => <SeloPrazo t={t} hoje={hoje} />,
    },
    {
      key: "acao",
      header: "",
      render: (t) => (
        <span className="flex items-center justify-end gap-2">
          <button
            onClick={() => setEditando(t)}
            className="text-slate-300 hover:text-indigo-600"
            aria-label="Editar tarefa"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            onClick={async () => {
              if (
                !(await confirm({
                  title: `Excluir "${t.title}"?`,
                  description: "A tarefa some para todos. Não tem desfazer.",
                  confirmLabel: "Excluir",
                  destructive: true,
                }))
              )
                return;
              if (await taskActions.remove(t.id)) toast.success("Tarefa excluída");
              else toast.error("Não foi possível excluir");
            }}
            className="text-slate-300 hover:text-red-500"
            aria-label="Excluir tarefa"
          >
            <Trash2 className="size-3.5" />
          </button>
        </span>
      ),
    },
  ];

  const kpis: { key: Vista; label: string; icon: typeof Check; cor: string }[] = [
    { key: "atrasadas", label: "Atrasadas", icon: AlarmClock, cor: "text-red-600 bg-red-50" },
    { key: "hoje", label: "Vencem hoje", icon: CalendarClock, cor: "text-amber-600 bg-amber-50" },
    { key: "proximas", label: "Próximos 7 dias", icon: CalendarDays, cor: "text-indigo-600 bg-indigo-50" },
    { key: "concluidas", label: "Concluídas", icon: CheckCircle2, cor: "text-emerald-600 bg-emerald-50" },
  ];

  // Ações em massa, em SÉRIE: cada uma confere as linhas devolvidas.
  const emMassa = async (ids: string[], acao: "concluir" | "excluir", clear: () => void) => {
    if (acao === "excluir") {
      const ok = await confirm({
        title: `Excluir ${ids.length} tarefa${ids.length === 1 ? "" : "s"}?`,
        description: "Não tem desfazer.",
        confirmLabel: "Excluir",
        destructive: true,
      });
      if (!ok) return;
    }
    let falhas = 0;
    for (const id of ids) {
      const t = tasks.find((x) => x.id === id);
      if (!t) continue;
      if (acao === "concluir") {
        if (t.status === "done") continue;
        if (!(await taskActions.toggle(id))) falhas++;
      } else if (!(await taskActions.remove(id))) falhas++;
    }
    clear();
    if (falhas) toast.error(`${falhas} não puderam ser alteradas`);
    else toast.success(acao === "concluir" ? "Tarefas concluídas" : "Tarefas excluídas");
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Tarefas</h1>
          <p className="text-xs text-slate-500">
            {recortado
              ? "Você vê as tarefas atribuídas a você e as sem responsável."
              : "Follow-ups da equipe, do que venceu ao que vem pela frente."}
          </p>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setEditando("nova")}>
          <Plus className="size-3.5" /> Nova tarefa
        </Button>
      </div>

      {loaded && tasks.length === 0 ? (
        <EmptyState
          icon={Check}
          title="Nenhuma tarefa ainda"
          description="Crie a primeira tarefa e vincule a um contato para não perder o follow-up."
          cta={
            <Button size="sm" className="text-xs" onClick={() => setEditando("nova")}>
              <Plus className="size-3.5" /> Nova tarefa
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map((k) => (
              <button
                key={k.key}
                onClick={() => setVista(vista === k.key ? "pendentes" : k.key)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border bg-white p-3 text-left transition hover:shadow-sm",
                  vista === k.key && "border-indigo-300 ring-1 ring-indigo-200",
                )}
              >
                <span className={cn("flex size-9 items-center justify-center rounded-lg", k.cor)}>
                  <k.icon className="size-4" />
                </span>
                <span>
                  <span className="block text-xl font-bold text-slate-900">{contagem[k.key]}</span>
                  <span className="block text-xs text-slate-500">{k.label}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {VISTAS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => setVista(v.key)}
                  className={cn(
                    "h-7 rounded-full px-3 text-xs font-medium transition",
                    vista === v.key
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
                  )}
                >
                  {v.label}
                  <span className={cn("ml-1.5", vista === v.key ? "text-indigo-100" : "text-slate-400")}>
                    {contagem[v.key]}
                  </span>
                </button>
              ))}
            </div>
            {responsaveis.length > 1 && (
              <select
                value={resp}
                onChange={(e) => setResp(e.target.value)}
                className="h-8 rounded-md border bg-white px-2 text-xs text-slate-700"
                aria-label="Filtrar por responsável"
              >
                <option value="">Todos os responsáveis</option>
                <option value={EU}>Minhas tarefas</option>
                <option value={SEM}>Sem responsável</option>
                {responsaveis.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {linhas.length === 0 ? (
            <div className="rounded-xl border bg-white p-10 text-center text-sm text-slate-500">
              Nenhuma tarefa neste filtro.
            </div>
          ) : (
            <DataTable
              data={linhas}
              columns={columns}
              pageSize={15}
              searchPlaceholder="Buscar por tarefa ou contato"
              searchFn={(t, q) => {
                const c = t.contactId ? contactsById.get(t.contactId) : null;
                return (
                  t.title.toLowerCase().includes(q) ||
                  (!!c && contactName(c).toLowerCase().includes(q))
                );
              }}
              selectable
              bulkBar={(ids, clear) => (
                <>
                  <span className="text-xs font-medium text-indigo-700">
                    {ids.length} selecionada{ids.length === 1 ? "" : "s"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs"
                    onClick={() => void emMassa(ids, "concluir", clear)}
                  >
                    <Check className="size-3.5" /> Concluir
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-xs text-red-600"
                    onClick={() => void emMassa(ids, "excluir", clear)}
                  >
                    <Trash2 className="size-3.5" /> Excluir
                  </Button>
                  <button onClick={clear} className="ml-auto text-xs text-slate-500 hover:underline">
                    Limpar seleção
                  </button>
                </>
              )}
            />
          )}
        </>
      )}

      {/* `key` remonta o formulário por tarefa: sem ela, editar a segunda
          mostraria os campos da primeira (o useState só lê o valor inicial). */}
      {editando && (
        <TarefaDialog
          key={editando === "nova" ? "nova" : editando.id}
          tarefa={editando === "nova" ? null : editando}
          padraoResponsavel={userId}
          onClose={() => setEditando(null)}
        />
      )}
    </div>
  );
}

function TarefaDialog({
  tarefa,
  padraoResponsavel,
  onClose,
}: {
  tarefa: DbTask | null;
  padraoResponsavel: string | null;
  onClose: () => void;
}) {
  const team = useDbTeam();
  const [title, setTitle] = useState(tarefa?.title ?? "");
  const [contactId, setContactId] = useState(tarefa?.contactId ?? "");
  const [assigneeId, setAssigneeId] = useState(
    tarefa ? (tarefa.assigneeId ?? "") : (padraoResponsavel ?? ""),
  );
  const [dueAt, setDueAt] = useState(diaDoPrazo(tarefa?.dueAt) ?? "");
  const [saving, setSaving] = useState(false);

  const salvar = async () => {
    if (!title.trim()) {
      toast.error("Dê um título para a tarefa");
      return;
    }
    setSaving(true);
    const dados = {
      title: title.trim(),
      contactId: contactId || null,
      assigneeId: assigneeId || null,
      dueAt: dueAt ? `${dueAt}T12:00:00-03:00` : null,
    };
    const r = tarefa ? await taskActions.update(tarefa.id, dados) : await taskActions.criar(dados);
    setSaving(false);
    if (!r.ok) {
      toast.error(`Não foi possível salvar a tarefa (${r.erro})`);
      return;
    }
    // Passar para um colega pode tirar a tarefa da SUA lista — dizer isso.
    toast.success(
      r.visivel
        ? tarefa ? "Tarefa atualizada" : "Tarefa criada"
        : `Tarefa ${tarefa ? "passada" : "criada"} para ${team.find((u) => u.id === assigneeId)?.name ?? "outra pessoa"}`,
    );
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tarefa ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Título</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Ligar para apresentar proposta"
              className="h-8"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Contato (opcional)</Label>
            <ContactPicker value={contactId} onChange={setContactId} placeholder="Sem contato vinculado" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Responsável</Label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="h-8 w-full rounded-md border bg-white px-2 text-xs"
              >
                <option value="">Sem responsável</option>
                {/* O atual entra mesmo com a equipe carregando — senão o campo
                    controlado mostraria "sem responsável" numa tarefa que tem. */}
                {assigneeId && !team.some((u) => u.id === assigneeId) && (
                  <option value={assigneeId}>Carregando...</option>
                )}
                {team.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.id === padraoResponsavel ? " (você)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Prazo</Label>
              <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="h-8" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={saving}>
            {saving ? "Salvando..." : tarefa ? "Salvar" : "Criar tarefa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
