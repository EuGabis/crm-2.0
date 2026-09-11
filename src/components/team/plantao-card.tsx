"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/shared/confirm";
import { estaVigente, plantaoActions, usePlantoes } from "@/lib/data/repos/db/plantoes";
import { estadoDePresenca, rotuloDePresenca } from "@/lib/presence";
import type { PresencaAoVivo } from "@/lib/data/repos/db/team";
import { cn } from "@/lib/utils";

/**
 * Plantão de fim de semana (item 6 do pedido de 2026-09-11).
 *
 * No período, **100% dos leads novos do setor vão para um vendedor só**; a
 * distribuição normal fica suspensa e volta sozinha quando a janela termina.
 *
 * ⚠️ Mora no diálogo do DEPARTAMENTO, junto do rodízio, porque é a mesma
 * decisão: quem organiza a escala é quem configura quem recebe. Um lugar
 * separado faria alguém mexer no rodízio sem ver que há um plantão ativo
 * mandando em tudo.
 */

export function PlantaoCard({
  departmentId,
  membros,
  presenca,
  podeEditar,
}: {
  departmentId: string;
  /** Quem pode ficar de plantão: os atendentes do setor. */
  membros: { userId: string; name: string }[];
  presenca: Record<string, PresencaAoVivo>;
  podeEditar: boolean;
}) {
  const { plantoes, loading, erro, recarregar } = usePlantoes(departmentId);
  const confirm = useConfirm();
  const [abrindo, setAbrindo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [user, setUser] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [seAusente, setSeAusente] = useState<"normal" | "fila">("normal");

  const vigente = useMemo(() => plantoes.find((p) => estaVigente(p)) ?? null, [plantoes]);
  const futuros = useMemo(() => plantoes.filter((p) => !estaVigente(p)), [plantoes]);
  const nomeDe = (id: string) => membros.find((m) => m.userId === id)?.name ?? "—";

  const salvar = async () => {
    if (!user) {
      toast.error("Escolha o vendedor de plantão");
      return;
    }
    if (!inicio || !fim) {
      toast.error("Preencha o início e o fim");
      return;
    }
    setSalvando(true);
    /*
     * ⚠️ `new Date("2026-09-11T22:00")` (sem fuso) é lido como hora LOCAL — que
     * é o que a pessoa digitou. O `toISOString` aqui é a conversão para UTC no
     * envio, e é correta; o erro seria formatar a data de volta assim, que
     * devolveria o dia em UTC. Ver `lib/periodo.ts`.
     */
    const r = await plantaoActions.criar({
      departmentId,
      userId: user,
      inicio: new Date(inicio).toISOString(),
      fim: new Date(fim).toISOString(),
      seAusente,
    });
    setSalvando(false);
    if (!r.ok) {
      toast.error(r.error ?? "Não foi possível ativar o plantão");
      return;
    }
    toast.success("Plantão ativado");
    setAbrindo(false);
    setUser("");
    setInicio("");
    setFim("");
    recarregar();
  };

  const cancelar = async (id: string, nome: string) => {
    const ok = await confirm({
      title: `Cancelar o plantão de ${nome}?`,
      description: "Os leads novos voltam a ser distribuídos normalmente entre o time.",
      confirmLabel: "Cancelar plantão",
      destructive: true,
    });
    if (!ok) return;
    const r = await plantaoActions.cancelar(id);
    if (!r.ok) {
      toast.error(r.error ?? "Não foi possível cancelar");
      return;
    }
    toast.success("Plantão cancelado");
    recarregar();
  };

  const janela = (p: { inicio: string; fim: string }) =>
    `${format(new Date(p.inicio), "dd/MM/yyyy HH:mm", { locale: ptBR })} → ${format(
      new Date(p.fim),
      "dd/MM/yyyy HH:mm",
      { locale: ptBR }
    )}`;

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Label className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
            <CalendarClock className="size-3.5" /> Plantão de fim de semana
          </Label>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            No período, <strong>todos</strong> os leads novos do setor vão para o vendedor
            escolhido e a distribuição normal fica suspensa. Ela volta sozinha quando o plantão
            termina.
          </p>
        </div>
        {podeEditar && !abrindo && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 text-xs"
            onClick={() => setAbrindo(true)}
          >
            Novo plantão
          </Button>
        )}
      </div>

      {loading ? (
        <p className="mt-2 text-[11px] text-slate-400">Carregando...</p>
      ) : erro ? (
        <p className="mt-2 text-[11px] text-rose-600">{erro}</p>
      ) : (
        <>
          {/* O aviso visual pedido no item 8: verde, com quem e até quando. */}
          {vigente && (
            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                <span aria-hidden className="size-2 rounded-full bg-emerald-500" />
                Plantão ativo · {nomeDe(vigente.userId)}
              </p>
              <p className="mt-0.5 text-[11px] text-emerald-700">{janela(vigente)}</p>
              <p className="mt-0.5 text-[11px] text-emerald-700">
                Se estiver ausente:{" "}
                {vigente.seAusente === "fila"
                  ? "o lead espera na fila do setor"
                  : "distribuição normal"}
              </p>
              {podeEditar && (
                <button
                  onClick={() => void cancelar(vigente.id, nomeDe(vigente.userId))}
                  className="mt-1 text-[11px] font-medium text-emerald-800 underline"
                >
                  Cancelar plantão
                </button>
              )}
            </div>
          )}

          {futuros.length > 0 && (
            <ul className="mt-2 space-y-1">
              {futuros.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-dashed px-2.5 py-1.5 text-[11px]"
                >
                  <span className="text-slate-600">
                    <strong className="text-slate-800">{nomeDe(p.userId)}</strong> · {janela(p)}
                  </span>
                  {podeEditar && (
                    <button
                      onClick={() => void cancelar(p.id, nomeDe(p.userId))}
                      className="shrink-0 font-medium text-slate-500 underline"
                    >
                      Cancelar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!vigente && futuros.length === 0 && !abrindo && (
            <p className="mt-2 text-[11px] text-slate-400">
              Nenhum plantão programado — a distribuição está normal.
            </p>
          )}
        </>
      )}

      {abrindo && (
        <div className="mt-3 space-y-2 rounded-lg border bg-slate-50/60 p-3">
          <div>
            <Label className="text-[11px] font-semibold">Vendedor</Label>
            {/*
              `<select>` nativo, como nos outros seletores de pessoa do CRM: dá
              busca por digitação e a rolagem do sistema de graça.

              ⚠️ O estado de presença vai no TEXTO da opção, não só numa cor:
              escolher para o plantão alguém que está ausente muda o que vai
              acontecer (entra a contingência), e isso precisa estar visível na
              hora da escolha.
            */}
            <select
              value={user}
              onChange={(e) => setUser(e.target.value)}
              className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
            >
              <option value="">Selecionar...</option>
              {membros.map((m) => {
                const p = presenca[m.userId];
                const estado = estadoDePresenca(p?.lastSeenAt ?? null, p?.disponibilidade ?? null);
                return (
                  <option key={m.userId} value={m.userId}>
                    {m.name} · {rotuloDePresenca(estado)}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px] font-semibold">Início</Label>
              <Input
                type="datetime-local"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                className="mt-1 h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-[11px] font-semibold">Fim</Label>
              <Input
                type="datetime-local"
                value={fim}
                min={inicio || undefined}
                onChange={(e) => setFim(e.target.value)}
                className="mt-1 h-8 text-xs"
              />
            </div>
          </div>
          <div>
            <Label className="text-[11px] font-semibold">Se o vendedor estiver ausente</Label>
            <select
              value={seAusente}
              onChange={(e) => setSeAusente(e.target.value as "normal" | "fila")}
              className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs"
            >
              <option value="normal">Distribuição normal (entre os demais)</option>
              <option value="fila">Deixar na fila do setor (ninguém recebe)</option>
            </select>
            <p className="mt-1 flex gap-1 text-[11px] leading-relaxed text-slate-500">
              <ShieldAlert className="mt-px size-3 shrink-0" aria-hidden />
              <span>
                Vale só para <strong>Ausente</strong>. Offline recebe do mesmo jeito — o lead
                fica em <strong>Pendentes</strong> e continua sendo dele.
              </span>
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setAbrindo(false)}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className={cn("h-7 gap-1.5 text-xs")}
              disabled={salvando}
              onClick={() => void salvar()}
            >
              {salvando && <Loader2 className="size-3 animate-spin" />}
              Ativar plantão
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
