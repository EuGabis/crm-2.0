"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FolderPlus, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SubNav } from "@/components/layout/subnav";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDbWorkflows, dbWorkflowActions } from "@/lib/data/repos/db/workflows";
import type { Workflow } from "@/lib/data/types";

const TABS = [{ label: "Fluxos de trabalho" }, { label: "Configurações globais" }];

export default function AutomacoesPage() {
  const router = useRouter();
  const [tab, setTab] = useState("Fluxos de trabalho");
  const workflows = useDbWorkflows();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const folders = useMemo(() => {
    const set = new Set<string>();
    workflows.forEach((w) => w.folder && set.add(w.folder));
    return [...set].sort();
  }, [workflows]);

  const openCreate = () => {
    setNewName("");
    setCreateOpen(true);
  };
  const confirmCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Dê um nome ao fluxo");
      return;
    }
    setCreating(true);
    const id = await dbWorkflowActions.create(name);
    setCreating(false);
    if (!id) {
      toast.error("Não foi possível criar o fluxo");
      return;
    }
    setCreateOpen(false);
    toast.success("Fluxo criado como rascunho");
    router.push(`/automacoes/${id}`);
  };

  const columns: Column<Workflow>[] = [
    {
      key: "nome",
      header: "Nome",
      sortable: true,
      sortValue: (w) => w.name,
      render: (w) => (
        <div>
          <p className="font-medium text-slate-800">{w.name}</p>
          {w.folder && <p className="text-[10px] text-slate-400">📁 {w.folder}</p>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (w) => w.status,
      render: (w) =>
        w.status === "published" ? (
          <Badge className="bg-emerald-100 text-emerald-700">Publicado</Badge>
        ) : (
          <Badge variant="secondary">Rascunho</Badge>
        ),
    },
    {
      key: "total",
      header: "Total de inscritos",
      sortable: true,
      sortValue: (w) => w.enrolledTotal,
      render: (w) => w.enrolledTotal.toLocaleString("pt-BR"),
    },
    {
      key: "ativos",
      header: "Inscritos ativos",
      sortable: true,
      sortValue: (w) => w.enrolledActive,
      render: (w) => w.enrolledActive.toLocaleString("pt-BR"),
    },
    {
      key: "atualizado",
      header: "Última atualização",
      sortable: true,
      sortValue: (w) => w.updatedAt,
      render: (w) => (
        <span className="text-slate-500">
          {format(new Date(w.updatedAt), "d MMM yyyy HH:mm", { locale: ptBR })}
        </span>
      ),
    },
  ];

  return (
    <div>
      <SubNav tabs={TABS} active={tab} onChange={setTab} />
      <div className="p-6">
        {tab !== "Fluxos de trabalho" ? (
          <ConfiguracoesGlobaisTab />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-lg font-bold text-slate-900">Lista de fluxos de trabalho</h1>
                {folders.length > 0 && (
                  <p className="text-xs text-slate-500">
                    Pastas: {folders.join(" · ")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => toast.info("Criação de pastas chega em breve")}
                >
                  <FolderPlus className="size-3.5" /> Criar pasta
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 border-indigo-300 text-xs text-indigo-600 hover:bg-indigo-50"
                  onClick={() => toast.info("Geração de fluxos com IA chega em breve")}
                >
                  <Sparkles className="size-3.5" /> Construa usando IA
                </Button>
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={openCreate}>
                  <Plus className="size-3.5" /> Criar fluxo de trabalho
                </Button>
              </div>
            </div>
            <DataTable
              data={workflows}
              columns={columns}
              searchPlaceholder="Pesquisar fluxos"
              searchFn={(w, q) => `${w.name} ${w.folder ?? ""}`.toLowerCase().includes(q)}
              pageSize={10}
              onRowClick={(w) => router.push(`/automacoes/${w.id}`)}
            />
          </>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo fluxo de trabalho</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Nome do fluxo</Label>
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void confirmCreate()}
              placeholder="Ex.: Boas-vindas ao novo lead"
              className="h-9 text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void confirmCreate()} disabled={creating}>
              {creating ? "Criando..." : "Criar fluxo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- Configurações globais ---------- */

const TIMEZONES = [
  { value: "America/Sao_Paulo", label: "Brasília (GMT-3)" },
  { value: "America/Manaus", label: "Manaus (GMT-4)" },
  { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
  { value: "America/Noronha", label: "Fernando de Noronha (GMT-2)" },
];

function ConfiguracoesGlobaisTab() {
  const [fuso, setFuso] = useState("America/Sao_Paulo");
  const [inicio, setInicio] = useState("08:00");
  const [fim, setFim] = useState("20:00");
  const [limite, setLimite] = useState("200");
  const [pausarFeriados, setPausarFeriados] = useState(true);

  const fusoLabel = TIMEZONES.find((t) => t.value === fuso)?.label ?? fuso;

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <h1 className="text-lg font-bold text-slate-900">Configurações globais</h1>
        <p className="text-xs text-slate-500">Regras aplicadas a todos os fluxos de trabalho da conta.</p>
      </div>
      <div className="flex flex-col gap-3">
        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">Fuso horário da conta</p>
          <p className="mb-3 text-xs text-slate-500">Usado para agendar esperas, janelas e datas nos fluxos.</p>
          <Select value={fuso} onValueChange={(v) => v && setFuso(v)}>
            <SelectTrigger className="h-8 w-[260px] text-xs">
              <SelectValue>{fusoLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((t) => (
                <SelectItem key={t.value} value={t.value} className="text-xs">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">Janela de envio</p>
          <p className="mb-3 text-xs text-slate-500">
            Mensagens automáticas só são enviadas dentro deste horário.
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="time"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className="h-8 w-[110px] text-xs"
            />
            <span className="text-xs text-slate-400">até</span>
            <Input
              type="time"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              className="h-8 w-[110px] text-xs"
            />
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">Limite de mensagens por dia</p>
          <p className="mb-3 text-xs text-slate-500">
            Teto diário de mensagens automáticas por contato para evitar bloqueios.
          </p>
          <Input
            type="number"
            min={1}
            value={limite}
            onChange={(e) => setLimite(e.target.value)}
            className="h-8 w-[110px] text-xs"
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border bg-white p-4">
          <div>
            <p className="text-sm font-semibold text-slate-800">Pausar automações em feriados</p>
            <p className="text-xs text-slate-500">Suspende envios automáticos em feriados nacionais.</p>
          </div>
          <Switch checked={pausarFeriados} onCheckedChange={(v) => setPausarFeriados(Boolean(v))} />
        </div>

        <div>
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => toast.success("Configurações salvas (sessão)")}
          >
            Salvar configurações
          </Button>
        </div>
      </div>
    </div>
  );
}
