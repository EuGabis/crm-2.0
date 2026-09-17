"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A linha do tempo de UM contato: o que aconteceu com ele, em ordem.
 *
 * Pedido do Gabriel (2026-09-16): *"ao selecionar o contato, tem uma janela de
 * visualização das conversas e também de atividades, como quando foi criado um
 * card, para quem foi associado, etc."*
 *
 * 🔴 **Só entra o que o banco REALMENTE guarda.** Levantado antes de escrever:
 *
 * | o que | existe? |
 * |---|---|
 * | atribuição/transferência/devolução da conversa | ✅ `messages.type='event'` (gatilho da 202608281530) — 13.182 eventos em 30 dias |
 * | criação do card no funil | ✅ `opportunities.created_at` |
 * | triagem do bot (quente/frio) | ✅ `bot_desfechos` |
 * | tarefa e compromisso criados | ✅ |
 * | **mudança de FASE do card** | ❌ **não é gravada em lugar nenhum** |
 * | **troca de dono do card** | ❌ só o estado atual |
 *
 * ⚠️ As duas últimas linhas são o motivo de a tela DIZER o que ela não sabe. Uma
 * linha do tempo que omite silenciosamente a mudança de fase leva quem lê a
 * concluir que o card nunca se moveu — e é o tipo de conclusão que este projeto
 * já pagou caro (a coluna "% da fase anterior" do painel tem a mesma ressalva).
 */

export type TipoAtividade =
  | "contato_criado"
  | "conversa_evento"
  | "card_criado"
  | "triagem"
  | "tarefa"
  | "compromisso";

export interface Atividade {
  id: string;
  tipo: TipoAtividade;
  at: string;
  texto: string;
  /** Detalhe secundário (funil, número, responsável…), quando houver. */
  detalhe?: string | null;
}

/**
 * ⚠️ Consulta PRÓPRIA e enxuta, como `db/notes.ts` e `db/contact-conversations.ts`.
 * O store de Conversas carrega as mensagens da empresa inteira — ler dali para
 * montar a linha do tempo de UM contato seria pagar o preço errado.
 */
async function buscar(contactId: string): Promise<{ itens: Atividade[]; erro?: string }> {
  const supabase = createClient();

  // As conversas do contato primeiro: os eventos moram nelas.
  const { data: convs, error: eConv } = await supabase
    .from("conversations")
    .select("id, created_at, channel")
    .eq("contact_id", contactId);
  if (eConv) return { itens: [], erro: `${eConv.code ?? ""} ${eConv.message}`.trim() };

  const convIds = (convs ?? []).map((c: any) => c.id);

  const [eventos, cards, tarefas, compromissos, desfechos, contato] = await Promise.all([
    convIds.length
      ? supabase
          .from("messages")
          .select("id, conversation_id, body, created_at")
          .in("conversation_id", convIds)
          .eq("type", "event")
          .order("created_at", { ascending: false })
          .order("id")
          // Teto: um contato com centenas de eventos de rodízio encheria a tela
          // sem acrescentar nada. Os mais recentes são os que respondem
          // "para quem foi associado".
          .range(0, 199)
      : Promise.resolve({ data: [], error: null } as any),
    supabase
      .from("opportunities")
      .select("id, name, created_at, pipeline_id, stage_id, owner_id, status")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("id, title, created_at")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .range(0, 49),
    supabase
      .from("appointments")
      .select("id, title, created_at, starts_at")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .range(0, 49),
    convIds.length
      ? supabase
          .from("bot_desfechos")
          .select("id, conversation_id, resultado, pontos, limiar, rotulo, created_at")
          .in("conversation_id", convIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null } as any),
    supabase.from("contacts").select("created_at").eq("id", contactId).maybeSingle(),
  ]);

  const itens: Atividade[] = [];

  for (const e of (eventos.data ?? []) as any[]) {
    itens.push({
      id: `ev-${e.id}`,
      tipo: "conversa_evento",
      at: e.created_at,
      // O texto do evento JÁ vem pronto do gatilho ("Atribuída a X · pelo
      // sistema · rodízio do bot") — reescrevê-lo aqui criaria uma segunda
      // redação da mesma coisa, para divergir na primeira mudança.
      texto: e.body ?? "evento",
    });
  }

  for (const o of (cards.data ?? []) as any[]) {
    itens.push({
      id: `op-${o.id}`,
      tipo: "card_criado",
      at: o.created_at,
      texto: `Card criado no funil: ${o.name}`,
      detalhe: o.status === "won" ? "ganho" : o.status === "lost" ? "perdido" : "aberto",
    });
  }

  for (const d of (desfechos.data ?? []) as any[]) {
    const nota =
      d.pontos != null && d.limiar != null ? ` (${d.pontos} de ${d.limiar} pontos)` : "";
    itens.push({
      id: `bd-${d.id}`,
      tipo: "triagem",
      at: d.created_at,
      texto: `Triagem do bot: ${d.rotulo ?? d.resultado ?? "sem desfecho"}${nota}`,
    });
  }

  for (const t of (tarefas.data ?? []) as any[]) {
    itens.push({ id: `tk-${t.id}`, tipo: "tarefa", at: t.created_at, texto: `Tarefa: ${t.title}` });
  }

  for (const a of (compromissos.data ?? []) as any[]) {
    itens.push({
      id: `ap-${a.id}`,
      tipo: "compromisso",
      at: a.created_at,
      texto: `Compromisso: ${a.title}`,
      detalhe: a.starts_at ? `para ${new Date(a.starts_at).toLocaleString("pt-BR")}` : null,
    });
  }

  for (const c of (convs ?? []) as any[]) {
    itens.push({
      id: `cv-${c.id}`,
      tipo: "conversa_evento",
      at: c.created_at,
      texto: "Conversa aberta",
      detalhe: c.channel,
    });
  }

  if (contato.data?.created_at) {
    itens.push({
      id: "contato",
      tipo: "contato_criado",
      at: contato.data.created_at,
      texto: "Contato criado",
    });
  }

  // Mais recente primeiro, desempatando por id: vários itens podem nascer no
  // mesmo instante (o bot cria conversa, card e desfecho em sequência), e ordem
  // instável faria a lista embaralhar entre montagens.
  itens.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return { itens };
}

export function useContactActivity(contactId: string | null) {
  const [itens, setItens] = useState<Atividade[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /*
   * ⚠️ O estado inicial é ajustado DEPOIS do primeiro await, não no corpo
   * síncrono do efeito — `setState` síncrono ali dispara renderização em
   * cascata e o lint acusa. Mesmo arranjo do repo irmão
   * (`db/contact-conversations.ts`).
   */
  const carregar = useCallback(async (id: string | null) => {
    if (!id) {
      setItens([]);
      setLoading(false);
      setErro(null);
      return;
    }
    setLoading(true);
    setErro(null);
    const r = await buscar(id);
    setItens(r.itens);
    setErro(r.erro ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar(contactId);
  }, [contactId, carregar]);

  return { itens, loading, erro };
}
