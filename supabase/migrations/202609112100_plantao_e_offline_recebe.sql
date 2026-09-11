-- ============================================================
-- Regra de distribuição do time de vendas: Offline ≠ Ausente, SLA que só corre
-- com o vendedor online, e Plantão de fim de semana.
--
-- Pedido do Gabriel (2026-09-11), em texto fechado. As três peças:
--
--   1) OFFLINE PARTICIPA DA DISTRIBUIÇÃO. O lead cai na caixa de "Pendentes" do
--      vendedor e continua sendo dele. Estar offline não faz perder a vez.
--   2) AUSENTE (botão da barra superior) é retirado da distribuição enquanto
--      durar, e o horário em que ficou ausente é registrado.
--   3) PLANTÃO: no período configurado, 100% dos leads novos vão para um
--      vendedor só; a distribuição normal fica suspensa.
--
-- 🔴 **O item 1 REVERTE a decisão de 2026-08-28**, e isso é deliberado: lá a
-- queixa era da SECRETARIA ("a fila de espera dos alunos ficou muito alta"
-- porque o lead caiu numa atendente que começava 12h). Aqui a operação é outra —
-- vendedor trabalha o lead dele e o cliente não está numa fila de atendimento.
-- Por isso a mudança é **POR SETOR**, em coluna, e não global: ligar em todo
-- mundo repetiria na Secretaria um problema já medido.
--
-- ⚠️ Esta migração é ADITIVA e não muda comportamento nenhum sozinha: as colunas
-- nascem com o default de hoje, e é a 202609112101 (aplicada DEPOIS do merge)
-- que liga as chaves em Vendas. Pode ser aplicada antes do merge.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Presença: desde quando está disponível, desde quando está ausente
-- ------------------------------------------------------------

/*
 * ⚠️ `online_desde` é o que permite o SLA "começar quando o vendedor voltar".
 * Sem ele, a única âncora é `conversations.atribuida_em`, que corre igual com a
 * pessoa dormindo — e foi essa conta que tomou a conversa da Beatriz um minuto
 * depois de entregá-la (202609101830).
 *
 * ⚠️ `ausente_desde` é o registro pedido no item 1 do texto ("o sistema deve
 * registrar o horário em que ficou ausente"). Guardado como carimbo, não como
 * log: a pergunta operacional é "há quanto tempo está ausente", e um histórico
 * de idas e vindas ninguém leria.
 */
alter table public.location_members
  add column if not exists online_desde timestamptz,
  add column if not exists ausente_desde timestamptz;

comment on column public.location_members.online_desde is
  'Início da presença ATUAL. Reiniciado quando a pessoa volta de offline ou de ausente. É a âncora do SLA de primeira resposta.';
comment on column public.location_members.ausente_desde is
  'Quando marcou "Ausente" na barra superior. Nulo quando disponível.';

/*
 * A janela de presença em UM lugar do SQL.
 *
 * ⚠️ **Tem de bater com `PRESENCE_MS` de `src/lib/presence.ts` (15 min).** São
 * dois mundos (o navegador decide quem aparece na tela, o banco decide quando o
 * SLA começa) e duas definições divergentes fariam a mesma pessoa ser online
 * para um e offline para o outro — o defeito exato que `lib/presence.ts` foi
 * criado para acabar em 09/09.
 */
create or replace function private.presenca_janela()
returns interval
language sql
immutable
as $$ select interval '15 minutes' $$;

/*
 * O ping de presença agora também abre a "temporada" de disponibilidade.
 *
 * ⚠️ Só reinicia `online_desde` quando a pessoa estava FRIA (sem sinal dentro da
 * janela) ou sem marca nenhuma. Reiniciar a cada ping zeraria o SLA a cada 30
 * segundos e a devolução nunca aconteceria — o oposto do pedido.
 *
 * ⚠️ E não toca em nada quando a pessoa está AUSENTE: ela continua no CRM
 * pingando (é o ponto do status), mas não está disponível, então a temporada não
 * começa aqui. Quem a inicia é `definir_disponibilidade('online')`.
 */
-- ⚠️ `npm run db:check` acusa esta e `definir_disponibilidade` por serem
-- `security definer` sem citar `user_locations`. É FALSO POSITIVO, e está escrito
-- aqui para ninguém reauditar: as duas decidem a linha por `auth.uid()` no
-- próprio `where`, o que já restringe a UMA linha — a da própria pessoa.
create or replace function public.touch_presence()
returns void
language sql
security definer
set search_path to 'public', 'private'
as $function$
  update public.location_members
     set last_seen_at = now(),
         online_desde = case
           when coalesce(disponibilidade, 'online') = 'ausente' then online_desde
           when online_desde is null
             or last_seen_at is null
             or last_seen_at < now() - private.presenca_janela() then now()
           else online_desde
         end
   where user_id = auth.uid();
$function$;

/*
 * Trocar o status carimba os dois lados.
 *
 * ⚠️ O corpo é o que já estava no banco (202609101100) mais os carimbos —
 * reescrever a lógica junto seria mudança de comportamento disfarçada de
 * acréscimo. A linha continua sendo decidida por `auth.uid()`, NUNCA por
 * parâmetro: recebendo o id de fora, qualquer autenticado tiraria um colega do
 * rodízio.
 */
create or replace function public.definir_disponibilidade(p_valor text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  n int;
begin
  if p_valor is null or p_valor not in ('online', 'ausente') then
    return false;
  end if;
  update public.location_members
     set disponibilidade = p_valor,
         ausente_desde = case when p_valor = 'ausente' then now() else null end,
         /*
          * Voltar de ausente começa uma temporada nova: o SLA dos leads que já
          * estavam com a pessoa passa a contar a partir de agora, que é
          * literalmente o item 3 do texto ("ao retornar de Ausente para Online,
          * volta a participar da distribuição" — sem compensação retroativa).
          */
         online_desde = case when p_valor = 'ausente' then null else now() end
   where user_id = auth.uid();
  get diagnostics n = row_count;
  -- Devolve se ESCREVEU. `update` que não acha linha não é erro no Postgres, e
  -- a tela diria "salvo" sem ter salvo.
  return n > 0;
end;
$function$;

revoke execute on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;
revoke execute on function public.definir_disponibilidade(text) from public, anon;
grant execute on function public.definir_disponibilidade(text) to authenticated;

/*
 * Retroativo: quem está presente agora ganha a temporada começando AGORA.
 *
 * ⚠️ Deixar nulo seria pior do que parece: `greatest(atribuida_em, null)` é
 * null, e a devolução leria "o SLA nunca começou" para a operação inteira —
 * desligando a devolução em silêncio até cada pessoa pingar de novo.
 */
update public.location_members
   set online_desde = now()
 where online_desde is null
   and coalesce(disponibilidade, 'online') <> 'ausente'
   and last_seen_at is not null
   and last_seen_at >= now() - private.presenca_janela();

update public.location_members
   set ausente_desde = coalesce(ausente_desde, now())
 where disponibilidade = 'ausente';

-- ------------------------------------------------------------
-- 2. O SLA por setor, e o offline que recebe
-- ------------------------------------------------------------

/*
 * ⚠️ **Por SETOR, sempre.** `rodizio_offline` já existe (0083) e é o item 1 do
 * pedido; o que falta é o SLA parar enquanto o dono está offline — senão o lead
 * que caiu em Pendentes seria devolvido 20 minutos depois, com o vendedor
 * dormindo, e "continua pertencendo a ele" viraria mentira.
 */
alter table public.departments
  add column if not exists sla_so_online boolean not null default false;

comment on column public.departments.sla_so_online is
  'O prazo de primeira resposta só corre enquanto o dono está online. Ligado, um lead em Pendentes não é devolvido até o vendedor voltar.';

-- ------------------------------------------------------------
-- 3. Plantão de fim de semana
-- ------------------------------------------------------------

create table if not exists public.plantoes (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  /*
   * ⚠️ `on delete cascade` no vendedor: plantão de quem saiu da empresa não é
   * histórico útil, é uma regra ativa apontando para ninguém — e ela
   * silenciosamente pararia toda a distribuição do setor.
   */
  user_id uuid not null references auth.users(id) on delete cascade,
  inicio timestamptz not null,
  fim timestamptz not null,
  /*
   * O que fazer se o plantonista estiver AUSENTE (item 7 do texto):
   *   'normal' — cai na distribuição normal (a sugestão do próprio pedido);
   *   'fila'   — o lead espera na fila do setor, visível a todos.
   */
  se_ausente text not null default 'normal' check (se_ausente in ('normal', 'fila')),
  cancelado_em timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint plantao_fim_depois_do_inicio check (fim > inicio)
);

create index if not exists plantoes_janela_idx
  on public.plantoes (department_id, inicio, fim)
  where cancelado_em is null;

alter table public.plantoes enable row level security;

/*
 * Ler é de todo membro: o time precisa ver que existe plantão ativo (o texto
 * pede o aviso visual). Escrever é só de admin — o plantão desvia 100% dos leads
 * novos do setor, e é decisão de quem organiza a escala.
 */
drop policy if exists "membros leem plantoes" on public.plantoes;
create policy "membros leem plantoes" on public.plantoes
  for select to authenticated
  using (location_id in (select private.user_locations()));

drop policy if exists "admin escreve plantoes" on public.plantoes;
create policy "admin escreve plantoes" on public.plantoes
  for all to authenticated
  using (location_id in (select private.user_locations()) and private.is_admin(location_id))
  with check (location_id in (select private.user_locations()) and private.is_admin(location_id));

/*
 * A conversa guarda por QUAL plantão ela veio.
 *
 * ⚠️ Coluna, e não o texto de `assign_reason`: o item 9 do pedido diz que os
 * leads do plantão **não podem alterar o equilíbrio da distribuição normal**, ou
 * seja a cota precisa ignorá-los — e decidir isso por texto livre é o erro que
 * este repositório já cometeu duas vezes (a redistribuição de 10/09 pegou 1/7
 * dos leads porque casava um `assign_reason` entre sete possíveis).
 *
 * `on delete set null`: apagar um plantão não pode apagar a conversa nem
 * reescrever o histórico de quem a recebeu.
 */
alter table public.conversations
  add column if not exists plantao_id uuid references public.plantoes(id) on delete set null;

create index if not exists conversations_plantao_idx
  on public.conversations (plantao_id) where plantao_id is not null;

/*
 * Criar plantão recusando SOBREPOSIÇÃO no mesmo setor.
 *
 * ⚠️ Dois plantões vigentes ao mesmo tempo não têm resposta certa — e o leitor
 * teria de escolher um por critério arbitrário, que é como nasceu o bug do
 * "canal ativo mais antigo" (202608312055). Recusar na criação é o único lugar
 * onde dá para dizer o motivo a quem está configurando.
 */
create or replace function public.criar_plantao(
  p_department uuid,
  p_user uuid,
  p_inicio timestamptz,
  p_fim timestamptz,
  p_se_ausente text default 'normal'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  loc uuid;
  novo uuid;
begin
  select d.location_id into loc from public.departments d where d.id = p_department;
  if loc is null then
    raise exception 'departamento não encontrado';
  end if;
  -- Checagem de empresa na PRIMEIRA coisa que roda (padrão 0049) + admin.
  if loc not in (select private.user_locations()) or not private.is_admin(loc) then
    raise exception 'sem permissão';
  end if;
  if p_fim <= p_inicio then
    raise exception 'o fim tem de ser depois do início';
  end if;
  if not exists (
    select 1 from public.location_members m
     where m.location_id = loc and m.user_id = p_user
  ) then
    raise exception 'o vendedor não é da empresa';
  end if;
  if exists (
    select 1 from public.plantoes pl
     where pl.department_id = p_department
       and pl.cancelado_em is null
       and pl.inicio < p_fim
       and pl.fim > p_inicio
  ) then
    raise exception 'já existe plantão neste período para o setor';
  end if;

  insert into public.plantoes (location_id, department_id, user_id, inicio, fim, se_ausente, created_by)
  values (loc, p_department, p_user, p_inicio, p_fim,
          coalesce(nullif(p_se_ausente, ''), 'normal'), auth.uid())
  returning id into novo;
  return novo;
end;
$function$;

revoke execute on function public.criar_plantao(uuid, uuid, timestamptz, timestamptz, text)
  from public, anon;
grant execute on function public.criar_plantao(uuid, uuid, timestamptz, timestamptz, text)
  to authenticated;

-- ------------------------------------------------------------
-- 4. `conversas_paradas` passa a devolver o estado do DONO
-- ------------------------------------------------------------

/*
 * Duas colunas novas, e a decisão de sempre: **a SQL responde fatos, o
 * TypeScript decide**. `devolvivel` é a camada testável e é lá que mora "e mesmo
 * assim, devo mexer?".
 *
 *   dono_online     — o responsável está presente e disponível AGORA?
 *   minutos_de_sla  — minutos ÚTEIS desde que o prazo começou a valer, que é
 *                     `greatest(atribuida_em, online_desde do dono)`.
 *
 * ⚠️ `minutos_de_sla` é sempre ≤ `minutos_com_atendente`, então o `where` (que
 * continua filtrando pelo segundo) fica mais FROUXO que a regra final — de
 * propósito: a linha chega ao TypeScript e é ele quem aperta. Ao contrário, a
 * SQL esconderia a conversa e nenhum teste pegaria.
 *
 * ⚠️ `drop` + `create` porque o tipo de retorno muda (11 → 13 colunas) e
 * `create or replace` é PROIBIDO nesse caso (42P13). O `drop` recria os
 * privilégios do zero, então o par revoke/grant no fim não é redundância.
 */
drop function if exists public.conversas_paradas(uuid, integer);

create function public.conversas_paradas(p_location uuid, p_limite_min integer default 15)
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
  ja_respondida boolean,
  minutos_com_atendente numeric,
  dono_online boolean,
  minutos_de_sla numeric
)
language plpgsql
stable
security definer
set search_path to 'public', 'private'
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
    select c.id, c.contact_id, c.assigned_to, c.assigned_by, c.channel_id,
           c.devolvida_em, c.atribuida_em
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
  ),
  /* O estado do DONO, no momento da consulta. */
  dono as (
    select lm.user_id,
           ( lm.last_seen_at is not null
             and lm.last_seen_at >= now() - private.presenca_janela()
             and coalesce(lm.disponibilidade, 'online') <> 'ausente' ) as online,
           lm.online_desde
      from public.location_members lm
     where lm.location_id = p_location
  )
  select a.id::uuid, a.contact_id::uuid, a.assigned_to::uuid, a.assigned_by::uuid,
         a.channel_id::uuid, a.devolvida_em::timestamptz, u.t_cliente::timestamptz,
         private.business_minutes(u.t_cliente, now())::numeric,
         b.passou::boolean,
         (u.t_humano is not null)::boolean,
         private.business_minutes(a.atribuida_em, now())::numeric,
         coalesce(d.online, false)::boolean,
         /*
          * ⚠️ `greatest` com um lado nulo devolve o outro no Postgres (não é
          * null como em `+`), então dono sem `online_desde` cai em
          * `atribuida_em` — o comportamento de hoje.
          */
         private.business_minutes(
           greatest(a.atribuida_em, d.online_desde), now()
         )::numeric
    from abertas a
    join ult u on u.conversation_id = a.id
    join bot b on b.id = a.id
    left join dono d on d.user_id = a.assigned_to
   where u.t_cliente is not null
     -- A BOLA ESTÁ COM A GENTE: ninguém respondeu depois da última do cliente.
     and (u.t_humano is null or u.t_humano < u.t_cliente)
     and private.business_minutes(u.t_cliente, now()) >= p_limite_min
     /*
      * 🔴 A JANELA DO ATENDENTE (202609101830): quem acabou de receber não pode
      * perder. Continua sendo o filtro da SQL — o SLA que depende da presença é
      * decidido no TypeScript, com a coluna nova.
      */
     and a.atribuida_em is not null
     and private.business_minutes(a.atribuida_em, now()) >= p_limite_min
   order by private.business_minutes(u.t_cliente, now()) desc;
end;
$function$;

/*
 * ⚠️ O par citando os TRÊS papéis: `pg_default_acl` neste projeto concede
 * EXECUTE de toda função nova a anon, authenticated e service_role
 * INDIVIDUALMENTE — `revoke ... from public, anon` deixaria o `authenticated`
 * executando (ver a nota da 202609081310).
 */
revoke execute on function public.conversas_paradas(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.conversas_paradas(uuid, integer) to service_role;
