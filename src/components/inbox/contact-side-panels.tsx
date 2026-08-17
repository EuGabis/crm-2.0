"use client";

import { useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Bell,
  CalendarDays,
  CheckSquare,
  Download,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { appointmentActions, useDbAppointments } from "@/lib/data/repos/db/appointments";
import { useDbStore, useDbTeam } from "@/lib/data/repos/db/contacts";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { taskActions, useContactsModule } from "@/lib/data/repos/db/contacts-module";
import {
  formatFileSize,
  useContactFiles,
  type FileOrigin,
} from "@/lib/data/repos/db/contact-files";
import { conversationActions } from "@/lib/data/repos/db/conversations";
import { useContactNotes } from "@/lib/data/repos/db/notes";
import { cn } from "@/lib/utils";

/**
 * Os quatro painéis da barra lateral da conversa: Tarefas, Observações,
 * Compromissos e Arquivos.
 *
 * Eram decoração — empty state fixo e "Adicionar" respondendo
 * `toast.info("chega com o backend")`. Cada um passa a mexer no dado real, com
 * as ações que já existiam nos repos; nenhum backend novo foi preciso:
 *   * Tarefas      → `tasks` (migração 0002), taskActions.add/toggle/remove
 *   * Observações  → mensagem interna da conversa, como no resto do CRM
 *   * Compromissos → `appointments` (0001/0041/0043), vinculados ao contato
 *   * Arquivos     → anexos das conversas do contato (bucket da 0019)
 */

const fmtDate = (v: string | null | undefined, withTime = false) =>
  v
    ? format(new Date(v), withTime ? "dd/MM/yyyy HH:mm" : "dd/MM/yyyy", { locale: ptBR })
    : "—";

export function PanelShell({
  title,
  children,
  searchPlaceholder,
  search,
  onSearch,
  onAdd,
  addLabel = "Adicionar",
  adding,
  form,
}: {
  title: string;
  children: React.ReactNode;
  searchPlaceholder?: string;
  search?: string;
  onSearch?: (v: string) => void;
  onAdd?: () => void;
  addLabel?: string;
  adding?: boolean;
  form?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-xs font-bold text-slate-700">{title}</h3>
        {onAdd && (
          <button
            onClick={onAdd}
            className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline"
          >
            {adding ? <X className="size-3" /> : <Plus className="size-3" />}
            {adding ? "Cancelar" : addLabel}
          </button>
        )}
      </div>
      {searchPlaceholder && (
        <div className="flex items-center gap-1.5 border-b px-3 py-1.5">
          <Search className="size-3 text-slate-400" />
          <Input
            value={search ?? ""}
            onChange={(e) => onSearch?.(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-6 border-0 p-0 text-[11px] shadow-none focus-visible:ring-0"
          />
        </div>
      )}
      {form && <div className="space-y-1.5 border-b bg-slate-50 p-3">{form}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin]">{children}</div>
    </div>
  );
}

export function SmallEmpty({
  icon,
  title,
  text,
}: {
  icon: typeof User;
  title: string;
  text: string;
}) {
  const Icon = icon;
  return (
    <div className="flex flex-col items-center gap-1.5 py-8 text-center">
      <Icon className="size-6 text-slate-300" />
      <p className="text-xs font-semibold text-slate-600">{title}</p>
      <p className="text-[11px] text-slate-400">{text}</p>
    </div>
  );
}

/**
 * Antecedência do lembrete da tarefa (migração 0050). Espelha a lista dos
 * compromissos em /calendarios — mesma cabeça, mesmas opções.
 * `Select` do Base UI não aceita item com value vazio, daí o sentinela.
 */
const NO_REMINDER = "__none__";
const TASK_REMINDERS: { value: string; label: string }[] = [
  { value: NO_REMINDER, label: "Sem lembrete" },
  { value: "0", label: "Na hora do prazo" },
  { value: "15", label: "15 minutos antes" },
  { value: "30", label: "30 minutos antes" },
  { value: "60", label: "1 hora antes" },
  { value: "120", label: "2 horas antes" },
  { value: "1440", label: "1 dia antes" },
];

const primaryBtn =
  "rounded-md bg-indigo-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-indigo-600 disabled:opacity-60";

/* --------------------------------- Tarefas -------------------------------- */

export function TasksPanel({ contactId }: { contactId: string }) {
  const { tasks } = useContactsModule();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [reminder, setReminder] = useState(NO_REMINDER);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () =>
      tasks
        .filter((t) => t.contactId === contactId)
        .filter((t) => t.title.toLowerCase().includes(query.trim().toLowerCase()))
        // Pendentes primeiro; dentro de cada grupo, prazo mais próximo antes.
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
          return (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
        }),
    [tasks, contactId, query],
  );

  const save = async () => {
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    const ok = await taskActions.add({
      title: t,
      contactId,
      assigneeId: useDbStore.getState().userId,
      dueAt: due ? new Date(`${due}T09:00:00`).toISOString() : null,
      // Lembrete sem prazo não teria de quando contar.
      reminderMinutes: due && reminder !== NO_REMINDER ? Number(reminder) : null,
    });
    setBusy(false);
    if (!ok) {
      toast.error("Não foi possível criar a tarefa");
      return;
    }
    setTitle("");
    setDue("");
    setReminder(NO_REMINDER);
    setAdding(false);
    toast.success("Tarefa criada");
  };

  return (
    <PanelShell
      title="Tarefas"
      searchPlaceholder="Pesquisar por título"
      search={query}
      onSearch={setQuery}
      onAdd={() => setAdding((a) => !a)}
      adding={adding}
      form={
        adding && (
          <>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void save()}
              placeholder="Ex.: ligar para confirmar interesse"
              className="h-7 text-xs"
            />
            <Input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="h-7 text-xs"
            />
            {/* Só faz sentido com prazo definido: o lembrete conta a partir dele. */}
            {due && (
              <Select value={reminder} onValueChange={(v) => setReminder(v ?? NO_REMINDER)}>
                <SelectTrigger className="h-7 w-full text-xs">
                  <SelectValue>
                    {TASK_REMINDERS.find((r) => r.value === reminder)?.label ?? "Sem lembrete"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TASK_REMINDERS.map((r) => (
                    <SelectItem key={r.value} value={r.value} className="text-xs">
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <button onClick={() => void save()} disabled={busy || !title.trim()} className={primaryBtn}>
              {busy ? "Criando..." : "Criar tarefa"}
            </button>
          </>
        )
      }
    >
      {rows.length === 0 ? (
        <SmallEmpty
          icon={CheckSquare}
          title={query ? "Nenhuma tarefa encontrada" : "Ainda não há tarefas"}
          text={
            query
              ? "Tente outro termo."
              : "Mantenha a organização criando sua primeira tarefa."
          }
        />
      ) : (
        <ul className="space-y-1">
          {rows.map((t) => (
            <li key={t.id} className="flex items-start gap-2 rounded-md border bg-white p-2">
              <Checkbox
                checked={t.status === "done"}
                onCheckedChange={async () => {
                  if (!(await taskActions.toggle(t.id)))
                    toast.error("Não foi possível atualizar a tarefa");
                }}
                aria-label={t.status === "done" ? "Reabrir tarefa" : "Concluir tarefa"}
                className="mt-0.5 size-3.5"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-[11px]",
                    t.status === "done" ? "text-slate-400 line-through" : "text-slate-700",
                  )}
                >
                  {t.title}
                </p>
                <p className="flex items-center gap-1 text-[10px] text-slate-400">
                  {t.dueAt ? `Prazo ${fmtDate(t.dueAt)}` : "Sem prazo"}
                  {t.reminderMinutes !== null && t.reminderMinutes !== undefined && (
                    <span title="Com lembrete" className="flex items-center gap-0.5 text-indigo-500">
                      <Bell className="size-2.5" />
                      {TASK_REMINDERS.find((r) => r.value === String(t.reminderMinutes))?.label ??
                        "Com lembrete"}
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={async () => {
                  if (!window.confirm("Excluir esta tarefa?")) return;
                  if (await taskActions.remove(t.id)) toast.success("Tarefa excluída");
                  else toast.error("Não foi possível excluir");
                }}
                title="Excluir tarefa"
                className="shrink-0 text-slate-300 hover:text-red-500"
              >
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}

/* ------------------------------- Observações ------------------------------ */

export function NotesPanel({ contactId }: { contactId: string }) {
  const { notes, reload } = useContactNotes(contactId);
  const team = useDbTeam();
  const { me, isAdmin } = useMyMembership();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () => notes.filter((n) => n.body.toLowerCase().includes(query.trim().toLowerCase())),
    [notes, query],
  );

  const save = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    const conversationId = await conversationActions.openForContact(contactId);
    const ok =
      !!conversationId &&
      (await conversationActions.send(conversationId, {
        direction: "out",
        type: "text",
        channel: "whatsapp",
        body: text,
        internal: true,
      }));
    setBusy(false);
    if (!ok) {
      toast.error("Não foi possível salvar a observação");
      return;
    }
    setBody("");
    setAdding(false);
    await reload();
    toast.success("Observação registrada");
  };

  return (
    <PanelShell
      title="Observações"
      searchPlaceholder="Pesquisar notas"
      search={query}
      onSearch={setQuery}
      onAdd={() => setAdding((a) => !a)}
      adding={adding}
      form={
        adding && (
          <>
            <Textarea
              autoFocus
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="O que ficou combinado?"
              className="min-h-16 text-xs"
            />
            <p className="text-[10px] leading-tight text-slate-400">
              Fica como comentário interno na conversa — o cliente não vê.
            </p>
            <button onClick={() => void save()} disabled={busy || !body.trim()} className={primaryBtn}>
              {busy ? "Salvando..." : "Salvar observação"}
            </button>
          </>
        )
      }
    >
      {rows.length === 0 ? (
        <SmallEmpty
          icon={Pencil}
          title={query ? "Nenhuma observação encontrada" : "Ainda não há observações"}
          text={query ? "Tente outro termo." : "Adicione a primeira observação sobre este lead."}
        />
      ) : (
        <ul className="space-y-1.5">
          {rows.map((n) => {
            // Regra da 0051: o autor apaga a própria nota; admin apaga qualquer
            // uma. Nota anterior à migração não tem autor — só admin.
            const canDelete = isAdmin || (!!n.authorId && n.authorId === me?.userId);
            const author = n.authorId ? team.find((u) => u.id === n.authorId) : null;
            return (
              <li
                key={n.id}
                className="group flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap text-[11px] text-slate-700">{n.body}</p>
                  <p className="mt-1 text-[10px] text-amber-700">
                    {fmtDate(n.at, true)}
                    {author ? ` · ${author.name}` : ""}
                  </p>
                </div>
                {canDelete && (
                  <button
                    onClick={async () => {
                      if (!window.confirm("Excluir esta observação?")) return;
                      if (await conversationActions.removeMessage(n.id)) {
                        await reload();
                        toast.success("Observação excluída");
                      } else {
                        toast.error("Não foi possível excluir");
                      }
                    }}
                    title="Excluir observação"
                    className="shrink-0 text-amber-300 hover:text-red-500 group-hover:text-amber-500"
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}

/* ------------------------------ Compromissos ------------------------------ */

export function AppointmentsPanel({ contactId }: { contactId: string }) {
  const { appointments } = useDbAppointments();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () =>
      appointments
        .filter((a) => a.contactId === contactId)
        .filter((a) =>
          `${a.title} ${a.calendar}`.toLowerCase().includes(query.trim().toLowerCase()),
        )
        .sort((a, b) => b.start.localeCompare(a.start)),
    [appointments, contactId, query],
  );

  const save = async () => {
    const t = title.trim();
    if (!t || !date) {
      toast.error("Preencha título e data");
      return;
    }
    const start = new Date(`${date}T${time}:00`);
    setBusy(true);
    const ok = await appointmentActions.add({
      title: t,
      contactId,
      start: start.toISOString(),
      end: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    });
    setBusy(false);
    if (!ok) {
      toast.error("Não foi possível agendar");
      return;
    }
    setTitle("");
    setDate("");
    setAdding(false);
    toast.success("Compromisso criado — veja em Calendários");
  };

  // Inicializador preguiçoso: `Date.now()` solto no corpo do render quebra a
  // regra de pureza do React (mesmo padrão de marketing/countdowns-tab). Só
  // decide a cor de "já passou", então não precisa acompanhar o relógio.
  const [now] = useState(() => Date.now());

  return (
    <PanelShell
      title="Compromissos"
      searchPlaceholder="Pesquisar por título"
      search={query}
      onSearch={setQuery}
      onAdd={() => setAdding((a) => !a)}
      adding={adding}
      form={
        adding && (
          <>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título da reunião"
              className="h-7 text-xs"
            />
            <div className="flex gap-1.5">
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-7 text-xs"
              />
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-7 w-24 text-xs"
              />
            </div>
            <p className="text-[10px] text-slate-400">Duração de 1 hora.</p>
            <button onClick={() => void save()} disabled={busy || !title.trim() || !date} className={primaryBtn}>
              {busy ? "Agendando..." : "Agendar"}
            </button>
          </>
        )
      }
    >
      {rows.length === 0 ? (
        <SmallEmpty
          icon={CalendarDays}
          title={query ? "Nenhum compromisso encontrado" : "Ainda não há compromissos"}
          text={
            query
              ? "Tente outro termo."
              : "Dê início ao processo agendando o primeiro compromisso."
          }
        />
      ) : (
        <ul className="space-y-1">
          {rows.map((a) => {
            const past = new Date(a.start).getTime() < now;
            return (
              <li key={a.id} className="flex items-start gap-2 rounded-md border bg-white p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-slate-700">{a.title}</p>
                  <p className={cn("text-[10px]", past ? "text-slate-400" : "text-indigo-600")}>
                    {fmtDate(a.start, true)}
                    {past ? " · já passou" : ""}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    if (!window.confirm("Excluir este compromisso?")) return;
                    if (await appointmentActions.remove(a.id))
                      toast.success("Compromisso excluído");
                    else toast.error("Não foi possível excluir");
                  }}
                  title="Excluir compromisso"
                  className="shrink-0 text-slate-300 hover:text-red-500"
                >
                  <Trash2 className="size-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PanelShell>
  );
}

/* --------------------------------- Arquivos ------------------------------- */

const FILE_TABS: { key: "todos" | FileOrigin; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "interno", label: "Interno" },
  { key: "enviado", label: "Enviado" },
  { key: "recebido", label: "Recebido" },
];

/** Extensão/mime → o `kind` que a tabela de mensagens usa. */
function kindOf(file: File): "image" | "video" | "audio" | "file" {
  const t = file.type;
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  return "file";
}

export function FilesPanel({ contactId }: { contactId: string }) {
  const { files, reload } = useContactFiles(contactId);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"todos" | FileOrigin>("todos");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(
    () =>
      files
        .filter((f) => tab === "todos" || f.origin === tab)
        .filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase())),
    [files, tab, query],
  );

  const upload = async (file: File) => {
    setBusy(true);
    const conversationId = await conversationActions.openForContact(contactId);
    if (!conversationId) {
      setBusy(false);
      toast.error("Não foi possível abrir a conversa deste contato");
      return;
    }
    // `internal: true`: sobe o documento SEM despachar para o cliente. Quem
    // entrega no WhatsApp é o composer, pela rota send-media.
    const res = await conversationActions.sendMedia(conversationId, {
      file,
      kind: kindOf(file),
      channel: "whatsapp",
      internal: true,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível enviar o arquivo");
      return;
    }
    await reload();
    toast.success("Arquivo anexado (interno — o cliente não recebeu)");
  };

  /** O bucket é privado: a URL é assinada na hora do clique. */
  const open = async (path: string) => {
    setOpening(path);
    const url = await conversationActions.mediaUrl(path);
    setOpening(null);
    if (!url) {
      toast.error("Não foi possível abrir o arquivo");
      return;
    }
    window.open(url, "_blank", "noopener");
  };

  return (
    <PanelShell
      title="Arquivos"
      searchPlaceholder="Pesquisar por documento"
      search={query}
      onSearch={setQuery}
      addLabel={busy ? "Enviando..." : "Adicionar"}
      onAdd={() => !busy && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // permite subir o mesmo arquivo de novo
          if (f) void upload(f);
        }}
      />
      <div className="mb-2 flex gap-1">
        {FILE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              tab === t.key ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <SmallEmpty
          icon={FileText}
          title={query || tab !== "todos" ? "Nenhum documento aqui" : "Ainda não há documentos"}
          text={
            query || tab !== "todos"
              ? "Tente outro termo ou outra aba."
              : "Carregue ou envie documentos para vê-los aqui."
          }
        />
      ) : (
        <ul className="space-y-1">
          {rows.map((f) => (
            <li key={f.id} className="flex items-start gap-2 rounded-md border bg-white p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-slate-700">{f.name}</p>
                <p className="text-[10px] text-slate-400">
                  {fmtDate(f.at, true)} · {formatFileSize(f.size)} · {f.origin}
                </p>
              </div>
              <button
                onClick={() => void open(f.path)}
                title="Abrir arquivo"
                className="shrink-0 text-slate-400 hover:text-indigo-600"
              >
                {opening === f.path ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
