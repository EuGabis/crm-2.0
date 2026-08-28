"use client";

import { useState } from "react";
import { Clock, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConfirm } from "@/components/shared/confirm";
import {
  autoRespostaActions,
  useAutoRespostas,
  type EntradaAutoResposta,
} from "@/lib/data/repos/db/auto-respostas";
import { respostaAplicavel, type AutoResposta, type TipoJanela } from "@/lib/bot/auto-resposta";
import { useWhatsappChannels } from "@/lib/data/repos/db/whatsapp";
import { useMyMembership } from "@/lib/data/repos/db/team";

const DIAS = [
  { n: 0, r: "dom" },
  { n: 1, r: "seg" },
  { n: 2, r: "ter" },
  { n: 3, r: "qua" },
  { n: 4, r: "qui" },
  { n: 5, r: "sex" },
  { n: 6, r: "sáb" },
];

const VAZIO: EntradaAutoResposta = {
  nome: "",
  mensagem: "",
  tipo: "recorrente",
  channelId: null,
  diasSemana: null,
  horaInicio: "19:00",
  horaFim: "08:00",
  inicioEm: null,
  fimEm: null,
  ativo: true,
};

/** `2026-12-24T15:00:00Z` → `2026-12-24T12:00` para o input local. */
function paraInputLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function resumoDaJanela(r: AutoResposta): string {
  if (r.tipo === "periodo") {
    const f = (s: string | null) =>
      s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
    return `de ${f(r.inicioEm)} até ${f(r.fimEm)}`;
  }
  const dias =
    !r.diasSemana || r.diasSemana.length === 0
      ? "todos os dias"
      : DIAS.filter((d) => r.diasSemana!.includes(d.n))
          .map((d) => d.r)
          .join(", ");
  const vira = (r.horaFim ?? "") <= (r.horaInicio ?? "");
  return `${dias} · ${r.horaInicio?.slice(0, 5)} às ${r.horaFim?.slice(0, 5)}${vira ? " (vira o dia)" : ""}`;
}

/**
 * Respostas automáticas com janela de tempo.
 *
 * ⚠️ **Substituiu um interruptor de MENTIRA.** A aba Configurações tinha
 * "Resposta automática fora do horário" ligando um `useState` que não saía da
 * tela — a funcionalidade era prometida e não existia. Deixar os dois lado a lado
 * seria pior que antes: dois controles com o mesmo nome, um real e um decorativo.
 */
export function AutoRespostasTab() {
  const { itens, loading } = useAutoRespostas();
  const { channels: canais } = useWhatsappChannels();
  const { isAdmin } = useMyMembership();
  const confirm = useConfirm();
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState<EntradaAutoResposta>(VAZIO);
  const [salvando, setSalvando] = useState(false);

  const abrirNovo = () => {
    setForm(VAZIO);
    setEditando("novo");
  };

  const abrirEdicao = (r: AutoResposta) => {
    setForm({
      nome: r.nome,
      mensagem: r.mensagem,
      tipo: r.tipo,
      channelId: r.channelId,
      diasSemana: r.diasSemana,
      horaInicio: r.horaInicio?.slice(0, 5) ?? "19:00",
      horaFim: r.horaFim?.slice(0, 5) ?? "08:00",
      inicioEm: r.inicioEm,
      fimEm: r.fimEm,
      ativo: r.ativo,
    });
    setEditando(r.id);
  };

  const salvar = async () => {
    if (!form.nome.trim() || !form.mensagem.trim()) {
      toast.error("Dê um nome e escreva a mensagem");
      return;
    }
    if (form.tipo === "periodo" && (!form.inicioEm || !form.fimEm)) {
      toast.error("Escolha o início e o fim do período");
      return;
    }
    // ⚠️ Fim antes do início num PERÍODO nunca abre a janela, e sem este aviso o
    // bot simplesmente não responderia — sem erro nenhum, que é o defeito mais
    // difícil de perceber. Em recorrente NÃO se valida: fim menor é o caso normal
    // ("19h às 8h" vira o dia).
    if (form.tipo === "periodo" && form.inicioEm && form.fimEm && form.fimEm <= form.inicioEm) {
      toast.error("O fim precisa ser depois do início");
      return;
    }
    setSalvando(true);
    const r =
      editando === "novo"
        ? await autoRespostaActions.criar(form)
        : await autoRespostaActions.atualizar(editando!, form);
    setSalvando(false);
    if (r.ok) {
      toast.success("Resposta automática salva");
      setEditando(null);
    } else {
      toast.error(r.error ?? "Não foi possível salvar");
    }
  };

  const excluir = async (r: AutoResposta) => {
    if (
      !(await confirm({
        title: `Excluir "${r.nome}"?`,
        description: "A mensagem para de ser enviada imediatamente. Não tem desfazer.",
        confirmLabel: "Excluir",
        destructive: true,
      }))
    )
      return;
    const res = await autoRespostaActions.remover(r.id);
    if (res.ok) toast.success("Excluída");
    else toast.error(res.error ?? "Não foi possível excluir");
  };

  // Qual está valendo AGORA, pela MESMA função que o webhook usa. Ver a regra
  // escrita num lugar e aplicada em outro é como uma janela mal configurada
  // passa despercebida até um cliente reclamar.
  const valendoAgora = respostaAplicavel(itens, null);

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Respostas automáticas</h1>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            Uma mensagem única, enviada quando o cliente escreve dentro da janela. Enquanto a
            janela está aberta, o fluxo do bot e o agente de IA ficam calados — não faz sentido
            triar alguém para dizer em seguida que não há ninguém.
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" className="h-8 shrink-0 gap-1.5 text-xs" onClick={abrirNovo}>
            <Plus className="size-3.5" /> Nova
          </Button>
        )}
      </div>

      {valendoAgora && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <Clock className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <p className="text-[11px] leading-relaxed text-amber-800">
            <strong>Ativa agora:</strong> &ldquo;{valendoAgora.nome}&rdquo;. Todo cliente que
            escrever recebe esta mensagem automática.
          </p>
        </div>
      )}

      {loading && itens.length === 0 && (
        <p className="flex items-center gap-2 text-xs text-slate-400">
          <Loader2 className="size-3.5 animate-spin" /> carregando...
        </p>
      )}

      {!loading && itens.length === 0 && !editando && (
        <div className="rounded-xl border border-dashed bg-white p-8 text-center">
          <p className="text-xs font-medium text-slate-500">Nenhuma resposta automática</p>
          <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-slate-400">
            Crie uma para avisar fora do expediente, ou um recesso com data para começar e
            terminar. Fora da janela, nada muda no atendimento.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {itens.map((r) => (
          <div key={r.id} className="rounded-xl border bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  {r.nome}
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                      r.tipo === "periodo"
                        ? "bg-indigo-100 text-indigo-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {r.tipo === "periodo" ? "período" : "recorrente"}
                  </span>
                  {valendoAgora?.id === r.id && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                      ativa agora
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">{resumoDaJanela(r)}</p>
                <p className="mt-1 line-clamp-2 text-[11px] italic text-slate-600">
                  &ldquo;{r.mensagem}&rdquo;
                </p>
                <p className="mt-1 text-[10px] text-slate-400">
                  {r.channelId
                    ? `só no número ${canais.find((c) => c.id === r.channelId)?.name ?? "escolhido"}`
                    : "todos os números"}
                </p>
              </div>
              {isAdmin && (
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={r.ativo}
                    onCheckedChange={async (v) => {
                      if (!(await autoRespostaActions.alternarAtivo(r.id, Boolean(v)))) {
                        toast.error("Sem permissão para alterar");
                      }
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => abrirEdicao(r)}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-rose-600 hover:bg-rose-50"
                    onClick={() => void excluir(r)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {editando && (
        <div className="mt-3 space-y-3 rounded-xl border bg-white p-4">
          <div>
            <Label className="text-xs font-semibold">Nome (só para você identificar)</Label>
            <Input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Fora do expediente"
              className="mt-1 h-8 text-xs"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Mensagem enviada</Label>
            <Textarea
              value={form.mensagem}
              onChange={(e) => setForm({ ...form, mensagem: e.target.value })}
              rows={3}
              placeholder="Nosso atendimento é de seg a sex, das 8h às 19h. Retornamos no próximo dia útil."
              className="mt-1 text-xs"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-semibold">Tipo de janela</Label>
              <Select
                value={form.tipo}
                onValueChange={(v) => v && setForm({ ...form, tipo: v as TipoJanela })}
              >
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue>
                    {form.tipo === "periodo" ? "Período único" : "Horário recorrente"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recorrente" className="text-xs">
                    Horário recorrente
                  </SelectItem>
                  <SelectItem value="periodo" className="text-xs">
                    Período único
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-semibold">Número</Label>
              <Select
                value={form.channelId ?? "todos"}
                onValueChange={(v) =>
                  setForm({ ...form, channelId: !v || v === "todos" ? null : v })
                }
              >
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue>
                    {form.channelId
                      ? (canais.find((c) => c.id === form.channelId)?.name ?? "Escolhido")
                      : "Todos os números"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">
                    Todos os números
                  </SelectItem>
                  {canais.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.tipo === "recorrente" ? (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3">
              <div className="flex items-end gap-3">
                <div>
                  <Label className="text-[11px] font-semibold">Das</Label>
                  <Input
                    type="time"
                    value={form.horaInicio ?? ""}
                    onChange={(e) => setForm({ ...form, horaInicio: e.target.value })}
                    className="mt-1 h-8 w-28 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[11px] font-semibold">até</Label>
                  <Input
                    type="time"
                    value={form.horaFim ?? ""}
                    onChange={(e) => setForm({ ...form, horaFim: e.target.value })}
                    className="mt-1 h-8 w-28 text-xs"
                  />
                </div>
                {(form.horaFim ?? "") <= (form.horaInicio ?? "") && (
                  <p className="pb-2 text-[11px] text-slate-500">
                    vira o dia — vale a madrugada seguinte
                  </p>
                )}
              </div>
              <div>
                <Label className="text-[11px] font-semibold">Dias</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {DIAS.map((d) => {
                    const sel = form.diasSemana?.includes(d.n) ?? false;
                    return (
                      <button
                        key={d.n}
                        type="button"
                        onClick={() => {
                          const atual = form.diasSemana ?? [];
                          const novo = sel ? atual.filter((x) => x !== d.n) : [...atual, d.n];
                          setForm({ ...form, diasSemana: novo.length ? novo.sort() : null });
                        }}
                        className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                          sel
                            ? "bg-indigo-500 text-white"
                            : "bg-white text-slate-600 ring-1 ring-slate-200"
                        }`}
                      >
                        {d.r}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[10px] text-slate-400">
                  Nenhum dia marcado = todos os dias. O dia é o do <strong>início</strong> da
                  janela: numa faixa que vira o dia, a madrugada pertence ao dia anterior.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
              <div>
                <Label className="text-[11px] font-semibold">Começa em</Label>
                <Input
                  type="datetime-local"
                  value={paraInputLocal(form.inicioEm)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      inicioEm: e.target.value ? new Date(e.target.value).toISOString() : null,
                    })
                  }
                  className="mt-1 h-8 w-52 text-xs"
                />
              </div>
              <div>
                <Label className="text-[11px] font-semibold">Termina em</Label>
                <Input
                  type="datetime-local"
                  value={paraInputLocal(form.fimEm)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      fimEm: e.target.value ? new Date(e.target.value).toISOString() : null,
                    })
                  }
                  className="mt-1 h-8 w-52 text-xs"
                />
              </div>
              <p className="pb-2 text-[10px] text-slate-400">
                No fim, desliga sozinha — ninguém precisa lembrar.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button size="sm" className="h-8 text-xs" disabled={salvando} onClick={() => void salvar()}>
              {salvando ? <Loader2 className="size-3.5 animate-spin" /> : "Salvar"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => setEditando(null)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
