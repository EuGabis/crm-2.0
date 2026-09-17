-- Tempo online POR DIA + o Log do bot recortado por DIA DE CALENDÁRIO.
--
-- Pedido do Gabriel (2026-09-17):
--   1. *"na tela Agentes que mostra o tempo online, tem que ter o filtro para
--      ver quanto tempo ele ficou online em cada dia"*;
--   2. *"a tela de Log do bot está confusa... no filtro da data de hoje mostra
--      que o Alberto está com 154, Paulo com 157, está estranho"*.
--
-- 🔴 **O 2 é um defeito medido, não impressão.** `log_do_bot(location, dias)`
-- recorta por `now() - N dias` — **24 HORAS CORRIDAS**, não o dia. Conferido em
-- produção com `dias = 1`: a atribuição mais antiga da lista era de ONTEM às
-- 10:05. Ou seja "hoje" mostrava ontem-de-manhã em diante, e por isso 152/157
-- quando o dia real tinha ~60 por pessoa.
--
-- ⚠️ E havia um segundo motivo para o número não fazer sentido: o filtro era
-- `created_at >= desde OR atribuida_em >= desde`, misturando DOIS eixos. Um lead
-- que CHEGOU há três semanas e foi atribuído hoje entrava; um que chegou hoje e
-- ainda está na fila também. Somados por atendente, os dois viram um número que
-- não responde nenhuma pergunta inteira.
--
-- Aplicável ANTES do merge: `p_dias` continua funcionando (é o default), então o
-- código no ar não percebe os parâmetros novos.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tempo online por DIA
-- ---------------------------------------------------------------------------
--
-- ⚠️ Função NOVA, e `tempo_online` (202609161400) CONTINUA existindo: ela
-- responde o total do período, que é o que a coluna da tabela mostra. Duas
-- perguntas diferentes — "quanto no total" e "quanto em cada dia" — e recalcular
-- o total somando os dias no navegador daria margem a divergir do número ao
-- lado.

create or replace function public.tempo_online_por_dia(
  p_location uuid,
  p_de date,
  p_ate date
)
returns table (usuario uuid, dia date, minutos numeric)
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
  /*
   * ⚠️ **A sessão é PARTIDA por dia, não atribuída ao dia em que começou.** Quem
   * entra às 22h e fica até 1h da manhã tem duas linhas — 2h num dia e 1h no
   * outro. Jogar tudo no dia de início faria a coluna de segunda mostrar
   * trabalho de terça, e a pergunta ("quanto ele ficou online na quarta?")
   * deixaria de ter resposta.
   *
   * O corte é no fuso de SÃO PAULO, como todo o resto do CRM: a Vercel roda em
   * UTC, e às 21h de Brasília o servidor já está no dia seguinte.
   */
  with dias as (
    select generate_series(p_de, p_ate, interval '1 day')::date as d
  ),
  limites as (
    select d.d,
           (d.d::timestamp at time zone 'America/Sao_Paulo') as ini,
           ((d.d + 1)::timestamp at time zone 'America/Sao_Paulo') as fim
      from dias d
  )
  select s.user_id,
         l.d,
         round(
           sum(
             extract(epoch from (least(s.fim, l.fim, now()) - greatest(s.inicio, l.ini)))
           ) / 60.0
         )::numeric
    from public.presence_sessions s
    join limites l
      on s.inicio < l.fim
     and s.fim > l.ini
   where s.location_id = p_location
   group by s.user_id, l.d
  having sum(
           extract(epoch from (least(s.fim, l.fim, now()) - greatest(s.inicio, l.ini)))
         ) > 0;
end;
$fn$;

revoke execute on function public.tempo_online_por_dia(uuid, date, date) from public, anon;
grant execute on function public.tempo_online_por_dia(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Log do bot: período por DATA, e um eixo só
-- ---------------------------------------------------------------------------
--
-- ⚠️ `drop` + `create` porque a lista de parâmetros muda. `p_dias` fica com
-- default e continua sendo o caminho do código antigo, então a produção não
-- percebe nada entre a migração e o merge.

-- ⚠️ As DUAS assinaturas caem: a antiga (o estado esperado) e a NOVA. Sem a
-- segunda linha, reexecutar o arquivo depois de a função já existir na forma
-- nova responde `42723 function already exists with same argument types` — e
-- toda migração deste projeto tem de poder rodar duas vezes.
drop function if exists public.log_do_bot(uuid, integer);
drop function if exists public.log_do_bot(uuid, integer, date, date);

create function public.log_do_bot(
  p_location uuid,
  p_dias integer default 1,
  p_de date default null,
  p_ate date default null
)
returns table (
  conversation_id uuid,
  contato text,
  telefone text,
  chegou_em timestamptz,
  atribuida_em timestamptz,
  atendente_id uuid,
  atendente text,
  motivo text,
  fluxo text,
  canal text,
  desfecho text,
  na_fila boolean
)
language plpgsql
stable
security definer
set search_path to 'public', 'private'
as $fn$
declare
  v_ini timestamptz;
  v_fim timestamptz;
begin
  /*
   * ⚠️ A checagem de empresa é a PRIMEIRA linha do corpo (padrão 0049) e fica
   * FORA da consulta: escrita como CTE no `from`, ela vira um join opaco e o
   * planner desiste dos índices (medido na 0078: 153 ms contra 81 ms).
   */
  if p_location is not distinct from null
     or p_location not in (select private.user_locations()) then
    return;
  end if;

  /*
   * 🔴 **Período por DATA, no fuso de São Paulo.** `now() - N dias` é 24 horas
   * corridas: com "hoje" a lista começava ONTEM no mesmo horário, e foi isso que
   * fez o Log mostrar 152/157 num dia de ~60 por pessoa. Quem escolhe "hoje"
   * quer o dia — não as últimas 24 horas.
   */
  if p_de is not null and p_ate is not null then
    v_ini := (p_de::timestamp at time zone 'America/Sao_Paulo');
    v_fim := ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo');
  else
    -- Compatibilidade com o código anterior ao merge.
    v_ini := now() - make_interval(days => greatest(coalesce(p_dias, 1), 1));
    v_fim := now() + interval '1 day';
  end if;

  return query
  with base as (
    select cv.id,
           cv.contact_id,
           cv.assigned_to,
           cv.assign_reason,
           cv.atribuida_em,
           cv.created_at,
           cv.awaiting_distribution,
           cv.channel_id
      from public.conversations cv
     where cv.location_id = p_location
       and cv.channel_id is not null
       /*
        * 🔴 **UM eixo por linha, e ele depende do que a linha É.**
        *
        * A versão anterior fazia `created_at >= desde OR atribuida_em >= desde`
        * — os dois eixos somados. Um lead que chegou há três semanas e foi
        * atribuído hoje entrava pelo segundo; um que chegou hoje e ainda espera
        * entrava pelo primeiro. Contados juntos por atendente, o número não
        * respondia nem "quantos ele recebeu no período" nem "quantos chegaram".
        *
        * Agora: quem TEM dono entra pela ATRIBUIÇÃO (é o que a coluna do
        * atendente conta); quem está na FILA entra pela CHEGADA — ela não tem
        * carimbo de atribuição, e esconder a fila tiraria justamente o número
        * que diz se a divisão está segurando ou despejando.
        */
       and (
         case
           when cv.assigned_to is not null
             then cv.atribuida_em >= v_ini and cv.atribuida_em < v_fim
           else cv.created_at >= v_ini and cv.created_at < v_fim
         end
       )
  )
  select
    b.id::uuid,
    /*
     * ⚠️ `nullif(btrim(...), '')` e não `coalesce` direto: contato sem sobrenome
     * gera " " (um espaço), que na tela vira uma linha com nome em branco e
     * parece dado faltando.
     */
    coalesce(
      nullif(btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, '')), ''),
      'Sem nome'
    )::text,
    coalesce(ct.phone, '')::text,
    /*
     * "Horário" do lead = quando o CLIENTE escreveu a primeira vez. O
     * `created_at` da conversa é a rede: conversa aberta pelo CRM não tem
     * mensagem de entrada, e ali os dois coincidem.
     */
    coalesce(
      (select min(m.created_at) from public.messages m
        where m.conversation_id = b.id and m.direction = 'in'),
      b.created_at
    )::timestamptz,
    b.atribuida_em::timestamptz,
    b.assigned_to::uuid,
    coalesce(pf.name, '')::text,
    /*
     * 🔴 O MOTIVO é a coluna que os dois incidentes pediram. Ele diz QUAL dos
     * caminhos atribuiu — "rodízio do bot", "varredura da fila do setor",
     * "distribuição pelo relatório (rodízio)", "escolha do administrador",
     * "devolvida: cliente esperava N min", "transferida por outra pessoa".
     */
    coalesce(b.assign_reason, '')::text,
    -- Nome do fluxo quando existe; senão a chave configurada no número.
    coalesce(bf.name, wc.bot_flow, '')::text,
    -- ⚠️ As colunas são `name`/`phone_e164` (0022), não label/phone_number.
    coalesce(nullif(wc.name, ''), nullif(wc.phone_e164, ''), '')::text,
    coalesce(bd.rotulo, bd.resultado, '')::text,
    (b.assigned_to is null)::boolean
  from base b
  left join public.contacts ct on ct.id = b.contact_id
  left join public.profiles pf on pf.id = b.assigned_to
  left join public.whatsapp_channels wc on wc.id = b.channel_id
  left join public.bot_flows bf
         on bf.location_id = p_location and bf.key = wc.bot_flow
  /*
   * ⚠️ `lateral ... limit 1`: `bot_desfechos` é append-only e a conversa que
   * reabre passa pela triagem de novo. Sem o corte, um lead com duas triagens
   * viraria DUAS linhas e a soma por atendente deixaria de bater com a
   * realidade — o defeito que a 202609041015 já teve no relatório de triagem.
   */
  left join lateral (
    select d.resultado, d.rotulo
      from public.bot_desfechos d
     where d.conversation_id = b.id
     order by d.created_at desc
     limit 1
  ) bd on true
  -- Ordem ESTÁVEL: é o que torna a paginação de `paginarRpc` correta. Sem o
  -- desempate por id, duas páginas repetem uma linha e PULAM outra.
  order by b.atribuida_em desc nulls last, b.created_at desc, b.id;
end;
$fn$;

revoke execute on function public.log_do_bot(uuid, integer, date, date) from public, anon;
grant execute on function public.log_do_bot(uuid, integer, date, date) to authenticated;

notify pgrst, 'reload schema';

commit;
