-- Mensagens recentes da caixa por função própria (2026-11-05).
--
-- Última consulta pesada que ainda passava pela RLS linha a linha: o `load()`
-- da caixa pede as 3.000 mensagens mais recentes (`order by created_at desc
-- limit 3000`), e a policy "membros leem" de `messages` roda, por MENSAGEM,
-- conv_assigned_to_me, le_todas_conversas, sees_all, channel_allowed,
-- conv_with_bot e conv_unassigned. Para quem enxerga pouco, o índice por data
-- atravessa centenas de milhares de mensagens pagando isso em cada uma.
-- Registrado na tela de Saúde: "2× messages (57014)".
--
-- 🔴 Reproduz a policy "membros leem" de `messages`. AO MUDAR A POLICY, MUDE
-- ESTA FUNÇÃO JUNTO — divergindo, a caixa mostra mensagem que a pessoa não pode
-- ler (ou esconde a que pode), sem erro.
--
-- Duas estratégias, porque o custo de cada uma depende de QUANTO a pessoa vê:
--   - admin / le_todas_conversas: tudo da empresa → índice por data, para no
--     limite;
--   - os demais: primeiro as conversas visíveis (índices de conversations),
--     depois as mensagens delas.
--
-- O app chama a função e, se ela não existir (código antes da migração), cai
-- na consulta antiga. Pode ser aplicada antes ou depois do merge.

create or replace function public.mensagens_recentes(p_location uuid, p_limite integer default 3000)
returns setof public.messages
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean;
  v_le_todas boolean;
  v_sees_all boolean;
  v_restrito boolean;
  v_chans uuid[];
  v_lim integer := least(greatest(coalesce(p_limite, 3000), 1), 5000);
begin
  -- Checagem de empresa na PRIMEIRA linha (padrão 0049).
  if v_uid is null or p_location is null
     or p_location not in (select private.user_locations()) then
    return;
  end if;

  v_admin := private.is_admin(p_location);
  select coalesce(m.le_todas_conversas, false), coalesce(m.only_assigned, false) = false
    into v_le_todas, v_sees_all
    from public.location_members m
   where m.user_id = v_uid and m.location_id = p_location;

  select coalesce(array_agg(dc.channel_id), '{}')
    into v_chans
    from public.location_members lm
    join public.department_channels dc on dc.department_id = lm.department_id
   where lm.user_id = v_uid and lm.location_id = p_location;
  v_restrito := cardinality(v_chans) > 0;

  -- Vê tudo: a policy passa para toda mensagem da empresa.
  if v_le_todas or (v_admin and v_sees_all) then
    return query
      select m.* from public.messages m
       where m.location_id = p_location
       order by m.created_at desc, m.id desc
       limit v_lim;
    return;
  end if;

  return query
    with visiveis as (
      -- conv_assigned_to_me
      select c.id from public.conversations c
       where c.location_id = p_location and c.assigned_to = v_uid
      union
      -- sees_all + sem dono (ou admin) + fora do bot (ou admin)
      select c.id from public.conversations c
       where v_sees_all
         and c.location_id = p_location
         and (v_admin or c.assigned_to is null)
         and (v_admin or not exists (
               select 1 from public.bot_sessions s
                where s.conversation_id = c.id and s.status in ('ativo', 'aguardando')))
    )
    select m.* from public.messages m
     where m.location_id = p_location
       and m.conversation_id in (select id from visiveis)
       and (
         -- o ramo de conv_assigned_to_me não olha o número
         exists (select 1 from public.conversations c2
                  where c2.id = m.conversation_id and c2.assigned_to = v_uid)
         -- channel_allowed é por MENSAGEM no ramo sees_all
         or m.channel_id is null or v_admin or not v_restrito
         or m.channel_id = any (v_chans)
       )
     order by m.created_at desc, m.id desc
     limit v_lim;
end;
$function$;

revoke execute on function public.mensagens_recentes(uuid, integer) from public, anon, authenticated;
grant execute on function public.mensagens_recentes(uuid, integer) to authenticated;
