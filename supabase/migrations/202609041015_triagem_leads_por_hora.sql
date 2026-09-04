-- Lito CRM — "Leads do dia" ganha visão POR HORA, e a definição de "lead" passa
-- a existir em UM lugar só
--
-- Pedido do Gabriel (04/09/2026): "colocar uma visualização por hora também,
-- para analisar qual horário costuma cair mais leads".
--
-- Medido antes de construir (secretaria, 30 dias): pico às **12h** (37 leads),
-- depois 9h (33) e 14h (32); **17% dos leads chegam fora do expediente**
-- (8h–19h, a mesma janela da 0079). Ou seja, há decisão de escala a tomar com
-- isso — não é gráfico decorativo.
--
-- ⚠️ **A questão de projeto não é a hora: é não ter DUAS definições de "lead".**
-- O caminho curto seria uma segunda função agregando por hora, com o mesmo
-- predicado de "entrou" copiado da `relatorio_triagem_diaria`. São ~20 linhas
-- duplicadas, e justamente as que tiveram um defeito ontem (o desfecho contado
-- no dia do evento em vez do dia de entrada). Divergindo, os dois gráficos da
-- MESMA tela passariam a se contradizer, e ninguém saberia qual está certo.
--
-- Então esta função devolve **UMA LINHA POR LEAD** e quem agrega é a rota — o
-- mesmo desenho de `sla_conversations` (0079), que já está documentado no
-- AGENTS.md pelo mesmo motivo. A `relatorio_triagem_diaria` sai na migração
-- irmã (202609041016), depois do merge — ver a nota de ordem de deploy no fim
-- deste arquivo.
--
-- ⚠️ **O teto está medido**: 339 leads em 30 dias (a integração do WhatsApp tem
-- ~1 mês; 180 dias dão os mesmos 339). Mesmo a 180 dias isso é ~20 KB de
-- resposta. O dia em que virar dezenas de milhares é o dia de voltar a agregar
-- no servidor — a mesma ressalva que a 0079 carrega.

create or replace function public.triagem_leads(
  p_location uuid,
  p_de date,
  p_ate date,
  /** Fluxo a medir (`triagem`, `triagem-secretaria`). NULL = todos. */
  p_flow text default null
)
returns table (
  conversa uuid,
  /** Dia da ENTRADA, já no fuso de São Paulo. */
  dia date,
  /** Hora da entrada (0–23), já no fuso de São Paulo. */
  hora smallint,
  /** Desfecho do bot. NULL = não concluiu a triagem. */
  resultado text,
  /** Só fluxo com nó de pontuação tem número. NULL não é zero. */
  pontos int
)
language plpgsql
stable
security definer
set search_path = public, private
as $fn$
begin
  -- Checagem de empresa na PRIMEIRA linha (padrão 0049).
  if p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  with canais as (
    select ch.id
      from public.whatsapp_channels ch
     where ch.location_id = p_location
       and (p_flow is null or ch.bot_flow = p_flow)
  ),
  chegou as (
    /*
     * O universo do relatório: uma linha por conversa que ENTROU no período.
     * Sai de `conversations.created_at` e exige mensagem de ENTRADA — conversa
     * aberta pelo CRM ("Nova conversa") não é lead que chegou.
     */
    select cv.id, cv.created_at
      from public.conversations cv
     where cv.location_id = p_location
       and cv.channel_id in (select id from canais)
       and (cv.created_at at time zone 'America/Sao_Paulo')::date between p_de and p_ate
       and exists (
         select 1 from public.messages m
          where m.conversation_id = cv.id and m.direction = 'in'
       )
  ),
  primeiro as (
    /*
     * ⚠️ **Uma conversa = um lead = UM desfecho**, e vale o PRIMEIRO. A conversa
     * que reabre passa pelo bot de novo (o webhook zera a sessão) e gera outra
     * linha na tabela, que é append-only de propósito. Contar as duas quebraria
     * a partição: o lead é contado UMA vez, porque a conversa foi criada uma
     * vez só.
     */
    select distinct on (d.conversation_id)
           d.conversation_id, d.resultado, d.pontos
      from public.bot_desfechos d
     where d.location_id = p_location
       and (p_flow is null or d.flow_key = p_flow)
       and d.conversation_id is not null
     order by d.conversation_id, d.created_at
  )
  /*
   * ⚠️ **Dia e hora são calculados AQUI, no fuso de São Paulo**, e não deixados
   * para o navegador. Devolvendo só o `timestamptz`, a hora sairia no relógio de
   * quem abre a tela — e a Vercel roda em UTC, então às 21h de Brasília o
   * servidor diria 0h. É a mesma armadilha de `private.business_minutes` (0079)
   * e das janelas de resposta automática. Com a conversão no banco, a regra
   * existe num lugar e nenhuma camada acima pode discordar dela.
   *
   * ⚠️ `left join`: lead SEM desfecho tem de vir na lista, com `resultado` nulo.
   * É ele o "não concluíram" — filtrá-lo aqui apagaria da tela exatamente quem
   * abandonou a triagem, que é o pior caso.
   */
  select chegou.id,
         (chegou.created_at at time zone 'America/Sao_Paulo')::date,
         extract(hour from chegou.created_at at time zone 'America/Sao_Paulo')::smallint,
         primeiro.resultado,
         primeiro.pontos
    from chegou
    left join primeiro on primeiro.conversation_id = chegou.id;
end;
$fn$;

-- ⚠️ O par obrigatório: `create function` já concede EXECUTE a PUBLIC, e
-- `create or replace` NÃO reseta grants (o bug da 0080).
revoke execute on function public.triagem_leads(uuid, date, date, text) from public, anon;
grant  execute on function public.triagem_leads(uuid, date, date, text) to authenticated;

/*
 * ⚠️ **Esta migração é ADITIVA de propósito, e isso é uma decisão de ORDEM DE
 * DEPLOY, não de estilo.** Ela pode ser aplicada ANTES do merge sem quebrar
 * nada: cria uma função que ninguém ainda chama.
 *
 * A remoção da `relatorio_triagem_diaria`, que o código NO AR ainda usa, está
 * numa migração separada (`202609041016`) para ser aplicada DEPOIS do merge.
 *
 * Eu errei exatamente isso em 03/09: apliquei a migração que removia a função
 * antiga antes de o código subir, e a aba "Leads do dia" ficou respondendo erro
 * em produção até o merge. Aqui a produção nunca fica sem uma função válida:
 * antes do merge existem as duas, depois do merge sobra a nova.
 */

notify pgrst, 'reload schema';
