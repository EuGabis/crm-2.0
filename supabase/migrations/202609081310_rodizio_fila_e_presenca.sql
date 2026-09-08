-- ============================================================
-- Rodízio: a fila do setor deixa de ser um beco sem saída
--
-- Duas falhas MEDIDAS em 2026-09-08, independentes uma da outra:
--
-- 1) NADA esvaziava a fila do setor. O lead entra em
--    `conversations.awaiting_distribution` e só saía pelo botão do admin — a
--    varredura que a 0058 prometia (`/api/leads/sweep`) nunca existiu. Medido:
--    12 leads presos, 3 desde 03/09 (115h), com atendente ONLINE no setor.
--    Corrigido em TypeScript (`distribuirFilaDoSetor`, no tique de minuto), que
--    reusa o `distributeOne` de sempre — não há SQL para isso aqui.
--
-- 2) A rede de segurança de 28/08 (`devolverInativas`) É UM NO-OP desde que
--    subiu. Ela chama `public.sla_conversations`, cuja PRIMEIRA LINHA é a guarda
--    de empresa (`p_location not in (select private.user_locations())`) — e o
--    tique chama com a SERVICE ROLE, cujo `auth.uid()` é nulo. Resultado:
--    ZERO LINHAS, SEM ERRO. Conferido como `service_role`: 0 linhas; como admin
--    real: 35 clientes esperando, 6 presos com atendente. Em 11 dias, zero
--    eventos de devolução.
--
--    ⚠️ É a armadilha que este repositório já registrou DUAS vezes: "zero linhas
--    por guarda de RLS não é prova de que a função funciona". O tique respondia
--    200 e `{devolvidas: 0}` — com cara de saúde.
--
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

-- ------------------------------------------------------------
-- 1. A pergunta "quem está esperando" para quem NÃO tem sessão
-- ------------------------------------------------------------
/*
 * Por que uma função NOVA em vez de afrouxar a guarda de `sla_conversations`:
 *
 * `sla_conversations` é lida pela aba Atendimento e pelo widget do painel com a
 * sessão do usuário, e a guarda dela é o que impede um autenticado de ler o
 * atendimento de outra empresa. Trocar a guarda por "passa se auth.uid() é nulo"
 * abriria a função para o `anon`, que também tem uid nulo — seria o vazamento da
 * 0080 de novo, e num objeto muito mais sensível.
 *
 * Esta função é o recorte MÍNIMO de que o rodízio precisa e é concedida SÓ à
 * service_role. `authenticated` não recebe: nenhuma tela consome isto.
 *
 * ⚠️ A definição de "esperando" é a MESMA da 0079 — `private.business_minutes`
 * sobre a primeira entrada sem resposta HUMANA. Reusar a função de expediente em
 * vez de recalcular é o que mantém a devolução e o relatório de SLA
 * CONCORDANDO; duas definições divergiriam na primeira mudança, e aí a tela
 * diria que o cliente espera 40 min enquanto o rodízio acharia que espera 5.
 *
 * ⚠️ E a resposta do BOT não conta como atendimento (`m.automated = false`):
 * o auto-responder responde em segundos e, contando, NENHUMA conversa pareceria
 * parada — a devolução nunca dispararia.
 */
create or replace function public.conversas_esperando(
  p_location uuid,
  p_limite_min integer default 15
)
returns table (
  conversation_id uuid,
  contact_id uuid,
  assigned_to uuid,
  channel_id uuid,
  espera_util_min numeric
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
  /*
   * Guarda de defesa em profundidade. Hoje só a service_role tem EXECUTE, então
   * este ramo nunca roda — ele existe para o dia em que alguém conceder a
   * `authenticated` sem reler esta migração: aí a função passa a se comportar
   * como as da 0049 (checagem de empresa na primeira linha) em vez de vazar.
   */
  if auth.uid() is not null
     and p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  with msgs as (
    select m.conversation_id, m.direction, m.created_at,
           coalesce(m.automated, false) as automated
      from public.messages m
     where m.location_id = p_location
       -- Janela de 7 dias: a devolução só interessa a quem espera AGORA, e
       -- varrer 30 dias a cada minuto seria pagar por linhas já respondidas.
       and m.created_at >= now() - interval '7 days'
       and coalesce(m.internal, false) = false
       and coalesce(m.type, '') <> 'event'
  ),
  entrada as (
    select m.conversation_id, min(m.created_at) as t_in
      from msgs m where m.direction = 'in' group by m.conversation_id
  ),
  respondida as (
    select m.conversation_id
      from msgs m
      join entrada e on e.conversation_id = m.conversation_id
     where m.direction = 'out' and m.automated = false and m.created_at >= e.t_in
     group by m.conversation_id
  )
  /*
   * ⚠️ Conversão EXPLÍCITA em toda coluna, mesmo onde o tipo já bate. A regra
   * saiu do `42804` da 202609031359: `structure of query does not match function
   * result type` não diz QUAL coluna divergiu, e numa função de 5 colunas isso é
   * procurar no escuro. Custa nada e troca um erro de execução opaco por um
   * acerto de leitura.
   */
  select c.id::uuid, c.contact_id::uuid, c.assigned_to::uuid, c.channel_id::uuid,
         private.business_minutes(e.t_in, now())::numeric as espera
    from entrada e
    join public.conversations c on c.id = e.conversation_id
   where c.location_id = p_location
     and c.closed_at is null
     and c.archived_at is null
     and e.conversation_id not in (select r.conversation_id from respondida r)
     and private.business_minutes(e.t_in, now()) >= p_limite_min
   order by espera desc;
end;
$function$;

/*
 * 🔴 O par da 0080 NÃO BASTA aqui, e isto foi MEDIDO neste banco.
 *
 * O `AGENTS.md` diz que "`create function` já concede EXECUTE a PUBLIC". É o
 * padrão do Postgres, mas não é o mecanismo que vale no Supabase: lido de
 * `pg_default_acl`, o projeto tem `alter default privileges` concedendo EXECUTE
 * de TODA função nova a `anon`, `authenticated` e `service_role`
 * INDIVIDUALMENTE — `{anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`.
 *
 * Consequência que passa batida: `revoke ... from public, anon` (o par que o
 * repositório usa) **deixa o `authenticated` com EXECUTE**, porque a concessão
 * dele é direta e não vem do PUBLIC. Conferido logo depois de criar esta função:
 * `has_function_privilege('authenticated', ...)` = TRUE sem nenhum `grant` meu.
 *
 * Para a maioria das funções isso não aparece, porque elas levam
 * `grant ... to authenticated` de propósito. Aqui NÃO: nenhuma tela consome esta
 * função, e quem a chama é o tique com a service role. Daí o `revoke` explícito
 * do `authenticated`.
 *
 * ⚠️ Ao escrever função que NÃO deve ser chamável pela tela, revogue dos TRÊS.
 * Depois: anon=false, authenticated=false, service_role=true (conferido).
 */
revoke execute on function public.conversas_esperando(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.conversas_esperando(uuid, integer) to service_role;

-- ------------------------------------------------------------
-- 2. Sair do CRM apaga a presença
-- ------------------------------------------------------------
/*
 * `touch_presence` (0056) marca presença e NADA a apagava: sair do CRM — ou ser
 * deslogado por inatividade, que para o papel "user" acontece em 10 min — deixava
 * `last_seen_at` parado no último clique, e a pessoa seguia "online" para o
 * rodízio pela janela inteira. Com a janela subindo para 15 min, essa sobra
 * passaria a ser de 5 min em que o lead cai em quem acabou de ser posto para fora.
 *
 * ⚠️ `npm run db:check` acusa esta função por ser `security definer` sem
 * mencionar `private.user_locations()`. É FALSO POSITIVO, e a razão é a mesma
 * da irmã `touch_presence` (0056): ela escreve UMA linha, a do próprio
 * chamador (`where user_id = auth.uid()`), então não existe "empresa do
 * chamador" a conferir — não há parâmetro por onde apontar para outra
 * empresa. O definer serve só para não alargar o UPDATE de
 * `location_members`. Está escrito aqui para ninguém reauditar.
 */
create or replace function public.clear_presence()
returns void
language sql
security definer
set search_path = public
as $function$
  update public.location_members
     set last_seen_at = null
   where user_id = auth.uid();
$function$;

revoke execute on function public.clear_presence() from public, anon;
grant execute on function public.clear_presence() to authenticated;

-- ------------------------------------------------------------
-- 3. Limpa a flag VELHA de fila
-- ------------------------------------------------------------
/*
 * Os 3 leads de 03/09 presos há 115h estavam com `awaiting_distribution = true`
 * de um ciclo ANTERIOR: a conversa foi finalizada, o cliente escreveu de novo, o
 * webhook zerou a sessão do bot e uma triagem NOVA começou — mas a flag do ciclo
 * velho ficou. Medido: os três estão com `bot_sessions.status = 'aguardando'` nos
 * nós `pede_nome`/`pede_email`, ou seja o bot está no meio da triagem esperando
 * o cliente, que abandonou. Não há atendente a quem entregar isso.
 *
 * ⚠️ Critério ESTREITO: só a conversa cuja sessão está `aguardando`. Sessão
 * `concluido` é lead que terminou a triagem e espera humano de verdade — é
 * exatamente quem a varredura tem de distribuir, e limpar a flag dele o
 * esconderia da fila do setor.
 *
 * A origem também foi corrigida (o webhook passa a limpar a flag ao reiniciar a
 * triagem), então isto é o retroativo, não um remendo recorrente.
 */
update public.conversations c
   set awaiting_distribution = false
 where c.awaiting_distribution is true
   and c.assigned_to is null
   and exists (
     select 1 from public.bot_sessions bs
      where bs.conversation_id = c.id and bs.status = 'aguardando'
   );
