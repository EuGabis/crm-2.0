-- Falhas de consulta visíveis na tela de Saúde (2026-11-04).
--
-- Em 24h o banco cancelou 3.768 consultas por tempo esgotado e ninguém soube:
-- a consulta voltava vazia, a tela lia como zero, e o sintoma aparecia dias
-- depois como "lead parado" ou "o sino não avisa". O log do Postgres guarda
-- isso, mas o app não alcança o log.
--
-- Então o próprio app registra: os clientes do Supabase (navegador e servidor)
-- interceptam respostas com tempo esgotado (57014) ou falha de conexão e
-- chamam `registrar_falha_consulta`. A Saúde lê o resumo.

create table if not exists public.falhas_consulta (
  id bigint generated always as identity primary key,
  location_id uuid,
  user_id uuid,
  em timestamptz not null default now(),
  codigo text not null,
  -- Tabela ou "rpc/<função>" — nunca a URL inteira, que traria filtros com dado.
  recurso text not null
);
create index if not exists falhas_consulta_em_idx on public.falhas_consulta (em desc);

-- RLS ligada e SEM policy: só as funções abaixo leem e escrevem.
alter table public.falhas_consulta enable row level security;
revoke all on public.falhas_consulta from public, anon, authenticated;

create or replace function public.registrar_falha_consulta(
  p_codigo text,
  p_recurso text,
  p_location uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_loc uuid;
begin
  if p_codigo is null or p_recurso is null then return; end if;

  -- A empresa sai da SESSÃO quando há usuário; só o servidor (sem usuário)
  -- informa a empresa por parâmetro — e ele roda com a service role.
  if v_uid is not null then
    select lm.location_id into v_loc from public.location_members lm
     where lm.user_id = v_uid limit 1;
    if v_loc is null then return; end if;
  else
    v_loc := p_location;
  end if;

  -- Teto: uma linha por pessoa+recurso por minuto. Sem isto, uma tela em laço
  -- de falha encheria a tabela — e o registro existe para diagnosticar, não
  -- para virar o próximo problema.
  if exists (
    select 1 from public.falhas_consulta f
     where f.em > now() - interval '1 minute'
       and f.recurso = left(p_recurso, 120)
       and f.user_id is not distinct from v_uid
  ) then
    return;
  end if;

  insert into public.falhas_consulta (location_id, user_id, codigo, recurso)
  values (v_loc, v_uid, left(p_codigo, 20), left(p_recurso, 120));

  -- Faxina barata pelo índice de `em`: o painel olha 24h; 7 dias sobram.
  delete from public.falhas_consulta where em < now() - interval '7 days';
end;
$function$;

revoke execute on function public.registrar_falha_consulta(text, text, uuid) from public, anon, authenticated;
grant execute on function public.registrar_falha_consulta(text, text, uuid) to authenticated, service_role;

create or replace function public.falhas_consulta_resumo(p_location uuid)
returns table (recurso text, codigo text, ultima_hora bigint, ultimas_24h bigint, pessoas bigint, ultima timestamptz)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  -- Admin da empresa, na PRIMEIRA linha (padrão 0049).
  if p_location is null or p_location not in (select private.user_locations())
     or not private.is_admin(p_location) then
    return;
  end if;
  return query
    select f.recurso, f.codigo,
           count(*) filter (where f.em > now() - interval '1 hour'),
           count(*),
           count(distinct f.user_id),
           max(f.em)
      from public.falhas_consulta f
     where f.em > now() - interval '24 hours'
       -- Linha sem empresa é do servidor (tique, webhook): vale para todos.
       and (f.location_id = p_location or f.location_id is null)
     group by f.recurso, f.codigo
     order by count(*) desc;
end;
$function$;

revoke execute on function public.falhas_consulta_resumo(uuid) from public, anon, authenticated;
grant execute on function public.falhas_consulta_resumo(uuid) to authenticated;
