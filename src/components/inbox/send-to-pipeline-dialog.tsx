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
import { dbContactActions, useDbContact, useDbTeam } from "@/lib/data/repos/db/contacts";
import { useMyMembership } from "@/lib/data/repos/db/team";
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
  const team = useDbTeam();
  const { me } = useMyMembership();
  const { contact, refresh: recarregarContato } = useDbContact(contactId);
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [value, setValue] = useState("");
  const [course, setCourse] = useState("");
  /*
   * ⚠️ `null` = "ainda não mexi no campo", e NÃO é preciosismo: o responsável da
   * conversa e a equipe chegam de forma assíncrona, então semear os campos num
   * efeito de abertura os deixaria vazios enquanto a consulta não volta — e
   * `setState` dentro de efeito ainda dispara renderização em cascata (o lint do
   * projeto acusa). Derivando na renderização, o padrão se corrige sozinho
   * quando o dado chega, e o que a pessoa escolher vence a partir daí.
   */
  const [ownerEscolhido, setOwnerEscolhido] = useState<string | null>(null);
  const [levarEscolhido, setLevarEscolhido] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * Quem o card DEVE nascer tendo, se ninguém mexer no seletor.
   *
   * Mantém a regra de antes — vindo da conversa, o card é do RESPONSÁVEL dela,
   * não de quem clicou (um admin criando na conversa do Paulo cria PARA o
   * Paulo) — e só acrescenta o fallback para quem está clicando quando a
   * conversa ainda não tem dono (bot/fila).
   */
  const donoPadrao = conversation?.assignedTo ?? me?.userId ?? "";
  const donoDoContato = contact?.ownerId || "";
  const nomeDoDonoAtual = team.find((u) => u.id === donoDoContato)?.name ?? "";
  const owner = ownerEscolhido ?? donoPadrao;
  /*
   * Marcado por padrão SÓ quando o contato ainda não tem dono — que é o caso da
   * queixa ("tenho que ir em Contatos e me marcar como proprietário"). Tendo
   * dono, nasce DESMARCADO: tomar o contato de um colega é decisão consciente, e
   * um padrão que faz isso sozinho transfere carteira sem ninguém perceber.
   */
  const levarContato = levarEscolhido ?? !donoDoContato;
  // Nada a fazer quando o dono escolhido JÁ é o dono do contato.
  const mostrarCaixaDoContato = !!owner && owner !== donoDoContato;

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
    // Volta ao padrão derivado: sem isto, a escolha feita para UM contato seguiria
    // valendo na próxima abertura, para outro contato.
    setOwnerEscolhido(null);
    setLevarEscolhido(null);
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
      // Agora vem do SELETOR, cujo padrão continua sendo o responsável da
      // conversa. String vazia = "sem proprietário", que é um estado legítimo
      // (lead do grupo) — daí `|| null` e não `?? null`.
      ownerId: owner || null,
    });
    if (!ok) {
      setSaving(false);
      toast.error("Não foi possível criar a oportunidade");
      return;
    }

    /*
     * 🔴 O motivo do pedido: *"quando o Paulo vai enviar um lead para pipeline,
     * ele não consegue selecionar ele como proprietário, gerando o trabalho de ir
     * em Contatos, buscar o contato e lá se marcar como proprietário."*
     *
     * ⚠️ Isto virou necessário quando a transferência DEIXOU de reescrever o dono
     * do contato (202609111030). A regra continua certa — propriedade não segue a
     * conversa —, mas ela só funciona se existir um caminho barato para a pessoa
     * DIZER de quem é o contato. Este é o caminho, no momento em que ela já está
     * decidindo que o lead é dela.
     */
    let avisoDono = "";
    if (levarContato && mostrarCaixaDoContato) {
      const okDono = await dbContactActions.update(contactId, { ownerId: owner });
      if (okDono) recarregarContato();
      // ⚠️ Sucesso PARCIAL é dito, não escondido: a oportunidade foi criada e o
      // proprietário não mudou. Um toast verde único mandaria a pessoa embora
      // achando que as duas coisas deram certo.
      else avisoDono = " (não consegui definir o proprietário do contato)";
    }
    setSaving(false);

    const stageName = pipeline?.stages.find((s) => s.id === stageId)?.name ?? "";
    const base =
      `${contactName} enviado para ${pipeline?.name} · ${stageName}` +
      (course ? ` · ${course}` : "");
    if (avisoDono) toast.error(base + avisoDono);
    else toast.success(base);
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
                🔴 O campo que faltava. Sem ele o atendente criava o card e ia a
                Contatos procurar a pessoa só para se marcar como proprietário —
                um caminho de três telas para uma decisão que ele já tomou aqui.

                ⚠️ `<select>` nativo, como o de Curso e o "Atribuir…" do
                Relatório: é uma lista de pessoas e o nativo dá busca por
                digitação e a rolagem do sistema de graça.
              */}
              <div className="space-y-1">
                <Label className="text-xs">Proprietário</Label>
                <select
                  value={owner}
                  onChange={(e) => setOwnerEscolhido(e.target.value)}
                  className="h-8 w-full rounded-md border bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  {/* Lead do grupo é estado legítimo — e era o comportamento
                      anterior quando a conversa estava no bot/sem dono. */}
                  <option value="">Sem proprietário (do grupo)</option>
                  {/*
                    ⚠️ O dono escolhido entra na lista mesmo que a equipe ainda
                    não tenha carregado. Sem isto o `value` não casaria com
                    nenhuma opção, o React desenharia "Sem proprietário" e o card
                    nasceria sem dono — o campo controlado mentindo sobre o que
                    vai gravar.
                  */}
                  {owner && !team.some((u) => u.id === owner) && (
                    <option value={owner}>Carregando...</option>
                  )}
                  {team.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                {mostrarCaixaDoContato && (
                  <label className="flex cursor-pointer items-start gap-1.5 pt-0.5">
                    <input
                      type="checkbox"
                      checked={levarContato}
                      onChange={(e) => setLevarEscolhido(e.target.checked)}
                      className="mt-0.5 size-3.5 accent-indigo-600"
                    />
                    <span className="text-[11px] leading-snug text-slate-600">
                      {donoDoContato ? (
                        <>
                          Passar o <strong>contato</strong> para esta pessoa
                          {nomeDoDonoAtual ? (
                            <span className="text-amber-700"> (hoje é de {nomeDoDonoAtual})</span>
                          ) : null}
                        </>
                      ) : (
                        <>
                          Definir também como <strong>proprietário do contato</strong>
                        </>
                      )}
                    </span>
                  </label>
                )}
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
