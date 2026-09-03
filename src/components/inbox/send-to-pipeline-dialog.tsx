"use client";

import { useEffect, useMemo, useState } from "react";
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
import { oppActions, usePipelineDb } from "@/lib/data/repos/db/pipeline";
import { CURSOS } from "@/lib/data/cursos";
import { useConversation } from "@/lib/data/repos/db/conversations";
import { formatBRL } from "@/lib/data/repos/opportunities";

/**
 * Manda o contato da conversa para um pipeline de Leads, criando uma
 * oportunidade real (`oppActions.add`) — a mesma coisa que o botão "Nova
 * oportunidade" do kanban faz, só que a partir da conversa.
 *
 * Mostra as oportunidades que o contato JÁ tem: sem isso, o caminho natural
 * (atendente manda o mesmo lead toda vez que conversa) enche o funil de
 * duplicatas sem ninguém perceber.
 */
export function SendToPipelineDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  conversationId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactId: string;
  contactName: string;
  /** Se o card nasce de uma conversa, herda o responsável DELA (não quem cria). */
  conversationId?: string;
}) {
  const { pipelines, opportunities } = usePipelineDb();
  const conversation = useConversation(conversationId ?? null);
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [value, setValue] = useState("");
  const [course, setCourse] = useState("");
  const [saving, setSaving] = useState(false);

  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? null;
  const existing = useMemo(
    () => opportunities.filter((o) => o.contactId === contactId),
    [opportunities, contactId]
  );

  // Primeiro pipeline/primeira fase já vêm escolhidos — o caso comum é
  // "joga esse lead no funil padrão" e não deveria pedir dois cliques.
  useEffect(() => {
    if (!open) return;
    const first = pipelines[0];
    setPipelineId((cur) => cur || first?.id || "");
    setValue("");
    setCourse("");
  }, [open, pipelines]);

  useEffect(() => {
    const stages = pipelines.find((p) => p.id === pipelineId)?.stages ?? [];
    setStageId(stages[0]?.id ?? "");
  }, [pipelineId, pipelines]);

  const send = async () => {
    if (!pipelineId || !stageId) {
      toast.error("Escolha o pipeline e a fase");
      return;
    }
    setSaving(true);
    const ok = await oppActions.add({
      contactId,
      contactName,
      pipelineId,
      stageId,
      value: Number(value.replace(",", ".")) || 0,
      course,
      source: "Conversas",
      // Vindo da conversa: o card é do RESPONSÁVEL dela (null = grupo, se estiver
      // no bot/sem dono). Fora de uma conversa, mantém o padrão (quem criou).
      ...(conversationId ? { ownerId: conversation?.assignedTo ?? null } : {}),
    });
    setSaving(false);
    if (!ok) {
      toast.error("Não foi possível criar a oportunidade");
      return;
    }
    const stageName = pipeline?.stages.find((s) => s.id === stageId)?.name ?? "";
    toast.success(
      `${contactName} enviado para ${pipeline?.name} · ${stageName}` +
        (course ? ` · ${course}` : "")
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Enviar para pipeline</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Cria uma oportunidade para <span className="font-medium text-slate-700">{contactName}</span>{" "}
            no funil de Leads.
          </p>
          {existing.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
              <p className="text-[11px] font-semibold text-amber-800">
                Este contato já está em {existing.length} oportunidade
                {existing.length > 1 ? "s" : ""}:
              </p>
              <ul className="mt-1 space-y-0.5">
                {existing.slice(0, 3).map((o) => {
                  const p = pipelines.find((x) => x.id === o.pipelineId);
                  const s = p?.stages.find((x) => x.id === o.stageId);
                  return (
                    <li key={o.id} className="text-[11px] text-amber-700">
                      {p?.name} &gt; {s?.name} · {formatBRL(o.value)}
                      {/*
                        ⚠️ O curso entra no aviso porque muda a conclusão: dois
                        leads do MESMO contato são legítimos quando são de
                        formações diferentes. Sem o curso, o aviso empurra para
                        "já existe, não crie" mesmo quando criar é o certo.
                      */}
                      {o.course ? ` · ${o.course}` : ""}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {pipelines.length === 0 ? (
            <p className="text-[11px] text-amber-600">
              Nenhum pipeline cadastrado — crie um no módulo Leads primeiro.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Pipeline</Label>
                <Select value={pipelineId} onValueChange={(v) => setPipelineId(v ?? "")}>
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue>{pipeline?.name ?? "Selecionar"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fase</Label>
                <Select value={stageId} onValueChange={(v) => setStageId(v ?? "")}>
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue>
                      {pipeline?.stages.find((s) => s.id === stageId)?.name ?? "Selecionar"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(pipeline?.stages ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/*
                Curso da formação (coluna `opportunities.course`, migração 0093).
                A lista é a MESMA de `lib/data/cursos.ts` que o card do funil já
                usa — duas listas divergiriam na primeira formação nova.

                ⚠️ **`<select>` nativo, e não o `Select` do shadcn** que os
                campos acima usam: são 45 cursos com nomes longos ("Mecânico de
                Aeronaves Básico + Célula + Aviônica + GMP"), e o nativo dá busca
                por digitação e a rolagem do sistema de graça. É a mesma escolha
                que o card do funil fez, pelo mesmo motivo.

                ⚠️ Aparece em QUALQUER pipeline, não só no Comercial. Casar por
                nome de pipeline é frágil (este projeto já tropeçou nisso), o
                campo é opcional, e o card do funil já oferece o seletor em
                qualquer funil — esconder aqui criaria a incoerência de dar para
                escolher depois e não na criação.
              */}
              <div className="space-y-1">
                <Label className="text-xs">Curso (opcional)</Label>
                <select
                  value={course}
                  onChange={(e) => setCourse(e.target.value)}
                  className="h-8 w-full rounded-md border bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  <option value="">Curso: selecionar…</option>
                  {CURSOS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Valor (opcional)</Label>
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="h-8 text-xs"
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={send} disabled={saving || pipelines.length === 0}>
            {saving ? "Enviando..." : "Enviar para pipeline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
