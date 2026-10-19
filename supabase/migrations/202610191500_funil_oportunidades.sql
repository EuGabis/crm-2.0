-- A aba Leads levava dezenas de segundos para abrir (relato de 2026-10-19).
--
-- Medido como vendedor: cada página de 1000 oportunidades custava 7,6 s. A
-- policy "membros leem" (0039) chama private.pipeline_visible() e sees_all()
-- LINHA A LINHA nas ~20 mil oportunidades, e a paginação repete a varredura
-- inteira a cada página.
--
-- public.funil_oportunidades responde as perguntas sobre a PESSOA uma vez
-- (quais funis ela vê, se vê os cards dos outros) e filtra por coluna.
-- 🔴 Reproduz a policy "membros leem" de opportunities. Ao mudar a policy (ou
-- private.pipeline_visible), mude esta função junto — divergindo, o funil
-- vaza ou esconde card, sem erro.
-- security definer com a checagem de empresa na PRIMEIRA linha (padrão 0049).
create or replace function public.funil_oportunidades(p_location uuid)
returns setof public.opportunities
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ve_tudo boolean;
  v_funis uuid[];
begin
  if p_location is null or p_location not in (select private.user_locations()) then
    return;
  end if;

  v_ve_tudo := private.sees_all(p_location);

  select coalesce(array_agg(p.id), '{}') into v_funis
    from public.pipelines p
   where p.location_id = p_location
     and private.pipeline_visible(p.id);

  return query
    select o.*
      from public.opportunities o
     where o.location_id = p_location
       and o.pipeline_id = any (v_funis)
       and (v_ve_tudo or o.owner_id = v_uid)
     order by o.created_at desc, o.id;
end;
$$;

revoke execute on function public.funil_oportunidades(uuid) from public, anon;
grant execute on function public.funil_oportunidades(uuid) to authenticated;

notify pgrst, 'reload schema';
