-- Tempo online por atendente + os leads por trás de cada número do quadro
-- "Por atendente" (aba Leads do dia).
--
-- Pedido do Gabriel (2026-09-16), duas partes:
--   1. clicar nos números do quadro e VER os leads daquele atendente, com o
--      contato à mão e o botão de abrir a conversa — e quantos foram frios e
--      quantos foram quentes;
--   2. na aba Relatórios → Agentes, quanto tempo o atendente ficou online.
--
-- 🔴 **O tempo online NÃO era calculável.** O CRM só guardava o ESTADO ATUAL da
-- presença (`location_members.last_seen_at` e `online_desde`, este último o
-- início da temporada em curso). Não existia histórico nenhum, então a coluna
-- começa a valer A PARTIR DESTA MIGRAÇÃO — não há como reconstruir o passado, e
-- a tela diz isso em vez de mostrar zeros com cara de "ficou offline".
--
-- Aplicável ANTES do merge: tudo aqui é aditivo. `triagem_leads` ganha colunas
-- A MAIS e o código no ar lê por nome de campo, então não percebe a diferença.

begin;

-- ---------------------------------------------------------------------------
-- 1. Histórico de presença
-- ---------------------------------------------------------------------------

create table if not exists public.presence_sessions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  inicio timestamptz not null default now(),
  -- ⚠️ `fim` é o ÚLTIMO PING, não um logout. Nada garante que alguém deslogue —
  -- fechar a aba não avisa ninguém —, então a sessão "fecha sozinha" no último
  -- sinal de vida. É a única definição que não depende de um evento que pode
  -- nunca acontecer.
  fim timestamptz not null default now()
);

create index if not exists presence_sessions_lookup
  on public.presence_sessions (location_id, user_id, inicio desc);

alter table public.presence_sessions enable row level security;

drop policy if exists "membros leem presenca" on public.presence_sessions;
create policy "membros leem presenca" on public.presence_sessions
  for select to authenticated
  using (location_id in (select private.user_locations()));

-- ⚠️ Sem policy de INSERT/UPDATE/DELETE de propósito: quem escreve é
-- `touch_presence` (security definer). Tempo online é medida de trabalho — se a
-- própria pessoa pudesse escrever aqui, o número deixaria de significar algo.
revoke all on public.presence_sessions from anon;
grant select on public.presence_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. `touch_presence` passa a gravar o histórico
-- ---------------------------------------------------------------------------
--
-- ⚠️ `npm run db:check` acusa "definer sem checagem de empresa" aqui, e é FALSO
-- POSITIVO — o mesmo de `definir_disponibilidade` (202609101100): a linha é
-- decidida por `auth.uid()`, NUNCA por parâmetro, então não há empresa de
-- chamador a conferir. Está escrito para ninguém reauditar.
--
-- O UPDATE em `location_members` é o que já estava no banco (202609112100) —
-- só o registro da sessão é novo. Reescrever a regra de presença junto seria
-- mudança de comportamento disfarçada de acréscimo.

create or replace function public.touch_presence()
returns void
language plpgsql
security definer
set search_path to 'public', 'private'
as $fn$
declare
  v_user uuid := auth.uid();
  v_loc uuid;
  v_frio boolean;
  v_ausente boolean;
begin
  if v_user is null then
    return;
  end if;

  select m.location_id,
         (m.online_desde is null
          or m.last_seen_at is null
          or m.last_seen_at < now() - private.presenca_janela()),
         coalesce(m.disponibilidade, 'online') = 'ausente'
    into v_loc, v_frio, v_ausente
    from public.location_members m
   where m.user_id = v_user
   limit 1;

  if v_loc is null then
    return;
  end if;

  update public.location_members
     set last_seen_at = now(),
         online_desde = case
           when v_ausente then online_desde
           when v_frio then now()
           else online_desde
         end
   where user_id = v_user;

  -- ⚠️ **Ausente NÃO acumula tempo online**, e isso É a definição da coluna: ela
  -- mede o tempo em que a pessoa esteve DISPONÍVEL para receber lead, que é o
  -- que o seletor da barra superior promete. Contar o ausente faria "online" na
  -- tela de gestão significar coisa diferente de "online" na barra do CRM.
  if v_ausente then
    return;
  end if;

  if v_frio then
    insert into public.presence_sessions (location_id, user_id, inicio, fim)
    values (v_loc, v_user, now(), now());
    return;
  end if;

  update public.presence_sessions s
     set fim = now()
   where s.id = (
     select s2.id from public.presence_sessions s2
      where s2.user_id = v_user
      order by s2.inicio desc
      limit 1
   );

  -- Quem já estava online quando esta migração foi aplicada não tem sessão
  -- nenhuma. Sem isto, o tempo dele só começaria a contar depois de ele passar
  -- 15 minutos offline.
  if not found then
    insert into public.presence_sessions (location_id, user_id, inicio, fim)
    values (v_loc, v_user, now(), now());
  end if;
end;
$fn$;

revoke execute on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tempo online por atendente
-- ---------------------------------------------------------------------------

create or replace function public.tempo_online(p_location uuid, p_dias integer)
returns table (usuario uuid, minutos numeric, desde timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'private'
as $fn$
declare
  v_de timestamptz := now() - make_interval(days => greatest(p_dias, 1));
begin
  -- Checagem de empresa na PRIMEIRA linha (padrão 0049).
  if p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  select s.user_id,
         -- ⚠️ A sessão que COMEÇOU antes da janela entra recortada, não inteira:
         -- sem o `greatest`, quem estava online na virada do período levaria
         -- para dentro dele um tempo que é de fora.
         round(
           sum(extract(epoch from (least(s.fim, now()) - greatest(s.inicio, v_de)))) / 60.0
         )::numeric,
         -- Desde quando existe medida para esta pessoa. É o que deixa a tela
         -- dizer "medido desde 16/09" em vez de largar um zero sem explicação.
         min(s.inicio)
    from public.presence_sessions s
   where s.location_id = p_location
     and s.fim > v_de
   group by s.user_id;
end;
$fn$;

revoke execute on function public.tempo_online(uuid, integer) from public, anon;
grant execute on function public.tempo_online(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. `triagem_leads` passa a devolver o contato
-- ---------------------------------------------------------------------------
--
-- ⚠️ `drop` + `create` porque o tipo de retorno muda (3 colunas novas), e
-- `create or replace` é PROIBIDO nesse caso (42P13). Seguro antes do merge: o
-- código no ar lê por nome de campo e ignora coluna que não conhece.
--
-- ⚠️ O corpo é o que já estava no banco, com UMA mudança além das colunas: um
-- `order by` estável no fim. A consulta final não tinha ordem NENHUMA, e sem ela
-- a paginação da rota (`paginarRpc`) fica indefinida entre páginas.

drop function if exists public.triagem_leads(uuid, date, date, text);

create function public.triagem_leads(
  p_location uuid,
  p_de date,
  p_ate date,
  p_flow text default null
)
returns table (
  conversa uuid,
  dia date,
  hora smallint,
  resultado text,
  pontos integer,
  atendente uuid,
  finalizada boolean,
  ganha boolean,
  curso text,
  contato_id uuid,
  contato text,
  telefone text
)
language plpgsql
stable
security definer
set search_path to 'public', 'private'
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
     * linha na tabela, que é append-only de propósito.
     */
    select distinct on (d.conversation_id)
           d.conversation_id, d.resultado, d.pontos
      from public.bot_desfechos d
     where d.location_id = p_location
       and (p_flow is null or d.flow_key = p_flow)
       and d.conversation_id is not null
     order by d.conversation_id, d.created_at
  )
  select chegou.id,
         (chegou.created_at at time zone 'America/Sao_Paulo')::date,
         extract(hour from chegou.created_at at time zone 'America/Sao_Paulo')::smallint,
         primeiro.resultado,
         primeiro.pontos,
         chegou.assigned_to,
         (chegou.closed_at is not null),
         coalesce(op.status = 'won', false),
         op.course,
         chegou.contact_id,
         -- ⚠️ O nome vai JUNTO, e não é conveniência: a lista que o quadro abre
         -- precisa dizer de QUEM é cada lead, e resolver contato por contato no
         -- navegador seria uma consulta por linha numa lista de centenas.
         nullif(btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, '')), ''),
         ct.phone
    from chegou
    left join primeiro on primeiro.conversation_id = chegou.id
    left join public.contacts ct on ct.id = chegou.contact_id
    /*
     * ⚠️ `left join lateral ... limit 1` e não um `join` comum: um contato pode
     * ter vários cards, e sem o `limit` o mesmo lead viraria duas linhas —
     * quebrando a soma que faz as fatias do gráfico fecharem com "entraram".
     */
    left join lateral (
      select o.status, o.course
        from public.opportunities o
       where o.location_id = p_location
         and o.contact_id = chegou.contact_id
       order by o.created_at desc
       limit 1
    ) op on true
   -- Ordem ESTÁVEL: é o que torna a paginação da rota correta por construção.
   order by chegou.created_at desc, chegou.id;
end;
$fn$;

revoke execute on function public.triagem_leads(uuid, date, date, text) from public, anon;
grant execute on function public.triagem_leads(uuid, date, date, text) to authenticated;

commit;
