"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Building2,
  Copy,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Plus,
  ShieldCheck,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { Textarea } from "@/components/ui/textarea";
import { brand } from "@/lib/config/brand";
import { PERMISSION_MODULES } from "@/lib/config/nav";
import {
  canAccess,
  departmentActions,
  teamActions,
  useMyMembership,
  useTeam,
  type Department,
  type MemberRole,
  type ModulePermissions,
  type TeamMember,
} from "@/lib/data/repos/db/team";
import { useWhatsappChannels } from "@/lib/data/repos/db/whatsapp";
import { cn } from "@/lib/utils";

import { useConfirm } from "@/components/shared/confirm";
const ROLE_LABEL: Record<MemberRole, string> = {
  admin: "Administrador",
  user: "Usuário",
};

const MODULE_KEYS = PERMISSION_MODULES.map((m) => m.key);
const SEM_DEPARTAMENTO = "__nenhum__"; // Select do Base UI não aceita value vazio

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function allowedCount(p: ModulePermissions) {
  return MODULE_KEYS.filter((k) => p[k] !== false).length;
}

export default function DepartamentosPage() {
  const confirm = useConfirm();
  const { members, invitations, departments, loaded, loading } = useTeam();
  const { isAdmin, me, loaded: meLoaded } = useMyMembership();
  const { channels } = useWhatsappChannels();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [depDialog, setDepDialog] = useState<{ open: boolean; department: Department | null }>({
    open: false,
    department: null,
  });

  const pendingInvites = useMemo(
    () => invitations.filter((i) => i.status === "pending"),
    [invitations]
  );

  const editing = members.find((m) => m.userId === editingId) ?? null;

  if (loading && !loaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="size-4 animate-spin" /> Carregando departamentos...
      </div>
    );
  }

  if (meLoaded && !isAdmin) {
    return (
      <div className="max-w-lg rounded-xl border bg-white p-6">
        <ShieldCheck className="mb-3 size-6 text-slate-400" />
        <h1 className="text-lg font-bold text-slate-900">Acesso restrito</h1>
        <p className="mt-1 text-sm text-slate-500">
          Somente administradores podem gerenciar departamentos e usuários. Fale com um
          administrador da sua empresa se precisar de acesso.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Departamentos</h1>
          <p className="text-xs text-slate-500">
            Cada departamento define o que sua equipe acessa. Usuários ilimitados, sem custo
            por assento.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setDepDialog({ open: true, department: null })}
          >
            <Plus className="size-3.5" /> Novo departamento
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setInviteOpen(true)}>
            <Plus className="size-3.5" /> Convidar usuário
          </Button>
        </div>
      </div>

      {/* Departamentos */}
      {departments.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-8 text-center">
          <Building2 className="mx-auto mb-2 size-6 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">Nenhum departamento ainda</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
            Crie um departamento para definir de uma vez o que um grupo de pessoas acessa, em
            vez de repetir a lista de módulos usuário por usuário.
          </p>
          <Button
            size="sm"
            className="mt-3 h-8 gap-1.5 text-xs"
            onClick={() => setDepDialog({ open: true, department: null })}
          >
            <Plus className="size-3.5" /> Criar departamento
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {departments.map((d) => {
            const people = members.filter((m) => m.departmentId === d.id);
            return (
              <div key={d.id} className="flex flex-col rounded-xl border bg-white p-4">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">{d.name}</p>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => setDepDialog({ open: true, department: d })}
                      title="Editar departamento"
                      className="flex size-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        if (
                          !(await confirm({ title: people.length > 0
                              ? `Excluir "${d.name}"? Os ${people.length} usuário(s) ficam sem departamento e voltam a enxergar tudo que não estiver bloqueado individualmente.`
                              : `Excluir o departamento "${d.name}"?`, confirmLabel: "Excluir", destructive: true }))
                        )
                          return;
                        const res = await departmentActions.remove(d.id);
                        res.ok
                          ? toast.success("Departamento excluído")
                          : toast.error(res.error ?? "Não foi possível excluir");
                      }}
                      title="Excluir departamento"
                      className="flex size-6 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
                {d.description && (
                  <p className="mb-2 text-[11px] leading-tight text-slate-500">{d.description}</p>
                )}
                <div className="mb-3 flex flex-wrap gap-1">
                  {PERMISSION_MODULES.filter((m) => d.permissions[m.key] === true).map((m) => (
                    <span
                      key={m.key}
                      className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                    >
                      {m.label}
                    </span>
                  ))}
                  {allowedCount(d.permissions) === 0 && (
                    <span className="text-[10px] text-slate-400">Nenhum módulo liberado</span>
                  )}
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-1">
                  <Phone className="size-3 shrink-0 text-slate-300" />
                  {d.channelIds.length === 0 ? (
                    <span className="text-[10px] text-slate-400">Todos os números</span>
                  ) : (
                    d.channelIds.map((id) => {
                      const c = channels.find((x) => x.id === id);
                      return (
                        <span
                          key={id}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
                        >
                          {c ? `${c.name} · ${c.phoneE164}` : "número removido"}
                        </span>
                      );
                    })
                  )}
                </div>
                <div className="mt-auto border-t pt-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {people.length} usuário{people.length === 1 ? "" : "s"}
                  </p>
                  {people.length === 0 ? (
                    <p className="text-[11px] text-slate-400">
                      Ninguém vinculado — defina o departamento na tabela abaixo.
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {people.map((p) => (
                        <span
                          key={p.userId}
                          className="flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-2 text-[11px] text-slate-700"
                        >
                          <Avatar className="size-4">
                            <AvatarFallback
                              className="text-[7px] font-bold text-white"
                              style={{ background: p.color }}
                            >
                              {initials(p.name)}
                            </AvatarFallback>
                          </Avatar>
                          {p.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Usuários */}
      <h2 className="mb-2 mt-6 text-sm font-bold text-slate-900">Usuários</h2>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-[11px] text-slate-400">
              <th className="px-4 py-2.5 font-medium">Nome</th>
              <th className="px-4 py-2.5 font-medium">E-mail</th>
              <th className="px-4 py-2.5 font-medium">Função</th>
              <th className="px-4 py-2.5 font-medium">Departamento</th>
              <th className="px-4 py-2.5 font-medium">Visibilidade</th>
              <th className="px-4 py-2.5 font-medium">Módulos</th>
              <th className="px-4 py-2.5 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isMe = m.userId === me?.userId;
              const dep = departments.find((d) => d.id === m.departmentId) ?? null;
              const exceptions = Object.keys(m.permissions ?? {}).length;
              const allowed = MODULE_KEYS.filter((k) =>
                canAccess(k, m, departments)
              ).length;
              return (
                <tr key={m.userId} className="border-b last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2 font-medium text-slate-800">
                      <Avatar className="size-6">
                        <AvatarFallback
                          className="text-[9px] font-bold text-white"
                          style={{ background: m.color }}
                        >
                          {initials(m.name)}
                        </AvatarFallback>
                      </Avatar>
                      {m.name}
                      {isMe && (
                        <span className="text-[10px] font-normal text-slate-400">(você)</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{m.email}</td>
                  <td className="px-4 py-2.5">
                    <Badge
                      variant="secondary"
                      className={m.role === "admin" ? "bg-indigo-100 text-indigo-700" : ""}
                    >
                      {ROLE_LABEL[m.role]}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    {m.role === "admin" ? (
                      <span className="text-[11px] text-slate-400">Não se aplica</span>
                    ) : (
                      <Select
                        value={m.departmentId ?? SEM_DEPARTAMENTO}
                        onValueChange={async (v) => {
                          if (!v) return;
                          const res = await teamActions.updateMember(m.userId, {
                            departmentId: v === SEM_DEPARTAMENTO ? null : v,
                          });
                          res.ok
                            ? toast.success("Departamento atualizado")
                            : toast.error(res.error ?? "Não foi possível salvar");
                        }}
                      >
                        <SelectTrigger className="h-7 w-40 text-[11px]" size="sm">
                          <SelectValue>{dep?.name ?? "Sem departamento"}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SEM_DEPARTAMENTO} className="text-xs">
                            Sem departamento
                          </SelectItem>
                          {departments.map((d) => (
                            <SelectItem key={d.id} value={d.id} className="text-xs">
                              {d.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {m.role === "admin"
                      ? "Todos os dados"
                      : m.onlyAssigned
                        ? "Apenas atribuídos a ele"
                        : "Todos os dados"}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {m.role === "admin" ? (
                      "Todos"
                    ) : (
                      <span>
                        {allowed} de {MODULE_KEYS.length}
                        {exceptions > 0 && (
                          <span className="ml-1 text-amber-600">
                            ({exceptions} exceç{exceptions === 1 ? "ão" : "ões"})
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      <button
                        onClick={() => setEditingId(m.userId)}
                        title="Editar função e acessos"
                        className="flex size-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        <UserCog className="size-3.5" />
                      </button>
                      <button
                        onClick={async () => {
                          if (
                            !(await confirm({ title: `Remover ${m.name} da equipe? A pessoa perde o acesso a esta empresa.`, confirmLabel: "Remover", destructive: true }))
                          )
                            return;
                          const res = await teamActions.removeMember(m.userId);
                          res.ok
                            ? toast.success("Usuário removido da equipe")
                            : toast.error(res.error ?? "Não foi possível remover");
                        }}
                        title="Remover da equipe"
                        className="flex size-6 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Convites pendentes */}
      {pendingInvites.length > 0 && (
        <div className="mt-5 rounded-xl border bg-white">
          <div className="flex items-center gap-2 border-b px-4 py-2.5">
            <Mail className="size-3.5 text-slate-400" />
            <p className="text-sm font-semibold text-slate-800">Convites pendentes</p>
            <Badge variant="secondary" className="text-[10px]">
              {pendingInvites.length}
            </Badge>
          </div>
          <table className="w-full text-left text-xs">
            <tbody>
              {pendingInvites.map((i) => {
                const dep = departments.find((d) => d.id === i.departmentId) ?? null;
                return (
                  <tr key={i.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{i.email}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="secondary">{ROLE_LABEL[i.role]}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{dep?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      Enviado em {format(new Date(i.createdAt), "d MMM yyyy", { locale: ptBR })}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            void navigator.clipboard.writeText(`${window.location.origin}/login`);
                            toast.success("Link de acesso copiado — envie para a pessoa");
                          }}
                          className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:underline"
                        >
                          <Copy className="size-3" /> Copiar link
                        </button>
                        <button
                          onClick={async () => {
                            if (!(await confirm({ title: `Cancelar o convite de ${i.email}?`, confirmLabel: "Sim, cancelar", destructive: true }))) return;
                            (await teamActions.deleteInvite(i.id))
                              ? toast.success("Convite cancelado")
                              : toast.error("Não foi possível cancelar");
                          }}
                          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-500"
                        >
                          <X className="size-3" /> Cancelar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t px-4 py-2 text-[11px] text-slate-400">
            A pessoa entra automaticamente na sua empresa — e no departamento escolhido — ao
            criar a conta com este e-mail.
          </p>
        </div>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} departments={departments} />
      <DepartmentDialog
        open={depDialog.open}
        department={depDialog.department}
        onOpenChange={(o) => setDepDialog({ open: o, department: o ? depDialog.department : null })}
      />
      {editing && (
        <PermissionsDialog
          member={editing}
          departments={departments}
          open={!!editing}
          onOpenChange={(o) => !o && setEditingId(null)}
        />
      )}
    </div>
  );
}

/* --------------------------- Grade de módulos --------------------------- */

function ModuleGrid({
  disabled,
  isAllowed,
  onToggle,
  hint,
  baseline,
}: {
  disabled?: boolean;
  isAllowed: (key: string) => boolean;
  onToggle: (key: string, allowed: boolean) => void;
  hint?: string;
  /** Valor do departamento, para marcar o que é exceção. */
  baseline?: (key: string) => boolean | undefined;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <Label className="text-xs font-semibold">Módulos visíveis</Label>
        {disabled ? (
          <span className="text-[10px] text-slate-400">{hint}</span>
        ) : (
          <div className="flex gap-2 text-[10px]">
            <button
              className="text-indigo-600 hover:underline"
              onClick={() => PERMISSION_MODULES.forEach((m) => onToggle(m.key, true))}
            >
              Liberar todos
            </button>
            <button
              className="text-slate-400 hover:underline"
              onClick={() => PERMISSION_MODULES.forEach((m) => onToggle(m.key, false))}
            >
              Bloquear todos
            </button>
          </div>
        )}
      </div>
      <div
        className={cn(
          "grid max-h-56 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-lg border p-3",
          disabled && "opacity-50"
        )}
      >
        {PERMISSION_MODULES.map((m) => {
          const allowed = isAllowed(m.key);
          const base = baseline?.(m.key);
          const isException = base !== undefined && base !== allowed;
          return (
            <Label
              key={m.key}
              className="flex items-center gap-2 text-[11px] font-normal text-slate-600"
            >
              <Checkbox
                checked={disabled ? true : allowed}
                disabled={disabled}
                onCheckedChange={(v) => onToggle(m.key, Boolean(v))}
              />
              {m.label}
              {isException && (
                <span className="text-[9px] font-semibold text-amber-600">exceção</span>
              )}
            </Label>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------- Criar/editar departamento --------------------------- */

function DepartmentDialog({
  department,
  open,
  onOpenChange,
}: {
  department: Department | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { channels } = useWhatsappChannels();
  const { members } = useTeam();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<ModulePermissions>({});
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [leadPool, setLeadPool] = useState<string[]>([]);
  const [sweepEnabled, setSweepEnabled] = useState(false);
  const [sweepPct, setSweepPct] = useState("30");
  const [saving, setSaving] = useState(false);

  // Membros deste departamento — só eles entram no rodízio.
  const deptMembers = useMemo(
    () => (department ? members.filter((m) => m.departmentId === department.id) : []),
    [members, department]
  );

  useEffect(() => {
    setName(department?.name ?? "");
    setDescription(department?.description ?? "");
    // Departamento novo começa com tudo bloqueado: liberar é decisão explícita.
    setPermissions(
      department?.permissions ??
        Object.fromEntries(MODULE_KEYS.map((k) => [k, false]))
    );
    setChannelIds(department?.channelIds ?? []);
    setLeadPool(department?.leadPool ?? []);
    setSweepEnabled(department?.sweepEnabled ?? false);
    setSweepPct(String(department?.sweepPct ?? 30));
  }, [department, open]);

  const toggleChannel = (id: string) =>
    setChannelIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  // Vazio = todos do departamento. Ao desmarcar o 1º, materializa a lista completa.
  const poolChecked = (userId: string) =>
    leadPool.length === 0 || leadPool.includes(userId);
  const togglePool = (userId: string) =>
    setLeadPool((prev) => {
      const base = prev.length ? prev : deptMembers.map((m) => m.userId);
      return base.includes(userId) ? base.filter((id) => id !== userId) : [...base, userId];
    });

  const save = async () => {
    if (!name.trim()) {
      toast.error("Dê um nome ao departamento");
      return;
    }
    setSaving(true);
    const res = department
      ? await departmentActions.update(department.id, {
          name,
          description,
          permissions,
          channelIds,
          leadPool,
          sweepEnabled,
          sweepPct: Number(sweepPct) || 30,
        })
      : await departmentActions.create({
          name,
          description,
          permissions,
          channelIds,
          leadPool,
          sweepEnabled,
          sweepPct: Number(sweepPct) || 30,
        });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível salvar");
      return;
    }
    toast.success(department ? "Departamento atualizado" : "Departamento criado");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {department ? `Editar ${department.name}` : "Novo departamento"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Nome *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Financeiro"
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Descrição</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="O que essa equipe faz no dia a dia"
              className="min-h-16 text-xs"
            />
          </div>
          <ModuleGrid
            isAllowed={(k) => permissions[k] === true}
            onToggle={(k, allowed) => setPermissions((p) => ({ ...p, [k]: allowed }))}
          />

          {/* Segmentação por número (migração 0034) */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-xs font-semibold">Números de WhatsApp atendidos</Label>
              {channelIds.length > 0 && (
                <button
                  className="text-[10px] text-slate-400 hover:underline"
                  onClick={() => setChannelIds([])}
                >
                  Limpar
                </button>
              )}
            </div>
            {channels.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-[11px] text-slate-400">
                Nenhum número cadastrado ainda. Cadastre em Canais de atendimento
                (/whatsapp) para poder segmentar as conversas.
              </p>
            ) : (
              <div className="space-y-1.5 rounded-lg border p-3">
                {channels.map((c) => (
                  <Label
                    key={c.id}
                    className="flex items-center gap-2 text-[11px] font-normal text-slate-600"
                  >
                    <Checkbox
                      checked={channelIds.includes(c.id)}
                      onCheckedChange={() => toggleChannel(c.id)}
                    />
                    <Phone className="size-3 text-slate-400" />
                    <span className="font-medium text-slate-700">{c.name}</span>
                    <span className="text-slate-400">{c.phoneE164}</span>
                    {!c.active && (
                      <span className="text-[9px] text-amber-600">inativo</span>
                    )}
                  </Label>
                ))}
              </div>
            )}
            <p className="mt-1 text-[10px] leading-tight text-slate-400">
              {channelIds.length === 0
                ? "Nenhum número marcado = sem restrição: o departamento vê conversas de qualquer número."
                : `Quem for deste departamento verá apenas as conversas ${channelIds.length === 1 ? "do número marcado" : `dos ${channelIds.length} números marcados`} — mais as conversas de outros canais (e-mail, Instagram), que não têm número.`}
            </p>
          </div>

          {/* Distribuição de leads por rodízio (migração 0057) */}
          <div>
            <Label className="text-xs font-semibold">Distribuição de leads (rodízio)</Label>
            {!department ? (
              <p className="mt-1 rounded-lg border border-dashed p-3 text-[11px] text-slate-400">
                Crie o departamento e vincule os atendentes primeiro. Depois volte aqui para
                escolher quem entra no rodízio de leads.
              </p>
            ) : deptMembers.length === 0 ? (
              <p className="mt-1 rounded-lg border border-dashed p-3 text-[11px] text-slate-400">
                Nenhum atendente neste departamento ainda. Defina o departamento das pessoas na
                tabela de usuários para poder distribuir leads.
              </p>
            ) : (
              <div className="mt-1 space-y-1.5 rounded-lg border p-3">
                {deptMembers.map((m) => (
                  <Label
                    key={m.userId}
                    className="flex items-center gap-2 text-[11px] font-normal text-slate-600"
                  >
                    <Checkbox
                      checked={poolChecked(m.userId)}
                      onCheckedChange={() => togglePool(m.userId)}
                    />
                    <span className="font-medium text-slate-700">{m.name}</span>
                    {m.role === "admin" && (
                      <span className="rounded bg-slate-100 px-1 text-[9px] font-semibold text-slate-500">
                        admin
                      </span>
                    )}
                  </Label>
                ))}
              </div>
            )}
            <p className="mt-1 text-[10px] leading-tight text-slate-400">
              Leads <strong>quentes</strong> dos números deste departamento vão, em rodízio,
              para quem estiver <strong>online</strong> (ativo nos últimos 5 min). Desmarque
              quem não deve receber — ninguém marcado = todos recebem.
            </p>
          </div>

          {/* Varredura horária (migração 0058) */}
          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-semibold">Varredura automática (a cada 1h)</Label>
              <Switch checked={sweepEnabled} onCheckedChange={(v) => setSweepEnabled(Boolean(v))} />
            </div>
            {sweepEnabled && (
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                A cada hora, distribui
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={sweepPct}
                  onChange={(e) => setSweepPct(e.target.value)}
                  className="h-7 w-16 text-xs"
                />
                % dos leads parados para quem estiver online.
              </div>
            )}
            <p className="mt-1 text-[10px] leading-tight text-slate-400">
              Pega os leads quentes que ficaram <strong>aguardando distribuição</strong> (ninguém
              online na hora) e escoa uma parte a cada hora. Independe da distribuição em tempo real.
            </p>
          </div>

          <p className="text-[10px] leading-tight text-slate-400">
            Vale para quem é <strong>Usuário</strong>. Administradores acessam tudo,
            independentemente do departamento.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando..." : department ? "Salvar" : "Criar departamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- Convite ----------------------------- */

function InviteDialog({
  open,
  onOpenChange,
  departments,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  departments: Department[];
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("user");
  const [onlyAssigned, setOnlyAssigned] = useState(false);
  const [departmentId, setDepartmentId] = useState<string>(SEM_DEPARTAMENTO);
  const [permissions, setPermissions] = useState<ModulePermissions>({});
  const [saving, setSaving] = useState(false);

  const dep = departments.find((d) => d.id === departmentId) ?? null;
  const baseline = (key: string) => dep?.permissions?.[key];
  const effective = (key: string) =>
    canAccess(key, { role: "user", permissions, departmentId: dep?.id ?? null }, departments);

  // Trocar de departamento não apaga as exceções escolhidas — só descarta as
  // que passaram a coincidir com o novo padrão (deixariam de ser exceção).
  useEffect(() => {
    setPermissions((p) => {
      const next: ModulePermissions = {};
      for (const [k, v] of Object.entries(p)) {
        const base = baseline(k);
        if (base !== v && !(base === undefined && v === true)) next[k] = v;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId]);

  const toggle = (key: string, allowed: boolean) =>
    setPermissions((p) => {
      const base = baseline(key);
      const next = { ...p };
      if (base === allowed || (base === undefined && allowed)) delete next[key];
      else next[key] = allowed;
      return next;
    });

  const submit = async () => {
    if (!email.includes("@")) {
      toast.error("Informe um e-mail válido");
      return;
    }
    setSaving(true);
    const res = await teamActions.invite({
      email,
      role,
      onlyAssigned,
      // Só as divergências em relação ao departamento.
      permissions: role === "admin" ? {} : permissions,
      departmentId: departmentId === SEM_DEPARTAMENTO ? null : departmentId,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível convidar");
      return;
    }
    if (res.warning) {
      toast.warning(res.warning, { duration: 8000 });
    } else {
      toast.success(`Convite enviado por e-mail para ${email.trim().toLowerCase()}`);
    }
    setEmail("");
    setRole("user");
    setOnlyAssigned(false);
    setDepartmentId(SEM_DEPARTAMENTO);
    setPermissions({});
    onOpenChange(false);
  };

  const exceptions = Object.keys(permissions).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convidar para a equipe</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">E-mail *</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="secretaria@empresa.com.br"
              className="h-8"
            />
            <p className="text-[10px] text-slate-400">
              Enviamos um convite com a identidade do {brand.name}. A pessoa cria a conta com
              este e-mail e entra direto na sua empresa.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Função</Label>
              <Select value={role} onValueChange={(v) => v && setRole(v as MemberRole)}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue>{ROLE_LABEL[role]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin" className="text-xs">
                    Administrador
                  </SelectItem>
                  <SelectItem value="user" className="text-xs">
                    Usuário
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Departamento</Label>
              <Select
                value={departmentId}
                onValueChange={(v) => v && setDepartmentId(v)}
              >
                <SelectTrigger className="h-8 w-full text-xs" disabled={role === "admin"}>
                  <SelectValue>
                    {role === "admin" ? "Não se aplica" : (dep?.name ?? "Sem departamento")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_DEPARTAMENTO} className="text-xs">
                    Sem departamento
                  </SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id} className="text-xs">
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Visibilidade de dados</Label>
            <div className="flex h-8 items-center gap-2">
              <Switch
                checked={onlyAssigned}
                disabled={role === "admin"}
                onCheckedChange={(v) => setOnlyAssigned(Boolean(v))}
              />
              <span className="text-[11px] text-slate-500">
                {role === "admin"
                  ? "Todos os dados"
                  : onlyAssigned
                    ? "Apenas atribuídos"
                    : "Todos os dados"}
              </span>
            </div>
          </div>
          <ModuleGrid
            disabled={role === "admin"}
            hint="Administradores acessam todos os módulos"
            isAllowed={effective}
            baseline={baseline}
            onToggle={toggle}
          />
          {role !== "admin" && (
            <p className="text-[10px] leading-tight text-slate-400">
              {dep
                ? exceptions > 0
                  ? `Começa em ${dep.name} e já entra com ${exceptions} exceç${exceptions === 1 ? "ão" : "ões"} — o que difere do departamento fica marcado.`
                  : `Marcado conforme ${dep.name}. Mudar um módulo aqui cria uma exceção só para esta pessoa.`
                : "Sem departamento: o que estiver desmarcado vira bloqueio individual."}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Criando..." : "Criar convite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------- Editar usuário (função, departamento, exceções) -------------------- */

function PermissionsDialog({
  member,
  departments,
  open,
  onOpenChange,
}: {
  member: TeamMember;
  departments: Department[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [role, setRole] = useState<MemberRole>(member.role);
  const [onlyAssigned, setOnlyAssigned] = useState(member.onlyAssigned);
  const [departmentId, setDepartmentId] = useState<string>(
    member.departmentId ?? SEM_DEPARTAMENTO
  );
  const [permissions, setPermissions] = useState<ModulePermissions>(member.permissions);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRole(member.role);
    setOnlyAssigned(member.onlyAssigned);
    setDepartmentId(member.departmentId ?? SEM_DEPARTAMENTO);
    setPermissions(member.permissions);
  }, [member]);

  const dep = departments.find((d) => d.id === departmentId) ?? null;
  const baseline = (key: string) => dep?.permissions?.[key];
  const effective = (key: string) =>
    canAccess(
      key,
      { role: "user", permissions, departmentId: dep?.id ?? null },
      departments
    );

  /**
   * Só as divergências viram exceção: se a escolha bate com o departamento, a
   * chave sai do mapa e a pessoa volta a seguir o departamento — inclusive se
   * o departamento mudar depois.
   */
  const toggle = (key: string, allowed: boolean) =>
    setPermissions((p) => {
      const base = baseline(key);
      const next = { ...p };
      if (base === allowed || (base === undefined && allowed)) delete next[key];
      else next[key] = allowed;
      return next;
    });

  const save = async () => {
    setSaving(true);
    const res = await teamActions.updateMember(member.userId, {
      role,
      onlyAssigned: role === "admin" ? false : onlyAssigned,
      permissions: role === "admin" ? {} : permissions,
      departmentId: role === "admin" ? null : departmentId === SEM_DEPARTAMENTO ? null : departmentId,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível salvar");
      return;
    }
    toast.success("Alterações salvas");
    onOpenChange(false);
  };

  const exceptions = Object.keys(permissions).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{member.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Função</Label>
              <Select value={role} onValueChange={(v) => v && setRole(v as MemberRole)}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue>{ROLE_LABEL[role]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin" className="text-xs">
                    Administrador
                  </SelectItem>
                  <SelectItem value="user" className="text-xs">
                    Usuário
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Departamento</Label>
              <Select value={departmentId} onValueChange={(v) => v && setDepartmentId(v)}>
                <SelectTrigger className="h-8 w-full text-xs" disabled={role === "admin"}>
                  <SelectValue>
                    {role === "admin" ? "Não se aplica" : (dep?.name ?? "Sem departamento")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_DEPARTAMENTO} className="text-xs">
                    Sem departamento
                  </SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id} className="text-xs">
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Visibilidade de dados</Label>
            <div className="flex h-8 items-center gap-2">
              <Switch
                checked={onlyAssigned}
                disabled={role === "admin"}
                onCheckedChange={(v) => setOnlyAssigned(Boolean(v))}
              />
              <span className="text-[11px] text-slate-500">
                {role === "admin"
                  ? "Todos os dados"
                  : onlyAssigned
                    ? "Apenas atribuídos"
                    : "Todos os dados"}
              </span>
            </div>
          </div>
          <ModuleGrid
            disabled={role === "admin"}
            hint="Administradores acessam todos os módulos"
            isAllowed={effective}
            baseline={baseline}
            onToggle={toggle}
          />
          {role !== "admin" && (
            <p className="text-[10px] leading-tight text-slate-400">
              {dep
                ? exceptions > 0
                  ? `Marcado como "exceção" o que difere de ${dep.name}. Desmarcar a exceção faz a pessoa voltar a seguir o departamento.`
                  : `Seguindo ${dep.name} à risca. Mudar um módulo aqui cria uma exceção só para esta pessoa.`
                : "Sem departamento: o que estiver desmarcado vira bloqueio individual."}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
