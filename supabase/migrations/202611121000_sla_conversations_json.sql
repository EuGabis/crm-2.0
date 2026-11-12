-- SLA em 90 dias estourava 57014: 31.884 conversas, e paginar repetia a
-- função inteira (3 s) a cada página de 1000. Esta devolve TODAS as linhas
-- numa chamada só, como jsonb (um valor escalar não sofre o corte de Max rows).
-- Chamada pela service role (sem os 8 s do authenticated); a rota autoriza o
-- usuário antes, e a função confere a empresa dele aqui de novo.
create or replace function public.sla_conversations_json(
  p_user uuid, p_location uuid, p_from timestamptz, p_to timestamptz, p_target_min integer default 15)
returns jsonb language plpgsql volatile security definer set search_path = public, private as $$
declare r jsonb;
begin
  if not exists (select 1 from public.location_members
                  where user_id = p_user and location_id = p_location) then
    return '[]'::jsonb;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into r
    from public.sla_conversations(p_location, p_from, p_to, p_target_min) s;
  return r;
end $$;
revoke execute on function public.sla_conversations_json(uuid, uuid, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.sla_conversations_json(uuid, uuid, timestamptz, timestamptz, integer) to service_role;
notify pgrst, 'reload schema';
