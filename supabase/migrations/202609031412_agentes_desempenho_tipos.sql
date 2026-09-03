-- Lito CRM — conserta o 42804 de `agentes_desempenho`
--
-- A 202609031359 subiu com erro de TIPO e a aba respondeu
-- **"42804 · structure of query does not match function result type"**.
--
-- ⚠️ **A causa: `percentile_cont` sobre `numeric` devolve `double precision`.**
-- Não existe variante numérica da função — o `order by numeric` é convertido
-- implicitamente para `double precision`, e o resultado sai nesse tipo. Eu
-- declarei `mediana_resposta_min numeric` no `returns table`, e o Postgres
-- recusou a linha inteira.
--
-- Medido antes de corrigir, para não trocar um palpite por outro:
--
--   select pg_typeof(percentile_cont(0.5) within group (order by x))
--     from (values (1::numeric)) t(x);   -->  double precision
--
-- ⚠️ **`returns table` não converte nada por conta própria**, e o erro não diz
-- QUAL coluna divergiu — só que a estrutura não bate. Daí a lição desta
-- migração: **em `returns table`, converta TODAS as colunas explicitamente.**
-- Custa nada, e transforma um erro de execução opaco num acerto de leitura.
--
-- Só a assinatura de retorno e os casts mudam; a lógica é idêntica à 202609031359.

create or replace function public.agentes_desempenho(
  p_location uuid,
  p_dias int default 30,
  p_meta_min int default 15
)
returns table (
  user_id uuid,
  nome text,
  papel text,
  departamento text,
  conversas_atribuidas bigint,
  /*
   * MEDIANA da espera ÚTIL até a primeira resposta HUMANA, em minutos.
   *
   * ⚠️ Continua `numeric` no contrato — é o tipo certo para o consumidor, e o
   * corpo converte. Declarar `double precision` aqui vazaria um detalhe do
   * `percentile_cont` para dentro da API.
   *
   * ⚠️ Por que mediana e não média: o AGENTS.md chama a métrica antiga desta aba
   * de "ficção em quatro camadas" — descartava o que passava de 24h, usava média
   * (675 min contra mediana de 14 neste banco), ignorava quem nunca foi
   * respondido e media tempo corrido. Vem de `sla_conversations` (0079), que
   * resolve as quatro.
   */
  mediana_resposta_min numeric,
  respostas_medidas bigint,
  -- Vai junto de propósito: sem isto a mediana premia quem abandona a conversa,
  -- porque quem nunca respondeu não entra em métrica alguma.
  nao_respondidas bigint,
  templates_30d bigint,
  mensagens_enviadas bigint,
  ganhos bigint,
  perdidos bigint,
  receita_ganha numeric
)
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_de timestamptz := now() - make_interval(days => greatest(1, least(p_dias, 365)));
begin
  -- Checagem de empresa na PRIMEIRA linha (padrão 0049). `sla_conversations`
  -- repete a dela, mas depender só disso deixaria as outras CTEs abertas.
  if p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  with sla as (
    select s.assigned_to, s.espera_util_min, s.respondida
      from public.sla_conversations(p_location, v_de, now(), p_meta_min) s
  ),
  msg as (
    select m.created_by,
           count(*) as enviadas,
           count(*) filter (where m.template_name is not null) as templates
      from public.messages m
     where m.location_id = p_location
       and m.direction = 'out'
       and not m.internal
       and m.created_at >= v_de
       and m.created_by is not null
     group by m.created_by
  ),
  opp as (
    /*
     * ⚠️ Oportunidade NÃO é filtrada por data. Ganho e receita do vendedor são o
     * acumulado dele; recortar em 30 dias mostraria "0 ganhos" para quem fechou
     * no mês passado e ninguém entenderia o zero.
     */
    select o.owner_id,
           count(*) filter (where o.status = 'won')  as ganhos,
           count(*) filter (where o.status = 'lost') as perdidos,
           coalesce(sum(o.value) filter (where o.status = 'won'), 0) as receita
      from public.opportunities o
     where o.location_id = p_location
     group by o.owner_id
  )
  -- ⚠️ TODA coluna com cast explícito — ver o aviso no topo.
  select lm.user_id::uuid,
         coalesce(pr.name, 'Usuário')::text,
         lm.role::text,
         d.name::text,
         count(sla.assigned_to)::bigint,
         -- Aqui está o conserto: `percentile_cont` sai como double precision.
         (percentile_cont(0.5) within group (order by sla.espera_util_min)
           filter (where sla.respondida))::numeric,
         (count(*) filter (where sla.respondida))::bigint,
         (count(*) filter (where sla.assigned_to is not null and not sla.respondida))::bigint,
         coalesce(max(msg.templates), 0)::bigint,
         coalesce(max(msg.enviadas), 0)::bigint,
         coalesce(max(opp.ganhos), 0)::bigint,
         coalesce(max(opp.perdidos), 0)::bigint,
         coalesce(max(opp.receita), 0)::numeric
    from public.location_members lm
    left join public.profiles pr on pr.id = lm.user_id
    left join public.departments d on d.id = lm.department_id
    -- LEFT JOIN em todas: atendente sem conversa, sem mensagem ou sem lead
    -- continua aparecendo com zero. "Não aparece" e "não atendeu" não podem
    -- ficar indistinguíveis.
    left join sla on sla.assigned_to = lm.user_id
    left join msg on msg.created_by = lm.user_id
    left join opp on opp.owner_id = lm.user_id
   where lm.location_id = p_location
   group by lm.user_id, pr.name, lm.role, d.name;
end;
$$;

-- ⚠️ `create or replace` NÃO reseta grants, então os da 202609031359 continuam
-- valendo. O par vai de novo porque repetir é inofensivo e omitir é como o
-- defeito da 0080 nasce.
revoke execute on function public.agentes_desempenho(uuid, int, int) from public, anon;
grant  execute on function public.agentes_desempenho(uuid, int, int) to authenticated;

-- O PostgREST cacheia a assinatura das funções; trocar o tipo de retorno sem
-- avisar deixa o cache descrevendo a versão antiga.
notify pgrst, 'reload schema';
