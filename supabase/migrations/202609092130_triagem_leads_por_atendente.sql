-- ============================================================
-- "Leads do dia" passa a responder POR ATENDENTE
--
-- Pedido do Gabriel (2026-09-09): *"colocar a opção de ver quantos leads cada
-- atendente do número do time comercial (Vendas) recebeu, quantos ele fechou e
-- finalizou a conversa e, se for possível, identificar os cursos quando o
-- atendente marcar."*
--
-- ⚠️ **Continua UMA linha por lead**, com quatro colunas a mais — não uma
-- segunda função que agrega por atendente. É a mesma decisão da 202609041015: o
-- predicado de "entrou" existe em UM lugar, senão os quadros da mesma tela
-- passam a se contradizer e ninguém sabe qual está certo. Quem agrega é a rota.
--
-- ⚠️ `drop` + `create`: a coluna nova troca o tipo de retorno e
-- `create or replace` daria `42P13`. É seguro aqui porque a assinatura é
-- IDÊNTICA e a mudança é ADITIVA — quem lê por nome de campo não percebe, e o
-- script roda numa transação. (Diferente da 202609081345, onde o que mudava era
-- o COMPORTAMENTO e a função precisou de nome novo.)
--
-- Ordem: pode ser aplicada ANTES ou DEPOIS do merge — colunas a mais não quebram
-- o código antigo, e o novo trata a ausência delas.
-- ============================================================
set check_function_bodies = off;

drop function if exists public.triagem_leads(uuid, date, date, text);

create function public.triagem_leads(
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
  pontos int,
  /**
   * Quem está com o lead AGORA (`conversations.assigned_to`).
   *
   * ⚠️ É "recebeu", não "atendeu": a conversa pode ter sido devolvida ao rodízio
   * e trocado de dono. O histórico de quem passou por ela está nos eventos do
   * fio (gatilho da 202608281530); aqui a pergunta é de carteira — com quem o
   * lead está.
   */
  atendente uuid,
  /** O atendimento foi encerrado (`closed_at`). */
  finalizada boolean,
  /**
   * A oportunidade vinculada está GANHA.
   *
   * ⚠️ **O vínculo é uma APROXIMAÇÃO, e isso precisa estar dito:** não existe
   * `opportunities.conversation_id`. O card do bot nasce por CONTATO
   * (`ensureCard` procura por `contact_id` antes de criar), então aqui se toma a
   * oportunidade MAIS RECENTE daquele contato. Para o lead novo — que é o
   * universo deste relatório — ela é a criada durante a triagem. Para um contato
   * que já comprou antes e voltou, pode ser a antiga.
   */
  ganha boolean,
  /** `opportunities.course` da mesma oportunidade. NULL = ninguém marcou. */
  curso text
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
    select cv.id, cv.created_at, cv.contact_id, cv.assigned_to, cv.closed_at
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
   * servidor diria 0h.
   *
   * ⚠️ `left join`: lead SEM desfecho tem de vir na lista, com `resultado` nulo.
   * É ele o "não concluíram" — filtrá-lo apagaria da tela exatamente quem
   * abandonou a triagem, que é o pior caso. Vale igual para a oportunidade:
   * lead sem card nenhum continua sendo um lead recebido.
   */
  select chegou.id,
         (chegou.created_at at time zone 'America/Sao_Paulo')::date,
         extract(hour from chegou.created_at at time zone 'America/Sao_Paulo')::smallint,
         primeiro.resultado,
         primeiro.pontos,
         chegou.assigned_to,
         (chegou.closed_at is not null),
         coalesce(op.status = 'won', false),
         op.course
    from chegou
    left join primeiro on primeiro.conversation_id = chegou.id
    /*
     * ⚠️ `left join lateral ... limit 1` e não um `join` comum: um contato pode
     * ter vários cards (a escola vende Célula, Aviônica e GMP separados), e sem
     * o `limit` o mesmo lead viraria duas linhas — quebrando a soma que faz as
     * fatias do gráfico fecharem com "entraram".
     */
    left join lateral (
      select o.status, o.course
        from public.opportunities o
       where o.location_id = p_location
         and o.contact_id = chegou.contact_id
       order by o.created_at desc
       limit 1
    ) op on true;
end;
$fn$;

/*
 * ⚠️ O par obrigatório, e aqui ele NÃO é redundância: o `drop` acima apaga os
 * privilégios, e `pg_default_acl` concede EXECUTE de toda função nova a anon,
 * authenticated E service_role individualmente — então o revoke tem de citar os
 * três para o `authenticated` não sobrar por baixo.
 */
revoke execute on function public.triagem_leads(uuid, date, date, text)
  from public, anon, authenticated;
grant execute on function public.triagem_leads(uuid, date, date, text) to authenticated;

-- O PostgREST cacheia a assinatura das funções: sem isto ele descreveria a
-- versão antiga (5 colunas) e a rota receberia menos do que pede.
notify pgrst, 'reload schema';
