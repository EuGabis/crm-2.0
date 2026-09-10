"use client";

import { useState } from "react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pipelineActions } from "@/lib/data/repos/db/pipeline";
import type { Department } from "@/lib/data/repos/db/team";
import type { Pipeline, PipelineScope } from "@/lib/data/types";

/** Etiqueta de quem enxerga o pipeline, usada na lista de pipelines. */
export function scopeBadge(
  pipeline: Pipeline,
  departments: Department[],
  team: { id: string; name: string }[]
): { label: string; className: string } {
  if (pipeline.scope === "department") {
    const name = departments.find((d) => d.id === pipeline.departmentId)?.name ?? "Departamento";
    return { label: name, className: "bg-violet-100 text-violet-700" };
  }
  if (pipeline.scope === "user") {
    // A lista salva já inclui o dono (202609110900); funil antigo sem lista cai
    // no dono, que é o comportamento de antes.
    const ids = pipeline.viewerIds?.length
      ? pipeline.viewerIds
      : pipeline.ownerId
        ? [pipeline.ownerId]
        : [];
    if (ids.length > 1) {
      return { label: `${ids.length} pessoas`, className: "bg-amber-100 text-amber-700" };
    }
    const name = team.find((u) => u.id === ids[0])?.name ?? "Pessoal";
    return { label: `Só ${name}`, className: "bg-amber-100 text-amber-700" };
  }
  return { label: "Empresa", className: "bg-slate-100 text-slate-600" };
}

/**
 * Cria um pipeline (com quem vê) ou muda quem vê um existente.
 *
 * Usuário comum não escolhe: o funil que ele cria é dele. Não é regra de tela
 * — a RLS da 0039 recusa qualquer outro escopo vindo dele. A tela só evita
 * oferecer o que o banco vai negar.
 */
export function PipelineScopeDialog({
  open,
  onOpenChange,
  mode,
  pipeline,
  isAdmin,
  myUserId,
  departments,
  team,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "create" | "edit";
  pipeline: Pipeline | null;
  isAdmin: boolean;
  myUserId: string | null;
  departments: Department[];
  team: { id: string; name: string }[];
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<PipelineScope>("user");
  const [departmentId, setDepartmentId] = useState("");
  /*
   * ⚠️ Uma LISTA, não um id (202609110900). `ownerId` continua existindo como
   * "quem administra" e é o PRIMEIRO da lista — o diálogo se chama "Quem vê", e
   * dar administração a todos os escolhidos seria decidir outra coisa.
   */
  const [pessoas, setPessoas] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Espelha o pipeline em edição ao (re)abrir. Ajuste durante o render em vez
  // de efeito: um setState em useEffect só para copiar prop dispara um render
  // extra a cada abertura.
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const snapshotKey = `${open}-${mode}-${pipeline?.id ?? "new"}`;
  if (open && snapshot !== snapshotKey) {
    setSnapshot(snapshotKey);
    setName(mode === "edit" ? (pipeline?.name ?? "") : "");
    setScope(mode === "edit" ? (pipeline?.scope ?? "empresa") : isAdmin ? "empresa" : "user");
    setDepartmentId(pipeline?.departmentId ?? "");
    /*
     * O dono entra na lista mesmo em funil antigo, cujo `viewerIds` ainda está
     * vazio (o retroativo da migração cobre o banco, isto cobre a tela até ela
     * ser aplicada).
     */
    const salvas = pipeline?.viewerIds ?? [];
    const dono = pipeline?.ownerId ?? myUserId ?? "";
    setPessoas(
      salvas.length ? salvas : dono ? [dono] : [],
    );
  }

  const invalid =
    (scope === "department" && !departmentId) ||
    (scope === "user" && pessoas.length === 0) ||
    (mode === "create" && !name.trim());

  const submit = async () => {
    setSaving(true);
    /*
     * ⚠️ O `ownerId` é o PRIMEIRO da lista, e a ordem importa: é ele quem
     * administra o funil. Mandar a lista sem eleger um dono deixaria o funil sem
     * ninguém que pode renomeá-lo ou mudar quem vê.
     */
    const visibility = { scope, departmentId, ownerId: pessoas[0] ?? null, viewerIds: pessoas };
    const ok =
      mode === "create"
        ? await pipelineActions.addPipeline(name.trim(), visibility)
        : await pipelineActions.setPipelineScope(pipeline!.id, visibility);
    setSaving(false);
    if (!ok) {
      toast.error(
        mode === "create"
          ? "Não foi possível criar o pipeline"
          : "Não foi possível alterar — só administradores mudam quem vê um funil"
      );
      return;
    }
    toast.success(
      mode === "create" ? `Pipeline "${name.trim()}" criado — adicione as fases` : "Visibilidade atualizada"
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Novo pipeline" : "Quem vê este pipeline"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {mode === "create" && (
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Gerenciador Cibelle"
                className="h-8 text-xs"
              />
            </div>
          )}

          {isAdmin ? (
            <div className="space-y-1">
              <Label className="text-xs">Quem vê</Label>
              <Select value={scope} onValueChange={(v) => setScope((v as PipelineScope) ?? "empresa")}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue>
                    {scope === "empresa"
                      ? "Todos da empresa"
                      : scope === "department"
                        ? "Um departamento"
                        : "Uma pessoa"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="empresa" className="text-xs">
                    Todos da empresa
                  </SelectItem>
                  <SelectItem value="department" className="text-xs">
                    Um departamento
                  </SelectItem>
                  <SelectItem value="user" className="text-xs">
                    Uma pessoa
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="rounded-md border bg-slate-50 p-2 text-[11px] text-slate-500">
              Este pipeline fica <span className="font-semibold">só para você</span>. Para um funil
              do time, peça a um administrador.
            </p>
          )}

          {isAdmin && scope === "department" && (
            <div className="space-y-1">
              <Label className="text-xs">Departamento</Label>
              <Select value={departmentId} onValueChange={(v) => setDepartmentId(v ?? "")}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue>
                    {departments.find((d) => d.id === departmentId)?.name ?? "Selecionar"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id} className="text-xs">
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {departments.length === 0 && (
                <p className="text-[11px] text-amber-600">
                  Nenhum departamento — crie em Configurações → Departamentos.
                </p>
              )}
            </div>
          )}

          {isAdmin && scope === "user" && (
            <div className="space-y-1">
              <Label className="text-xs">
                Pessoas{pessoas.length > 0 && ` (${pessoas.length})`}
              </Label>
              {/*
                ⚠️ Lista com caixas, e não um `Select` de múltipla escolha: o
                `Select` do projeto é de valor único (Base UI), e o que importa
                aqui é VER quem já está marcado sem abrir menu — é a informação
                que o diálogo existe para mostrar.
              */}
              <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border p-1 [scrollbar-width:thin]">
                {team.length === 0 ? (
                  <p className="px-1 py-2 text-[11px] text-slate-400">Nenhuma pessoa na equipe.</p>
                ) : (
                  team.map((u) => {
                    const marcada = pessoas.includes(u.id);
                    return (
                      <label
                        key={u.id}
                        className={
                          "flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50" +
                          (marcada ? " bg-indigo-50/60" : "")
                        }
                      >
                        <input
                          type="checkbox"
                          checked={marcada}
                          onChange={() =>
                            setPessoas((atual) =>
                              atual.includes(u.id)
                                ? atual.filter((x) => x !== u.id)
                                : [...atual, u.id],
                            )
                          }
                          className="size-3.5 accent-indigo-500"
                        />
                        <span className="min-w-0 flex-1 truncate">{u.name}</span>
                        {/* Quem administra é o primeiro escolhido — dito na tela
                            para a ordem não ser um detalhe invisível. */}
                        {marcada && pessoas[0] === u.id && (
                          <span className="shrink-0 rounded bg-indigo-100 px-1 text-[9px] font-semibold text-indigo-700">
                            administra
                          </span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
              <p className="text-[10px] text-slate-400">
                Todos os marcados veem o funil, as fases e os leads. Quem{" "}
                <strong>administra</strong> (renomeia, muda quem vê) é o primeiro marcado.
              </p>
            </div>
          )}

          {mode === "edit" && (
            <p className="text-[10px] text-slate-400">
              Esconder um funil esconde junto as fases e os leads dele — inclusive no painel de
              controle e nos relatórios.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving || invalid}>
            {saving ? "Salvando..." : mode === "create" ? "Criar pipeline" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
