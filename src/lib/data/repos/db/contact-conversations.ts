"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapMessage } from "./conversations";
import { useDbStore } from "./contacts";
import type { Channel, Message } from "@/lib/data/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * As conversas de UM contato, para a tela de Contatos visualizar o atendimento
 * sem ir para a caixa de entrada.
 *
 * **Por que a conversa é a unidade de separação.** Medido neste banco: 158
 * contatos têm mais de uma conversa, e em TODOS os 158 a quantidade de
 * conversas é igual à de números distintos — ou seja, a conversa aqui é
 * `contato + número`, e é exatamente o corte que o pedido descreve ("a conversa
 * com a Cibelle" × "a que ele teve com a secretaria").
 *
 * **Consulta PRÓPRIA e não o store de Conversas**, pelo mesmo motivo de
 * `db/notes.ts`: o `load()` da caixa traz as 3.000 mensagens mais recentes da
 * empresa inteira mais a lista de conversas com join — caro demais para abrir
 * um contato. Aqui o recorte é por contato, e ele é pequeno: mediana de 17
 * mensagens, p99 de 112, máximo de 385 em todo o banco.
 *
 * É por essa medida que as mensagens vêm JUNTO da listagem, numa consulta só:
 * o diálogo abre instantâneo, sem segunda ida ao servidor nem estado de
 * carregamento por conversa.
 */

/** Quem escreveu, já resolvido em papel — o nome vem da equipe, na tela. */
export interface ConversaDoContato {
  id: string;
  channel: Channel;
  /** Número do WhatsApp que originou a conversa (nulo nos outros canais). */
  channelId: string | null;
  /** Responsável AGORA. Nulo em 66% das conversas deste banco (caixa do grupo). */
  assignedTo: string | null;
  createdAt: string;
  closedAt: string | null;
  archivedAt: string | null;
  mensagens: Message[];
  /**
   * Quem de fato ESCREVEU nesta conversa, na ordem em que apareceu.
   *
   * ⚠️ É daqui que sai o rótulo "conversa com a Cibelle", e não de
   * `assignedTo`: dois terços das conversas não têm responsável, e o
   * responsável de hoje não é necessariamente quem atendeu (no caso que
   * originou o pedido, o Alberto atendeu e transferiu para a Cibelle — as duas
   * aparecem).
   */
  participantes: string[];
  /**
   * Houve resposta humana sem autor gravado. Verdadeiro só no histórico antigo:
   * até a correção do `created_by` (ver a seção de SLA no AGENTS.md), 27% das
   * saídas de agosto ficaram sem autor, e não há como adivinhar quem enviou.
   * Em setembro são 100% com autor.
   */
  autorDesconhecido: boolean;
  /**
   * O bot respondeu e nenhuma PESSOA respondeu.
   *
   * ⚠️ "Só o bot respondeu" e "ninguém respondeu" são fatos diferentes, e o
   * mesmo cuidado já vale na aba de SLA: o auto-responder responde em segundos,
   * então tratar os dois como a mesma coisa esconde justamente a conversa que
   * ficou sem gente.
   */
  soBot: boolean;
  /** Primeira e última mensagem (qualquer tipo) — o período do atendimento. */
  primeira: string | null;
  ultima: string | null;
}

/**
 * ⚠️ Pagina com `.range()` em vez de um `select` seco: o PostgREST corta no
 * "Max rows" do projeto (1000) **sem erro e sem aviso**, e um fio cortado no
 * meio não tem como se anunciar. Hoje nenhum contato passa de 385 mensagens —
 * a paginação é o seguro para o dia em que passar.
 *
 * A ordem desempata por `id`: importação e disparo em lote gravam várias linhas
 * no MESMO `created_at`, e ordem instável entre páginas repete umas e PULA
 * outras — a linha pulada é uma mensagem que some do fio.
 */
async function buscarMensagens(
  supabase: any,
  convIds: string[]
): Promise<{ mensagens: Message[]; erro?: string }> {
  const PAGINA = 1000;
  const linhas: any[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .in("conversation_id", convIds)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(de, de + PAGINA - 1);
    // Erro sempre carrega code e message: "não carregou" sem motivo é o que já
    // custou rodadas de investigação neste projeto.
    if (error) return { mensagens: [], erro: `${error.code ?? "erro"} · ${error.message}` };
    linhas.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) break;
  }
  return { mensagens: linhas.map(mapMessage) };
}

export function useContactConversations(contactId: string | null | undefined) {
  const [conversas, setConversas] = useState<ConversaDoContato[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    // O `ensureSession` vem ANTES de qualquer setState: chamado direto do
    // efeito, um setState no corpo síncrono dispara renderização em cascata
    // (react-hooks/set-state-in-effect). Depois do primeiro await o resto roda
    // em continuação de promise.
    //
    // ⚠️ E ele não é formalidade: SEM sessão a RLS devolve ZERO LINHAS e NENHUM
    // erro — foi assim que a conversa aberta em aba nova nascia em branco.
    await useDbStore.getState().ensureSession();
    if (!contactId) {
      setConversas([]);
      setLoading(false);
      return;
    }
    setErro(null);
    const loc = useDbStore.getState().locationId;
    if (!loc) {
      setConversas([]);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase
      .from("conversations")
      .select("id, channel, channel_id, assigned_to, created_at, closed_at, archived_at")
      .eq("location_id", loc)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: true });
    if (error) {
      setErro(`${error.code ?? "erro"} · ${error.message}`);
      setConversas([]);
      setLoading(false);
      return;
    }
    const linhas = data ?? [];
    if (linhas.length === 0) {
      setConversas([]);
      setLoading(false);
      return;
    }
    const { mensagens, erro: erroMsgs } = await buscarMensagens(
      supabase,
      linhas.map((c: any) => c.id)
    );
    if (erroMsgs) {
      setErro(erroMsgs);
      setConversas([]);
      setLoading(false);
      return;
    }
    const porConversa = new Map<string, Message[]>();
    for (const m of mensagens) {
      const lista = porConversa.get(m.conversationId);
      if (lista) lista.push(m);
      else porConversa.set(m.conversationId, [m]);
    }
    setConversas(
      linhas.map((c: any) => {
        const msgs = porConversa.get(c.id) ?? [];
        const participantes: string[] = [];
        let autorDesconhecido = false;
        let bot = false;
        for (const m of msgs) {
          // Evento (a pílula cinza do fio) não é mensagem de ninguém.
          if (m.direction !== "out" || m.type === "event") continue;
          // Só saída de PESSOA conta como "quem atendeu": o bot e o motor de
          // automação respondem em segundos, e contá-los faria toda conversa
          // parecer atendida.
          if (m.automated) {
            bot = true;
            continue;
          }
          if (!m.createdBy) autorDesconhecido = true;
          else if (!participantes.includes(m.createdBy)) participantes.push(m.createdBy);
        }
        return {
          id: c.id,
          channel: c.channel,
          channelId: c.channel_id ?? null,
          assignedTo: c.assigned_to ?? null,
          createdAt: c.created_at,
          closedAt: c.closed_at ?? null,
          archivedAt: c.archived_at ?? null,
          mensagens: msgs,
          participantes,
          autorDesconhecido,
          soBot: bot && participantes.length === 0 && !autorDesconhecido,
          primeira: msgs[0]?.at ?? null,
          ultima: msgs[msgs.length - 1]?.at ?? null,
        } satisfies ConversaDoContato;
      })
    );
    setLoading(false);
  }, [contactId]);

  useEffect(() => {
    // A regra não enxerga através de `recarregar`: o setState de lá acontece
    // depois do primeiro await, não no corpo síncrono do efeito.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void recarregar();
  }, [recarregar]);

  return { conversas, loading, erro, recarregar };
}
