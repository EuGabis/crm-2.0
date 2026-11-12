-- Finalizar SOLTA o responsável (finish_conversation grava assigned_to = null),
-- então as conversas finalizadas de uma pessoa apareciam como "Sem responsável"
-- no relatório de Atendimento. Acrescenta `closed_by` (quem finalizou) a cada
-- linha; o app usa assigned_to e, na finalizada, closed_by.
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
  select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object('closed_by', c.closed_by)), '[]'::jsonb) into r
    from public.sla_conversations(p_location, p_from, p_to, p_target_min) s
    left join public.conversations c on c.id = s.conversation_id;
  return r;
end $$;
revoke execute on function public.sla_conversations_json(uuid, uuid, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.sla_conversations_json(uuid, uuid, timestamptz, timestamptz, integer) to service_role;
notify pgrst, 'reload schema';
