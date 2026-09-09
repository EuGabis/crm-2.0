-- ============================================================
-- A devolução vale só ATÉ A PRIMEIRA RESPOSTA do atendente
--
-- Regra do Gabriel (2026-09-09): "se um contato manda mensagem é atribuído para
-- o vendedor; ele não responde em 15 minutos, passa para outro. Agora se ele foi
-- atribuído e o vendedor MANDOU MENSAGEM, ele fica para aquele vendedor e não
-- volta para o rodízio."
--
-- 🔴 Isto REVISA a regra de ontem, e para melhor. Ontem a saída para o comercial
-- foi desligar a devolução inteira (`devolver_apos_min = 0`), porque ela tirava
-- do vendedor uma negociação em andamento. Com a régua da PRIMEIRA RESPOSTA o
-- problema deixa de existir na raiz: circula só o lead que ninguém atendeu, e
-- quem atendeu fica com ele. Então a devolução volta a valer no comercial — o
-- que resolve o outro lado da queixa, o lead que cai num vendedor ausente e não
-- é visto por mais ninguém.
--
-- ⚠️ A pergunta passa a ser "alguém já respondeu ALGUMA VEZ?", não "respondeu
-- depois da última mensagem do cliente". A diferença é o caso do dia a dia:
-- vendedor manda a proposta, o cliente responde três dias depois, o vendedor
-- está em outro atendimento — com a régua antiga a conversa era arrancada dele
-- no meio da negociação.
--
-- Ordem: pode ser aplicada ANTES ou DEPOIS do merge. A coluna nova é ADITIVA —
-- o código antigo não a lê, e o código novo, enquanto a migração não for
-- aplicada, lê `undefined` e cai no comportamento de hoje.
-- ============================================================
set check_function_bodies = off;

/*
 * ⚠️ `drop` + `create`, e aqui isso é SEGURO — ao contrário da 202609081345,
 * onde a função precisou de nome novo. A diferença:
 *
 *  · lá o problema era de COMPORTAMENTO: o código no ar chamava a função com a
 *    âncora errada, e trocá-la por baixo dele o atropelaria;
 *  · aqui a assinatura é IDÊNTICA e a mudança é ADITIVA (uma coluna a mais).
 *    Quem lê por nome de campo não percebe, e o script roda numa transação, sem
 *    janela em que a função não exista.
 *
 * `create or replace` não serve: trocar o tipo de retorno dá
 * `42P13 cannot change return type of existing function`.
 */
drop function if exists public.conversas_paradas(uuid, integer);

create function public.conversas_paradas(
  p_location uuid,
  p_limite_min integer default 15
)
returns table (
  conversation_id uuid,
  contact_id uuid,
  assigned_to uuid,
  assigned_by uuid,
  channel_id uuid,
  devolvida_em timestamptz,
  ultima_do_cliente timestamptz,
  espera_util_min numeric,
  passou_pelo_bot boolean,
  /*
   * 🔴 A COLUNA NOVA: alguém já respondeu esta conversa alguma vez?
   *
   * ⚠️ Devolvida, e não filtrada aqui, DE PROPÓSITO. O contrato entre as duas
   * camadas já estava escrito em `devolvivel()`: a SQL responde "a bola está com
   * a gente há mais de N minutos úteis?" e o TypeScript responde "e mesmo assim,
   * devo mexer?". "Já respondeu alguma vez" é do segundo tipo — e lá ela ganha
   * TESTE, que é o que falta a uma condição escondida num `where`.
   *
   * Não muda o volume: conversa já respondida em que o cliente voltou a escrever
   * JÁ vinha nesta lista — era justamente ela que era arrancada do vendedor.
   */
  ja_respondida boolean
)
language plpgsql
stable
security definer
set search_path = public, private
as $function$
begin
  if p_location is null then
    return;
  end if;
  -- Defesa em profundidade: hoje só a service_role executa (ver os grants no
  -- fim). O ramo existe para o dia em que alguém conceder a `authenticated` sem
  -- reler esta migração.
  if auth.uid() is not null
     and p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  with abertas as (
    select c.id, c.contact_id, c.assigned_to, c.assigned_by, c.channel_id, c.devolvida_em
      from public.conversations c
     where c.location_id = p_location
       and c.closed_at is null
       and c.archived_at is null
  ),
  /*
   * ⚠️ Dois sinais para "passou pelo bot", unidos por OR, e nenhum sozinho
   * basta: `bot_sessions` é apagada quando uma conversa finalizada reabre, e a
   * mensagem `automated` pode ainda não existir numa sessão recém-criada.
   */
  bot as (
    select a.id,
           ( exists (select 1 from public.bot_sessions s where s.conversation_id = a.id)
             or exists (
               select 1 from public.messages m
                where m.conversation_id = a.id
                  and m.direction = 'out'
                  and m.automated is true
             ) ) as passou
      from abertas a
  ),
  ult as (
    select m.conversation_id,
           max(m.created_at) filter (where m.direction = 'in') as t_cliente,
           /*
            * "Humano" exclui o BOT (`automated`) e a NOTA INTERNA: nenhum dos
            * dois é atendimento, e contá-los faria toda conversa parecer
            * respondida em segundos.
            */
           max(m.created_at) filter (
             where m.direction = 'out'
               and coalesce(m.automated, false) = false
               and coalesce(m.internal, false) = false
           ) as t_humano
      from public.messages m
     where m.location_id = p_location
       and coalesce(m.type, '') <> 'event'
     group by m.conversation_id
  )
  select a.id::uuid, a.contact_id::uuid, a.assigned_to::uuid, a.assigned_by::uuid,
         a.channel_id::uuid, a.devolvida_em::timestamptz, u.t_cliente::timestamptz,
         private.business_minutes(u.t_cliente, now())::numeric,
         b.passou::boolean,
         (u.t_humano is not null)::boolean
    from abertas a
    join ult u on u.conversation_id = a.id
    join bot b on b.id = a.id
   where u.t_cliente is not null
     -- A BOLA ESTÁ COM A GENTE: ninguém respondeu depois da última do cliente.
     and (u.t_humano is null or u.t_humano < u.t_cliente)
     and private.business_minutes(u.t_cliente, now()) >= p_limite_min
   order by private.business_minutes(u.t_cliente, now()) desc;
end;
$function$;

/*
 * ⚠️ O par `revoke from public, anon` NÃO basta neste projeto: `pg_default_acl`
 * concede EXECUTE de toda função nova a anon, authenticated E service_role
 * INDIVIDUALMENTE, então o `authenticated` sobrevive ao revoke do PUBLIC. E como
 * esta migração faz `drop` + `create`, os privilégios nascem do zero — repetir o
 * par aqui não é redundância, é obrigatório.
 */
revoke execute on function public.conversas_paradas(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.conversas_paradas(uuid, integer) to service_role;

-- ------------------------------------------------------------
-- A devolução volta a valer no comercial
-- ------------------------------------------------------------
/*
 * ⚠️ SUBSTITUI o passo 2 da 202609081346, que desligava o comercial. O motivo
 * daquele desligamento — "o vendedor manda mensagem e o cliente responde quando
 * puder" — está resolvido pela regra da primeira resposta; manter 0 agora
 * deixaria o lead NÃO atendido preso num vendedor ausente, que é o problema
 * oposto e o que originou o rodízio.
 *
 * ⚠️ Igualdade exata nos nomes, nunca `ilike '%secretaria%'`: este banco tem
 * "Secretaria" E "Secretaria Backup" (o time comercial), e casar por trecho já
 * confundiu setor neste projeto antes.
 *
 * ⚠️ Financeiro fica de fora: ele tem `usa_rodizio = false` e `devolverInativas`
 * pula quem não usa rodízio — escrever 15 ali criaria um número que mente sobre
 * o que acontece, para alguém acreditar depois.
 */
update public.departments
   set devolver_apos_min = 15
 where usa_rodizio is true
   and name in ('Secretaria', 'Secretaria Backup', 'Vendas', 'Comercial');

/*
 * Confira as linhas afetadas e o estado final. Zero linhas significa que os
 * nomes deste banco são outros e a devolução continua como estava — seguro, mas
 * não é o que esta migração pretende:
 *
 *   select name, usa_rodizio, devolver_apos_min, intervalo_fila_min
 *     from public.departments order by name;
 */
