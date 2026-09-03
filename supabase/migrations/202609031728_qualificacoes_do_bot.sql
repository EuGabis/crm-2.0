-- Lito CRM — registro PERMANENTE das qualificações do bot, e o relatório diário
--
-- Pedido do Gabriel (03/09/2026): "todos os dias eu preciso saber quantos leads
-- entraram e desses, quantos foram qualificados".
--
-- A régua é a dele: o nó `score` do fluxo **Triagem Comercial** (`key = 'triagem'`)
-- soma os pesos de `objetivo` e `conhece_lito` e, com **soma >= 9**, marca
-- `qualificacao = 'quente'`; abaixo, `'frio'`.
--
-- ⚠️ **Por que uma TABELA nova e não ler `bot_sessions`.** `bot_sessions` é
-- ESTADO ATUAL, não histórico: quando uma conversa finalizada é reaberta, o
-- webhook faz `delete from bot_sessions where conversation_id = ...` (route.ts,
-- "zera a sessão para o bot iniciar de novo"). Medido: 40 conversas voltaram para
-- o bot em 7 dias.
--
-- Um relatório diário lido de lá **mudaria o passado**: o lead qualificado na
-- segunda-feira desapareceria da segunda-feira ao ser reaberto na quarta. Número
-- que muda para trás é pior do que número nenhum, porque ninguém descobre que
-- mudou — só estranha que não fecha com o que viu ontem.
--
-- ⚠️ E a soma NÃO era guardada: o motor fazia
-- `vars[node.var] = sum >= threshold ? hot : cold` e descartava `sum`. Sem ela
-- não há como decidir se o limiar de 9 é o certo — um "frio" com 8 pontos e um
-- com 0 são coisas muito diferentes. A tabela guarda o número.

create table if not exists public.bot_qualificacoes (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references public.locations (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  contact_id      uuid references public.contacts (id) on delete set null,
  flow_key        text not null,
  /** Soma dos pesos. É o que permite mexer no limiar com dado na mão. */
  pontos          int  not null,
  /** Limiar em vigor no momento — muda com o tempo, e a linha antiga tem de
      continuar interpretável. */
  limiar          int  not null,
  /** 'quente' | 'frio' (os `hotValue`/`coldValue` do nó). */
  resultado       text not null,
  /** As respostas que geraram a soma, para auditar sem depender da sessão. */
  respostas       jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

/*
 * ⚠️ `on delete set null` em `conversation_id`/`contact_id`, e NÃO cascade:
 * excluir uma conversa não pode apagar o histórico de qualificação — era o
 * número do dia, e o dia já passou. A linha sobrevive sem o vínculo.
 */

-- O relatório é sempre "por dia, desta empresa": o índice segue isso.
create index if not exists bot_qualificacoes_dia_idx
  on public.bot_qualificacoes (location_id, created_at desc);

/*
 * ⚠️ Uma qualificação por CONVERSA e por passagem: se o cliente reabre e passa
 * pelo bot de novo, é um lead novo naquele dia — e isso é correto, porque ele
 * respondeu de novo. Índice único NÃO é aplicado aqui de propósito; o que
 * evita duplicata na MESMA passagem é o nó rodar uma vez por fluxo.
 */

alter table public.bot_qualificacoes enable row level security;
revoke all on public.bot_qualificacoes from anon;

drop policy if exists "membros leem qualificacoes" on public.bot_qualificacoes;
create policy "membros leem qualificacoes" on public.bot_qualificacoes
  for select to authenticated
  using (location_id in (select private.user_locations()));

/*
 * ⚠️ Ninguém escreve pela API: quem grava é o webhook, com a service role. Sem
 * policy de INSERT para `authenticated`, um usuário não consegue inflar o próprio
 * número de leads qualificados — que é a única coisa que alguém teria interesse
 * em falsear numa tabela de métrica.
 */

-- ── O relatório diário ──────────────────────────────────────────────────────
create or replace function public.relatorio_leads_diario(
  p_location uuid,
  p_de date,
  p_ate date,
  /** Fluxo a medir. NULL = todos. */
  p_flow text default null
)
returns table (
  dia date,
  entraram bigint,
  qualificados bigint,
  frios bigint,
  sem_classificacao bigint,
  pontos_medio numeric
)
language plpgsql
stable
security definer
set search_path = public, private
as $$
begin
  -- Checagem de empresa na PRIMEIRA linha (padrão 0049).
  if p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  with dias as (
    -- ⚠️ A série de dias vem PRIMEIRO e por fora: sem ela, dia sem lead nenhum
    -- simplesmente não apareceria, e o gráfico encurtaria em vez de mostrar zero.
    select d::date as dia
      from generate_series(p_de, p_ate, interval '1 day') d
  ),
  -- Canais que rodam o fluxo pedido. É o que define "entrou": conversa criada
  -- num número que tem esse bot.
  canais as (
    select ch.id
      from public.whatsapp_channels ch
     where ch.location_id = p_location
       and (p_flow is null or ch.bot_flow = p_flow)
  ),
  entrada as (
    /*
     * ⚠️ "Entraram" sai de `conversations.created_at`, NÃO de `bot_sessions`.
     * Sessão é apagada quando a conversa reabre (ver o topo desta migração), e
     * contar de lá faria o passado encolher. Conversa criada é estável.
     *
     * E exige mensagem de ENTRADA: conversa aberta pelo CRM ("Nova conversa")
     * não é lead que chegou.
     */
    select date_trunc('day', cv.created_at at time zone 'America/Sao_Paulo')::date as dia,
           count(*) as n
      from public.conversations cv
     where cv.location_id = p_location
       and cv.channel_id in (select id from canais)
       and (cv.created_at at time zone 'America/Sao_Paulo')::date between p_de and p_ate
       and exists (
         select 1 from public.messages m
          where m.conversation_id = cv.id and m.direction = 'in'
       )
     group by 1
  ),
  qual as (
    select date_trunc('day', q.created_at at time zone 'America/Sao_Paulo')::date as dia,
           count(*) filter (where q.resultado = 'quente') as quentes,
           count(*) filter (where q.resultado = 'frio')   as frios,
           avg(q.pontos)::numeric as pontos
      from public.bot_qualificacoes q
     where q.location_id = p_location
       and (p_flow is null or q.flow_key = p_flow)
       and (q.created_at at time zone 'America/Sao_Paulo')::date between p_de and p_ate
     group by 1
  )
  select dias.dia,
         coalesce(entrada.n, 0)::bigint,
         coalesce(qual.quentes, 0)::bigint,
         coalesce(qual.frios, 0)::bigint,
         /*
          * ⚠️ `greatest(..., 0)`: se alguém reabrir e requalificar, as
          * qualificações do dia podem passar as entradas do dia, e um negativo
          * na tela pareceria defeito. O piso em zero é honesto — a informação
          * "sobrou qualificação" não se perde, ela aparece na soma das colunas.
          */
         greatest(coalesce(entrada.n, 0) - coalesce(qual.quentes, 0) - coalesce(qual.frios, 0), 0)::bigint,
         round(qual.pontos, 1)
    from dias
    left join entrada on entrada.dia = dias.dia
    left join qual    on qual.dia    = dias.dia
   order by dias.dia desc;
end;
$$;

-- ⚠️ O par obrigatório: `create function` já concede EXECUTE a PUBLIC, e
-- `create or replace` NÃO reseta grants (o bug da 0080).
revoke execute on function public.relatorio_leads_diario(uuid, date, date, text) from public, anon;
grant  execute on function public.relatorio_leads_diario(uuid, date, date, text) to authenticated;

notify pgrst, 'reload schema';
