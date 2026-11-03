-- Tempo online contava o período AUSENTE.
--
-- Enquanto ausente, touch_presence não grava sessão mas atualiza last_seen_at.
-- Ao voltar para online, v_frio (que olha last_seen_at) dava false e o código
-- esticava a ÚLTIMA sessão até now() — engolindo o intervalo ausente inteiro
-- (ex.: Karina 24h num dia).
--
-- Agora a continuidade é decidida pelo FIM da própria sessão: se o último ping
-- online foi há mais que a janela de presença, abre sessão nova.
-- online_desde (usado pelo SLA) não muda de regra.
--
-- Mesma assinatura: pode ser aplicada antes ou depois do merge.
-- ⚠️ Não corrige sessões já gravadas: o intervalo ausente dentro delas não
-- foi registrado em lugar nenhum.

create or replace function public.touch_presence()
returns void
language plpgsql
security definer
set search_path to 'public', 'private'
as $fn$
declare
  v_user uuid := auth.uid();
  v_loc uuid;
  v_frio boolean;
  v_ausente boolean;
  v_sessao uuid;
  v_fim timestamptz;
begin
  if v_user is null then
    return;
  end if;

  select m.location_id,
         (m.online_desde is null
          or m.last_seen_at is null
          or m.last_seen_at < now() - private.presenca_janela()),
         coalesce(m.disponibilidade, 'online') = 'ausente'
    into v_loc, v_frio, v_ausente
    from public.location_members m
   where m.user_id = v_user
   limit 1;

  if v_loc is null then
    return;
  end if;

  update public.location_members
     set last_seen_at = now(),
         online_desde = case
           when v_ausente then online_desde
           when v_frio then now()
           else online_desde
         end
   where user_id = v_user;

  -- Ausente não acumula tempo online.
  if v_ausente then
    return;
  end if;

  select s.id, s.fim into v_sessao, v_fim
    from public.presence_sessions s
   where s.user_id = v_user
   order by s.inicio desc
   limit 1;

  -- Continua a sessão só se o último ping ONLINE dela está dentro da janela.
  -- Um intervalo ausente (ou offline) maior que isso abre sessão nova.
  if v_sessao is not null and v_fim >= now() - private.presenca_janela() then
    update public.presence_sessions set fim = now() where id = v_sessao;
  else
    insert into public.presence_sessions (location_id, user_id, inicio, fim)
    values (v_loc, v_user, now(), now());
  end if;
end;
$fn$;

revoke execute on function public.touch_presence() from public, anon, authenticated;
grant execute on function public.touch_presence() to authenticated;
