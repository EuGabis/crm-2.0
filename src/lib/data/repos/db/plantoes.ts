"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Plantão de fim de semana (migração 202609112100).
 *
 * No período configurado, **100% dos leads novos do setor vão para um vendedor
 * só** e a distribuição normal fica suspensa — é a regra 6 do pedido de
 * 2026-09-11. Quem executa isso é `plantaoAtivo` em `lib/leads/distribution.ts`;
 * aqui é só a leitura e a escrita da tela.
 *
 * ⚠️ A escrita passa por `public.criar_plantao`, e não por um insert direto: é
 * ela que recusa período SOBREPOSTO no mesmo setor. Dois plantões vigentes ao
 * mesmo tempo não têm resposta certa, e o leitor teria de escolher um por
 * critério arbitrário — que é exatamente como nasceu o bug do "canal ativo mais
 * antigo" (202608312055). Recusar na criação é o único lugar onde dá para dizer
 * o motivo a quem está configurando.
 */

export interface Plantao {
  id: string;
  departmentId: string;
  userId: string;
  inicio: string;
  fim: string;
  seAusente: "normal" | "fila";
  canceladoEm: string | null;
}

const mapa = (r: any): Plantao => ({
  id: r.id,
  departmentId: r.department_id,
  userId: r.user_id,
  inicio: r.inicio,
  fim: r.fim,
  seAusente: (r.se_ausente ?? "normal") as Plantao["seAusente"],
  canceladoEm: r.cancelado_em ?? null,
});

/** Está valendo AGORA? A mesma conta que o rodízio faz no servidor. */
export function estaVigente(p: Plantao, agora = new Date()): boolean {
  if (p.canceladoEm) return false;
  const t = agora.getTime();
  return new Date(p.inicio).getTime() <= t && t < new Date(p.fim).getTime();
}

export function usePlantoes(departmentId?: string | null) {
  const [plantoes, setPlantoes] = useState<Plantao[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    await useDbStore.getState().ensureSession();
    const loc = useDbStore.getState().locationId;
    if (!loc) {
      setPlantoes([]);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    let q = supabase
      .from("plantoes")
      .select("*")
      .eq("location_id", loc)
      .is("cancelado_em", null)
      // Os que já terminaram não interessam à tela: ela existe para dizer o que
      // está valendo e o que vem. Histórico de escala não é a pergunta aqui.
      .gt("fim", new Date().toISOString())
      .order("inicio");
    if (departmentId) q = q.eq("department_id", departmentId);
    const { data, error } = await q;
    if (error) {
      /*
       * ⚠️ Tabela ainda não criada (código no ar antes da migração) NÃO é erro de
       * tela: a seção simplesmente não tem nada para mostrar. Qualquer outro
       * motivo aparece, com código e mensagem.
       */
      setPlantoes([]);
      setErro(error.code === "42P01" ? null : `${error.code ?? "erro"} · ${error.message}`);
      setLoading(false);
      return;
    }
    setErro(null);
    setPlantoes((data ?? []).map(mapa));
    setLoading(false);
  }, [departmentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void recarregar();
  }, [recarregar]);

  return { plantoes, loading, erro, recarregar };
}

export const plantaoActions = {
  async criar(input: {
    departmentId: string;
    userId: string;
    inicio: string;
    fim: string;
    seAusente: "normal" | "fila";
  }): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    const { error } = await supabase.rpc("criar_plantao", {
      p_department: input.departmentId,
      p_user: input.userId,
      p_inicio: input.inicio,
      p_fim: input.fim,
      p_se_ausente: input.seAusente,
    });
    /*
     * ⚠️ O motivo VEM da função e vai para a tela: ela distingue "já existe
     * plantão neste período", "o fim tem de ser depois do início" e "sem
     * permissão", e as três pedem condutas diferentes. Um "não foi possível
     * salvar" genérico já custou uma rodada neste projeto.
     */
    if (error) return { ok: false, error: error.message || "Não foi possível criar o plantão" };
    return { ok: true };
  },

  /**
   * Cancela (não apaga).
   *
   * ⚠️ `cancelado_em` em vez de `delete`: as conversas entregues carregam
   * `plantao_id`, e apagar a linha apagaria de quem veio aquele lead — junto com
   * a regra que manda a cota ignorá-los.
   */
  async cancelar(id: string): Promise<{ ok: boolean; error?: string }> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("plantoes")
      .update({ cancelado_em: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error) return { ok: false, error: error.message };
    // Confere as LINHAS: UPDATE recusado pela RLS não vem com erro, e a tela
    // diria "cancelado" com o plantão ainda valendo.
    if (!data?.length) return { ok: false, error: "Sem permissão para cancelar" };
    return { ok: true };
  },
};
