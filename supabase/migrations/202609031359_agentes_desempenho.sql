-- Lito CRM — "Desempenho por agente" agregado no POSTGRES
--
-- Relato do Gabriel (03/09/2026): "a tela de desempenho por agente está
-- demorando muito pra carregar".
--
-- ⚠️ **A causa: a rota baixava a empresa inteira para preencher 8 colunas.**
-- `/api/relatorios/agentes` chamava `buildReportSnapshot` — o mesmo retrato
-- completo que a Análise IA usa —, e o `fetchAll` dele é um LAÇO SEQUENCIAL de
-- páginas de 1000 linhas. Medido neste banco:
--
--   17.449 mensagens em 30 dias  =  18 idas e voltas EM SÉRIE ao Supabase
--      945 conversas             +  1
--      596 oportunidades         +  1
--
-- A 200–400 ms por salto, só as mensagens custam 4–7 segundos. E a tela consome
-- **8 campos**: nome, conversas, tempo de resposta, templates, ganhos, perdidos
-- e receita. Os outros 12 campos do `AtendenteStat` são calculados e jogados
-- fora.
--
-- Esta função faz tudo em UMA consulta. Medido com `explain analyze`: **13,7 ms**
-- para a parte agregada (o `sla_conversations` acrescenta os 14–26 ms que a 0079
-- já documenta).
--
-- ⚠️ `buildReportSnapshot` **fica onde está**: a Análise IA precisa do retrato
-- inteiro para montar o prompt. O que muda é a aba Agentes parar de pagar por ele.

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
   * ⚠️ **MEDIANA, e de minutos ÚTEIS.** A métrica antiga desta aba é descrita no
   * AGENTS.md como "ficção em quatro camadas", e reescrevê-la em SQL seria
   * codificar a mentira de novo. As quatro:
   *   1. descartava tudo acima de 24h — escondia as piores respostas;
   *   2. média, não mediana (média 675 min contra mediana de 14 neste banco);
   *   3. não contava quem NUNCA foi respondido (23% das conversas);
   *   4. media tempo corrido — o p90 caía de 45h para 2h33 com o expediente.
   *
   * Aqui vem de `sla_conversations` (0079), que já resolve as quatro. Reusar em
   * vez de recalcular é o que faz a aba Agentes e a aba Atendimento
   * CONCORDAREM — hoje elas mostram números diferentes para a mesma pessoa.
   */
  mediana_resposta_min numeric,
  respostas_medidas bigint,
  /*
   * ⚠️ Vai junto de propósito. Sem isto a mediana premia quem abandona a
   * conversa: quem nunca respondeu não entra em métrica alguma, e o pior
   * atendimento fica invisível — o defeito nº 3 da lista acima.
   */
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
     * no mês passado e ninguém entenderia o zero. O cabeçalho da tela é que
     * precisa dizer o que é do período e o que é total.
     */
    select o.owner_id,
           count(*) filter (where o.status = 'won')  as ganhos,
           count(*) filter (where o.status = 'lost') as perdidos,
           coalesce(sum(o.value) filter (where o.status = 'won'), 0) as receita
      from public.opportunities o
     where o.location_id = p_location
     group by o.owner_id
  )
  select lm.user_id,
         coalesce(pr.name, 'Usuário')::text,
         lm.role::text,
         d.name::text,
         count(sla.assigned_to),
         percentile_cont(0.5) within group (order by sla.espera_util_min)
           filter (where sla.respondida),
         count(*) filter (where sla.respondida),
         count(*) filter (where sla.assigned_to is not null and not sla.respondida),
         coalesce(max(msg.templates), 0),
         coalesce(max(msg.enviadas), 0),
         coalesce(max(opp.ganhos), 0),
         coalesce(max(opp.perdidos), 0),
         coalesce(max(opp.receita), 0)
    from public.location_members lm
    left join public.profiles pr on pr.id = lm.user_id
    left join public.departments d on d.id = lm.department_id
    -- LEFT JOIN em todas: atendente sem conversa, sem mensagem ou sem lead
    -- continua aparecendo com zero. Some da lista quem não tem número é pior:
    -- "não aparece" e "não atendeu" ficam indistinguíveis.
    left join sla on sla.assigned_to = lm.user_id
    left join msg on msg.created_by = lm.user_id
    left join opp on opp.owner_id = lm.user_id
   where lm.location_id = p_location
   group by lm.user_id, pr.name, lm.role, d.name;
end;
$$;

-- ⚠️ O par obrigatório: `create function` já concede EXECUTE a PUBLIC, e
-- `create or replace` NÃO reseta grants (o bug da 0080).
revoke execute on function public.agentes_desempenho(uuid, int, int) from public, anon;
grant  execute on function public.agentes_desempenho(uuid, int, int) to authenticated;
