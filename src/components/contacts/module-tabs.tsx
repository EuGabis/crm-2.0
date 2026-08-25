"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, ListChecks, Plus, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ContactPicker } from "@/components/contacts/contact-picker";
import type { FilterCondition } from "@/components/shared/filter-drawer";
import {
  countMatching,
  useContactCompanies,
  useContactsByIds,
} from "@/lib/data/repos/db/contacts-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { contactName } from "@/lib/data/repos/contacts";
import { useDbTeam } from "@/lib/data/repos/db/contacts";
import {
  FIELD_TYPE_LABEL,
  fieldActions,
  smartListActions,
  taskActions,
  useContactsModule,
  type DbTask,
  type FieldType,
  type SmartList,
} from "@/lib/data/repos/db/contacts-module";
import type { Contact } from "@/lib/data/types";

import { useConfirm } from "@/components/shared/confirm";
/* ============ util: aplicar condições de lista inteligente ============ */

export function matchesConditions(c: Contact, conditions: FilterCondition[]): boolean {
  if (conditions.length === 0) return true;
  return conditions.every((cond) => {
    const hay = (
      cond.field === "Tag"
        ? c.tags.join(" ")
        : cond.field === "Empresa"
          ? (c.company ?? "")
          : cond.field === "E-mail"
            ? c.email
            : cond.field === "Telefone"
              ? c.phone
              : contactName(c)
    ).toLowerCase();
    const needle = cond.value.toLowerCase();
    if (cond.operator === "não é") return !hay.includes(needle);
    return hay.includes(needle);
  });
}

const LIST_FIELDS = ["Tag", "Nome", "E-mail", "Telefone", "Empresa"];
const LIST_OPS: FilterCondition["operator"][] = ["é", "não é", "contém"];

/* ============ Listas inteligentes ============ */

export function SmartListsTab({
  onApply,
  onImport,
}: {
  onApply: (conditions: FilterCondition[]) => void;
  /** Abre o diálogo de importação (importar contatos como uma lista). */
  onImport?: () => void;
}) {
  const confirm = useConfirm();
  const { smartLists, loaded } = useContactsModule();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [field, setField] = useState("Tag");
  const [op, setOp] = useState<FilterCondition["operator"]>("é");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Cada lista é uma contagem no banco. Antes era `contacts.filter(...)` sobre o
  // array inteiro — que só existia porque a tela carregava os 41 mil contatos.
  // Uma consulta por lista (são poucas) troca isso por ~30 ms cada.
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const listsKey = smartLists.map((l) => `${l.id}:${JSON.stringify(l.conditions)}`).join("|");
  useEffect(() => {
    let alive = true;
    void (async () => {
      const entries: [string, number][] = [];
      for (const l of smartLists) entries.push([l.id, await countMatching(l.conditions)]);
      if (alive) setCounts(new Map(entries));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listsKey]);

  const create = async () => {
    if (!name.trim() || !value.trim()) {
      toast.error("Preencha nome da lista e valor do filtro");
      return;
    }
    setSaving(true);
    const ok = await smartListActions.add(name.trim(), [{ field, operator: op, value: value.trim() }]);
    setSaving(false);
    if (!ok) {
      toast.error("Não foi possível salvar a lista");
      return;
    }
    toast.success(`Lista "${name.trim()}" criada`);
    setName("");
    setValue("");
    setDialogOpen(false);
  };

  const describe = (l: SmartList) =>
    l.conditions.map((c) => `${c.field} ${c.operator} "${c.value}"`).join(" e ") || "Todos os contatos";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-900">Listas inteligentes</h1>
        <div className="flex items-center gap-2">
          {onImport && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={onImport}
            >
              <UploadCloud className="size-3.5" /> Importar lista
            </Button>
          )}
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setDialogOpen(true)}>
            <Plus className="size-3.5" /> Nova lista
          </Button>
        </div>
      </div>
      {loaded && smartLists.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nenhuma lista inteligente ainda"
          description="Crie segmentos salvos (ex.: Tag é 'quente') para filtrar seus contatos com um clique."
          cta={
            <Button size="sm" className="text-xs" onClick={() => setDialogOpen(true)}>
              <Plus className="size-3.5" /> Criar primeira lista
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {smartLists.map((l) => (
            <div key={l.id} className="rounded-xl border bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                    <ListChecks className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{l.name}</p>
                    <p className="text-[11px] text-slate-500">{describe(l)}</p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  {counts.get(l.id) ?? 0}
                </Badge>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 flex-1 text-xs"
                  onClick={() => onApply(l.conditions)}
                >
                  Abrir
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-red-500 hover:text-red-600"
                  onClick={async () => {
                    if (!(await confirm({ title: `Excluir a lista "${l.name}"?`, confirmLabel: "Excluir", destructive: true }))) return;
                    (await smartListActions.remove(l.id))
                      ? toast.success("Lista excluída")
                      : toast.error("Não foi possível excluir");
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova lista inteligente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome da lista</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Leads quentes"
                className="h-8"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Campo</Label>
                <Select value={field} onValueChange={(v) => v && setField(v)}>
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue>{field}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {LIST_FIELDS.map((f) => (
                      <SelectItem key={f} value={f} className="text-xs">
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Operador</Label>
                <Select
                  value={op}
                  onValueChange={(v) => v && setOp(v as FilterCondition["operator"])}
                >
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue>{op}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {LIST_OPS.map((o) => (
                      <SelectItem key={o} value={o} className="text-xs">
                        {o}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Valor</Label>
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="quente"
                  className="h-8"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={create} disabled={saving}>
              {saving ? "Salvando..." : "Criar lista"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============ Ações em massa (log real) ============ */

export function BulkLogTab() {
  const { logs, loaded } = useContactsModule();
  const team = useDbTeam();

  const columns: Column<(typeof logs)[number]>[] = [
    {
      key: "op",
      header: "Operação",
      render: (r) => <span className="font-medium text-slate-800">{r.operation}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.status === "done" ? (
          <Badge className="bg-emerald-100 text-emerald-700">Concluída</Badge>
        ) : (
          <Badge className="bg-amber-100 text-amber-700">Processando</Badge>
        ),
    },
    {
      key: "afetados",
      header: "Registros afetados",
      sortable: true,
      sortValue: (r) => r.affected,
      render: (r) => r.affected.toLocaleString("pt-BR"),
    },
    {
      key: "por",
      header: "Executada por",
      render: (r) => team.find((u) => u.id === r.createdBy)?.name ?? "—",
    },
    {
      key: "data",
      header: "Data",
      sortable: true,
      sortValue: (r) => r.createdAt,
      render: (r) => (
        <span className="text-slate-500">
          {format(new Date(r.createdAt), "d MMM yyyy HH:mm", { locale: ptBR })}
        </span>
      ),
    },
  ];

  return (
    <div>
      <h1 className="mb-4 text-lg font-bold text-slate-900">Histórico de ações em massa</h1>
      {loaded && logs.length === 0 ? (
        <EmptyState
          icon={Check}
          title="Nenhuma ação em massa ainda"
          description="Importações, exportações e operações de tag aparecem aqui automaticamente."
        />
      ) : (
        <DataTable data={logs} columns={columns} pageSize={10} />
      )}
    </div>
  );
}

/* ============ Tarefas (reais) ============ */

export function TasksTab() {
  const confirm = useConfirm();
  const { tasks, loaded } = useContactsModule();
  const team = useDbTeam();
  // Só os contatos que as tarefas citam — não os 41 mil.
  const contactsById = useContactsByIds(tasks.map((t) => t.contactId));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [contactId, setContactId] = useState<string>("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [dueAt, setDueAt] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!title.trim()) {
      toast.error("Dê um título para a tarefa");
      return;
    }
    setSaving(true);
    const ok = await taskActions.add({
      title: title.trim(),
      contactId: contactId || null,
      assigneeId: assigneeId || null,
      dueAt: dueAt ? `${dueAt}T12:00:00-03:00` : null,
    });
    setSaving(false);
    if (!ok) {
      toast.error("Não foi possível criar a tarefa");
      return;
    }
    toast.success("Tarefa criada");
    setTitle("");
    setContactId("");
    setAssigneeId("");
    setDueAt("");
    setDialogOpen(false);
  };

  const columns: Column<DbTask>[] = [
    {
      key: "done",
      header: "",
      render: (t) => (
        <Checkbox
          checked={t.status === "done"}
          onCheckedChange={() => void taskActions.toggle(t.id)}
        />
      ),
    },
    {
      key: "titulo",
      header: "Título",
      sortable: true,
      sortValue: (t) => t.title,
      render: (t) => (
        <span
          className={
            t.status === "done" ? "text-slate-400 line-through" : "font-medium text-slate-800"
          }
        >
          {t.title}
        </span>
      ),
    },
    {
      key: "contato",
      header: "Contato vinculado",
      render: (t) => {
        const c = t.contactId ? contactsById.get(t.contactId) : null;
        return <span className="text-slate-600">{c ? contactName(c) : "—"}</span>;
      },
    },
    {
      key: "resp",
      header: "Responsável",
      render: (t) => team.find((u) => u.id === t.assigneeId)?.name ?? "—",
    },
    {
      key: "prazo",
      header: "Prazo",
      sortable: true,
      sortValue: (t) => t.dueAt ?? "",
      render: (t) =>
        t.dueAt ? (
          <span className="text-slate-500">
            {format(new Date(t.dueAt), "d MMM yyyy", { locale: ptBR })}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "acao",
      header: "",
      render: (t) => (
        <button
          onClick={async () => {
            if (!(await confirm({ title: "Excluir esta tarefa?", confirmLabel: "Excluir", destructive: true }))) return;
            (await taskActions.remove(t.id))
              ? toast.success("Tarefa excluída")
              : toast.error("Não foi possível excluir");
          }}
          className="text-slate-300 hover:text-red-500"
        >
          <Trash2 className="size-3.5" />
        </button>
      ),
    },
  ];

  const pending = tasks.filter((t) => t.status === "pending").length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-slate-900">Tarefas</h1>
          <Badge variant="secondary">{pending} pendente{pending === 1 ? "" : "s"}</Badge>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setDialogOpen(true)}>
          <Plus className="size-3.5" /> Nova tarefa
        </Button>
      </div>
      {loaded && tasks.length === 0 ? (
        <EmptyState
          icon={Check}
          title="Nenhuma tarefa ainda"
          description="Crie a primeira tarefa e vincule a um contato para não perder o follow-up."
          cta={
            <Button size="sm" className="text-xs" onClick={() => setDialogOpen(true)}>
              <Plus className="size-3.5" /> Nova tarefa
            </Button>
          }
        />
      ) : (
        <DataTable data={tasks} columns={columns} pageSize={10} />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nova tarefa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Título</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Ligar para apresentar proposta"
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Contato (opcional)</Label>
              <ContactPicker
                value={contactId}
                onChange={setContactId}
                placeholder="Sem contato vinculado"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Responsável</Label>
                <Select value={assigneeId} onValueChange={(v) => setAssigneeId(v ?? "")}>
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue>
                      {assigneeId
                        ? team.find((u) => u.id === assigneeId)?.name
                        : "Selecionar"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {team.map((u) => (
                      <SelectItem key={u.id} value={u.id} className="text-xs">
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Prazo</Label>
                <Input
                  type="date"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="h-8"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={create} disabled={saving}>
              {saving ? "Salvando..." : "Criar tarefa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============ Empresas (derivado dos contatos reais) ============ */

interface CompanyRow {
  id: string;
  name: string;
  count: number;
  lastAdded: string;
}

/**
 * A aba derivava as empresas percorrendo o array inteiro de contatos. Com os 41
 * mil importados isso obrigava a carregar tudo para mostrar 5 linhas — agora é
 * um `group by` no banco (`contact_companies`).
 */
export function CompaniesTab() {
  const { companies, loading } = useContactCompanies();
  const rows = useMemo<CompanyRow[]>(
    () =>
      companies.map((c, i) => ({
        id: `emp-${i}`,
        name: c.company,
        count: c.contatos,
        lastAdded: c.ultimoContato ?? new Date().toISOString(),
      })),
    [companies]
  );

  const columns: Column<CompanyRow>[] = [
    {
      key: "nome",
      header: "Empresa",
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => <span className="font-medium text-slate-800">{r.name}</span>,
    },
    {
      key: "contatos",
      header: "Nº de contatos",
      sortable: true,
      sortValue: (r) => r.count,
      render: (r) => (
        <Badge variant="secondary" className="text-[10px]">
          {r.count}
        </Badge>
      ),
    },
    {
      key: "ultimo",
      header: "Último contato adicionado",
      sortable: true,
      sortValue: (r) => r.lastAdded,
      render: (r) => (
        <span className="text-slate-500">
          {format(new Date(r.lastAdded), "d MMM yyyy", { locale: ptBR })}
        </span>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-bold text-slate-900">Empresas</h1>
        <Badge variant="secondary">{rows.length} empresa{rows.length === 1 ? "" : "s"}</Badge>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={loading ? "Carregando empresas..." : "Nenhuma empresa ainda"}
          description='As empresas aparecem automaticamente a partir do campo "Empresa" dos seus contatos.'
        />
      ) : (
        <DataTable data={rows} columns={columns} pageSize={10} />
      )}
    </div>
  );
}

/* ============ Campos personalizados (reais) ============ */

export function FieldsTab() {
  const confirm = useConfirm();
  const { fields, loaded } = useContactsModule();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [options, setOptions] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim()) {
      toast.error("Dê um nome ao campo");
      return;
    }
    const opts = options
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    if (type === "dropdown" && opts.length === 0) {
      toast.error("Informe as opções do dropdown (separadas por vírgula)");
      return;
    }
    setSaving(true);
    const ok = await fieldActions.add({ name: name.trim(), type, options: opts });
    setSaving(false);
    if (!ok) {
      toast.error("Não foi possível criar o campo");
      return;
    }
    toast.success(`Campo "${name.trim()}" criado — já aparece no cadastro de contatos`);
    setName("");
    setOptions("");
    setType("text");
    setDialogOpen(false);
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Campos personalizados</h1>
          <p className="text-xs text-slate-500">
            Campos ativos aparecem no cadastro e no detalhe de cada contato.
          </p>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setDialogOpen(true)}>
          <Plus className="size-3.5" /> Novo campo
        </Button>
      </div>
      {loaded && fields.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nenhum campo personalizado"
          description='Crie campos como "Data de aniversário" ou "Plano contratado" para enriquecer seus contatos.'
          cta={
            <Button size="sm" className="text-xs" onClick={() => setDialogOpen(true)}>
              <Plus className="size-3.5" /> Criar campo
            </Button>
          }
        />
      ) : (
        <div className="rounded-xl border bg-white">
          {fields.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-4 border-b px-4 py-3 last:border-0"
            >
              <div className="flex items-center gap-3">
                <p className="text-sm font-medium text-slate-800">{f.name}</p>
                <Badge variant="secondary" className="text-[10px]">
                  {FIELD_TYPE_LABEL[f.type]}
                </Badge>
                {f.type === "dropdown" && (
                  <span className="text-[10px] text-slate-400">{f.options.join(" · ")}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-2 text-[11px] text-slate-500">
                  Ativo
                  <Switch checked={f.active} onCheckedChange={() => void fieldActions.toggle(f.id)} />
                </span>
                <button
                  onClick={async () => {
                    if (!(await confirm({ title: `Excluir o campo "${f.name}"?`, confirmLabel: "Excluir", destructive: true }))) return;
                    (await fieldActions.remove(f.id))
                      ? toast.success("Campo excluído")
                      : toast.error("Não foi possível excluir");
                  }}
                  className="text-slate-300 hover:text-red-500"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo campo personalizado</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome do campo</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Plano contratado"
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={type} onValueChange={(v) => v && setType(v as FieldType)}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue>{FIELD_TYPE_LABEL[type]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => (
                    <SelectItem key={t} value={t} className="text-xs">
                      {FIELD_TYPE_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {type === "dropdown" && (
              <div className="space-y-1">
                <Label className="text-xs">Opções (separadas por vírgula)</Label>
                <Input
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                  placeholder="Mensal, Anual, Trimestral"
                  className="h-8"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={create} disabled={saving}>
              {saving ? "Salvando..." : "Criar campo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
