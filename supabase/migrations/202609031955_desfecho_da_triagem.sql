-- Lito CRM — o relatório diário passa a servir QUALQUER fluxo de bot
--
-- Pedido do Gabriel (03/09/2026): "colocar nessa tela a opção de ver o fluxo da
-- secretaria também, mas dentro dos moldes do bot deles. A secretaria não tem
-- qualificado ou perdido por exemplo".
--
-- Ele está certo, e a diferença é estrutural: os dois bots não têm o mesmo tipo
-- de desfecho.
--
--   Triagem Comercial (`triagem`)             → nó `score`: quente | frio
--       (soma dos pesos >= 9).
--   Triagem Secretaria (`triagem-secretaria`) → nó `pede_assunto`: o cliente
--       escolhe entre "Documentos/Prova Sub", "Imersão Pres. MMA" e "Outros", e
--       cada ramo vai para um atendente fixo. NÃO existe nota, nem qualificado,
--       nem perdido.
--
-- ⚠️ **Por isso a 202609031728 estava estreita demais.** `bot_qualificacoes`
-- nasceu com `pontos`/`limiar` NOT NULL e `resultado` significando quente/frio.
-- Encaixar "docs" ali, com `pontos = 0` inventado, seria mentira gravada: em um
-- mês ninguém saberia se aquele zero é "não pontuou" ou "pontuou zero".
--
-- A tabela vira o **desfecho da triagem**, qualquer que seja o desfecho daquele
-- fluxo. `pontos`/`limiar` passam a ser opcionais (só fluxo com nó de pontuação
-- os tem) e entra `rotulo`, o texto que o cliente viu.
--
-- ⚠️ **Renomear agora é de graça e é a ÚLTIMA hora em que é**: a tabela tem 0
-- linhas (conferido — a Triagem Comercial ainda não está vinculada a nenhum
-- número). Daqui a uma semana o mesmo acerto custaria backfill.

-- ── 1. A tabela vira "desfecho", não "qualificação" ─────────────────────────
do $rename$
begin
  if to_regclass('public.bot_qualificacoes') is not null
     and to_regclass('public.bot_desfechos') is null then
    alter table public.bot_qualificacoes rename to bot_desfechos;
  end if;
end $rename$;

-- Idempotente também para quem aplicar num banco onde a 202609031728 não passou.
create table if not exists public.bot_desfechos (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references public.locations (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  contact_id      uuid references public.contacts (id) on delete set null,
  flow_key        text not null,
  pontos          int,
  limiar          int,
  resultado       text not null,
  respostas       jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

/*
 * ⚠️ `pontos`/`limiar` deixam de ser obrigatórios. Fluxo SEM nó de pontuação (a
 * secretaria) não tem número nenhum para gravar, e um `0` no lugar de NULL é
 * exatamente o dado que engana depois: "não pontuou" e "pontuou zero" viram a
 * mesma linha.
 */
alter table public.bot_desfechos alter column pontos drop not null;
alter table public.bot_desfechos alter column limiar drop not null;

/*
 * `rotulo` = o texto que o CLIENTE viu ("Documentos/Prova Sub"), guardado junto
 * do valor ("docs").
 *
 * ⚠️ Mesmo motivo de `limiar` existir: o fluxo é editável, e renomear a opção
 * amanhã reescreveria a leitura do relatório de ontem. Com o rótulo gravado, a
 * linha antiga continua dizendo o que a pessoa realmente escolheu.
 */
alter table public.bot_desfechos add column if not exists rotulo text;

alter table public.bot_desfechos enable row level security;
revoke all on public.bot_desfechos from anon;

drop policy if exists "membros leem qualificacoes" on public.bot_desfechos;
drop policy if exists "membros leem desfechos"     on public.bot_desfechos;
create policy "membros leem desfechos" on public.bot_desfechos
  for select to authenticated
  using (location_id in (select private.user_locations()));

/*
 * ⚠️ Segue SEM policy de INSERT para `authenticated`: quem grava é o webhook, com
 * a service role. É a única coisa aqui que alguém teria interesse em falsear —
 * o próprio número de leads qualificados.
 */

drop index if exists public.bot_qualificacoes_dia_idx;
create index if not exists bot_desfechos_dia_idx
  on public.bot_desfechos (location_id, flow_key, created_at desc);

-- ── 2. O fluxo da secretaria marca qual nó é o desfecho ─────────────────────
/*
 * ⚠️ **O fluxo que VALE é o do banco.** `getFlow` lê `bot_flows.definition` e só
 * cai no fluxo embutido em código quando não encontra a linha — marcar a flag só
 * no TypeScript não teria efeito nenhum em produção. Foi a lição da
 * 202609011230 (validação de e-mail).
 *
 * `registraDesfecho` no nó `pede_assunto`: quando o cliente escolhe uma opção, o
 * motor grava a escolha em `bot_desfechos`. É o análogo do nó `score`, que já
 * grava — em cada fluxo, o nó que DECIDE o desfecho é quem registra.
 */
update public.bot_flows
   set definition = jsonb_set(
         definition,
         '{nodes,pede_assunto,registraDesfecho}',
         'true'::jsonb,
         true
       ),
       updated_at = now()
 where key = 'triagem-secretaria'
   and definition #> '{nodes,pede_assunto}' is not null
   and coalesce(definition #>> '{nodes,pede_assunto,registraDesfecho}', 'false') <> 'true';

-- ── 3. Backfill do que ainda dá para recuperar de `bot_sessions` ────────────
/*
 * ⚠️ `bot_sessions` é ESTADO ATUAL e é apagada quando a conversa finalizada
 * reabre — é justamente a razão de `bot_desfechos` existir. Mas o que AINDA está
 * lá é história real: 214 sessões com `assunto` escolhido, desde 18/08. Sem o
 * backfill, a tela da secretaria nasceria vazia num fluxo que roda há semanas.
 *
 * ⚠️ **É reconhecidamente INCOMPLETO** (o que já foi apagado não volta), e por
 * isso a tela avisa que o histórico anterior a hoje é parcial. Backfill parcial
 * anunciado é melhor que tela vazia; backfill parcial silencioso seria pior que
 * as duas coisas.
 *
 * ⚠️ A data é a de CRIAÇÃO da sessão, não a da escolha: `updated_at` acompanha a
 * conversa inteira e empurraria o lead para o dia da última mensagem. Para
 * "quantos entraram naquele dia", a criação é o carimbo certo.
 */
insert into public.bot_desfechos
  (location_id, conversation_id, contact_id, flow_key, resultado, rotulo, respostas, created_at)
select s.location_id,
       s.conversation_id,
       s.contact_id,
       s.flow_key,
       s.vars->>'assunto',
       -- Rótulo pelo valor, com o texto que o fluxo mostrava nessa época.
       case s.vars->>'assunto'
         when 'docs'    then 'Documentos/Prova Sub'
         when 'imersao' then 'Imersão Pres. MMA'
         when 'outros'  then 'Outros'
         else s.vars->>'assunto'
       end,
       jsonb_build_object('assunto', s.vars->>'assunto', '_origem', 'backfill bot_sessions'),
       s.created_at
  from public.bot_sessions s
 where s.flow_key = 'triagem-secretaria'
   and s.vars ? 'assunto'
   and coalesce(s.vars->>'assunto', '') <> ''
   -- Reexecutável: não duplica o que já entrou.
   and not exists (
     select 1 from public.bot_desfechos d
      where d.conversation_id = s.conversation_id
        and d.flow_key = s.flow_key
   );

-- ── 4. O relatório, agora agnóstico de fluxo ────────────────────────────────
/*
 * ⚠️ Substitui `relatorio_leads_diario`, que devolvia COLUNAS FIXAS
 * (`qualificados`, `frios`). Colunas fixas só servem a um fluxo: a secretaria
 * tem três assuntos, e o próximo bot terá outra coisa. O desfecho sai em
 * **jsonb** (`{"docs": 4, "outros": 9}`) e quem rotula é a tela, que é onde o
 * vocabulário de cada bot já mora.
 *
 * Duas funções com o mesmo propósito divergiriam na primeira mudança, então a
 * antiga é removida — a tela é a única consumidora e sobe junto.
 */
drop function if exists public.relatorio_leads_diario(uuid, date, date, text);

create or replace function public.relatorio_triagem_diaria(
  p_location uuid,
  p_de date,
  p_ate date,
  /** Fluxo a medir (`triagem`, `triagem-secretaria`). NULL = todos. */
  p_flow text default null
)
returns table (
  dia date,
  entraram bigint,
  concluiram bigint,
  desfechos jsonb,
  pontos_medio numeric
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
  with dias as (
    -- ⚠️ A série de dias vem por FORA: sem ela, dia sem lead nenhum não
    -- apareceria e o gráfico encurtaria em vez de mostrar zero.
    select d::date as dia
      from generate_series(p_de, p_ate, interval '1 day') d
  ),
  canais as (
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
    select cv.id,
           date_trunc('day', cv.created_at at time zone 'America/Sao_Paulo')::date as dia
      from public.conversations cv
     where cv.location_id = p_location
       and cv.channel_id in (select id from canais)
       and (cv.created_at at time zone 'America/Sao_Paulo')::date between p_de and p_ate
       and exists (
         select 1 from public.messages m
          where m.conversation_id = cv.id and m.direction = 'in'
       )
  ),
  entrada as (
    select chegou.dia, count(*) as n from chegou group by 1
  ),
  primeiro as (
    /*
     * ⚠️ **Uma conversa = um lead = UM desfecho**, e vale o PRIMEIRO. A conversa
     * que reabre passa pelo bot de novo (o webhook zera a sessão) e gera outra
     * linha na tabela, que é append-only de propósito. Contar as duas quebraria
     * a partição: `entraram` conta a conversa UMA vez, porque ela foi criada uma
     * vez só.
     */
    select distinct on (d.conversation_id)
           d.conversation_id, d.resultado, d.pontos
      from public.bot_desfechos d
     where d.location_id = p_location
       and (p_flow is null or d.flow_key = p_flow)
       -- Conversa excluída (`on delete set null`) não tem dia de entrada a que
       -- ser atribuída, e também não está em `entraram`: fora, para a soma fechar.
       and d.conversation_id is not null
     order by d.conversation_id, d.created_at
  ),
  desf as (
    /*
     * ⚠️ **O desfecho é contado no dia em que a conversa ENTROU**, não no dia em
     * que o bot classificou. Foi um defeito real, visto no primeiro teste com
     * dado de produção: 03/09 dava "entraram 21, concluíram 24" — o cliente
     * escreveu num dia e foi triado no outro (ou a conversa reabriu semanas
     * depois), e um empilhado com fatia negativa é gráfico quebrado.
     *
     * Atribuindo à entrada, as fatias PARTICIONAM quem entrou por construção, e
     * a pergunta que a tela responde passa a ser a certa: "dos leads que
     * chegaram naquele dia, o que aconteceu com eles?".
     */
    select chegou.dia, primeiro.resultado,
           count(*) as n,
           avg(primeiro.pontos)::numeric as pontos
      from chegou
      join primeiro on primeiro.conversation_id = chegou.id
     group by 1, 2
  ),
  por_dia as (
    select desf.dia,
           sum(desf.n) as total,
           /*
            * O desfecho sai em jsonb (`{"docs": 4, "outros": 9}`) e não em
            * colunas fixas: colunas fixas só servem a um fluxo. Quem rotula é a
            * tela, que é onde o vocabulário de cada bot já mora.
            */
           jsonb_object_agg(desf.resultado, desf.n) as mapa,
           -- Média ponderada pelo volume de cada desfecho. O `filter` existe
           -- porque fluxo sem pontuação não tem número para entrar na conta — e
           -- aí a média sai NULL, não zero.
           (sum(desf.pontos * desf.n) filter (where desf.pontos is not null)
             / nullif(sum(desf.n) filter (where desf.pontos is not null), 0))::numeric as pontos
      from desf
     group by desf.dia
  )
  select dias.dia,
         coalesce(entrada.n, 0)::bigint,
         coalesce(por_dia.total, 0)::bigint,
         coalesce(por_dia.mapa, '{}'::jsonb),
         /*
          * ⚠️ TODAS as colunas convertidas explicitamente. O `42804` ("structure
          * of query does not match function result type") custou uma rodada em
          * 03/09 e NÃO diz qual coluna divergiu — `avg`/`percentile_cont` sobre
          * numeric não devolvem numeric. Converter é grátis e troca um erro
          * opaco de execução por um acerto de leitura.
          */
         round(por_dia.pontos, 1)::numeric
    from dias
    left join entrada on entrada.dia = dias.dia
    left join por_dia on por_dia.dia = dias.dia
   order by dias.dia desc;
end;
$fn$;

-- ⚠️ O par obrigatório: `create function` já concede EXECUTE a PUBLIC, e
-- `create or replace` NÃO reseta grants (o bug da 0080).
revoke execute on function public.relatorio_triagem_diaria(uuid, date, date, text) from public, anon;
grant  execute on function public.relatorio_triagem_diaria(uuid, date, date, text) to authenticated;

-- O PostgREST cacheia a assinatura das funções; sem o aviso a rota chamaria a
-- antiga, que acabou de ser removida.
notify pgrst, 'reload schema';
