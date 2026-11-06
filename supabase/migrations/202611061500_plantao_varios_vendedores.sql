-- Plantão com MAIS DE UM vendedor (pedido de 2026-11-06: "vamos ter 2
-- vendedores a partir de agora").
--
-- `plantoes.user_ids` guarda TODOS os plantonistas; `user_id` continua sendo o
-- primeiro, para o código que ainda lê só ele (no ar antes desta migração)
-- seguir funcionando. Os leads do plantão são divididos por igual entre eles,
-- e isso é decidido em `lib/leads/distribution.ts`.
--
-- Aditiva e idempotente: pode ser aplicada ANTES do merge.

alter table public.plantoes
  add column if not exists user_ids uuid[];

update public.plantoes set user_ids = array[user_id]
 where user_ids is null or cardinality(user_ids) = 0;

-- `drop` + `create`: a assinatura ganha um parâmetro. O chamador antigo usa
-- argumentos NOMEADOS sem `p_users`, e o default nulo o mantém compatível.
drop function if exists public.criar_plantao(uuid, uuid, timestamptz, timestamptz, text);

create or replace function public.criar_plantao(
  p_department uuid,
  p_user uuid,
  p_inicio timestamptz,
  p_fim timestamptz,
  p_se_ausente text default 'normal',
  p_users uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  loc uuid;
  novo uuid;
  todos uuid[];
begin
  select d.location_id into loc from public.departments d where d.id = p_department;
  if loc is null then
    raise exception 'departamento não encontrado';
  end if;
  -- Checagem de empresa na PRIMEIRA coisa que roda (padrão 0049) + admin.
  if loc not in (select private.user_locations()) or not private.is_admin(loc) then
    raise exception 'sem permissão';
  end if;
  if p_fim <= p_inicio then
    raise exception 'o fim tem de ser depois do início';
  end if;

  -- Lista sem repetição, com `p_user` primeiro.
  select array_agg(u order by ord) into todos from (
    select distinct on (u) u, ord from (
      select p_user as u, 0 as ord
      union all
      select x, n from unnest(coalesce(p_users, '{}'::uuid[])) with ordinality as t(x, n)
    ) a where u is not null order by u, ord
  ) b;
  if todos is null or cardinality(todos) = 0 then
    raise exception 'escolha ao menos um vendedor';
  end if;
  if exists (
    select 1 from unnest(todos) u
     where not exists (select 1 from public.location_members m
                        where m.location_id = loc and m.user_id = u)
  ) then
    raise exception 'um dos vendedores não é da empresa';
  end if;
  if exists (
    select 1 from public.plantoes pl
     where pl.department_id = p_department
       and pl.cancelado_em is null
       and pl.inicio < p_fim
       and pl.fim > p_inicio
  ) then
    raise exception 'já existe plantão neste período para o setor';
  end if;

  insert into public.plantoes (location_id, department_id, user_id, user_ids, inicio, fim, se_ausente, created_by)
  values (loc, p_department, todos[1], todos, p_inicio, p_fim,
          coalesce(nullif(p_se_ausente, ''), 'normal'), auth.uid())
  returning id into novo;
  return novo;
end;
$function$;

revoke execute on function public.criar_plantao(uuid, uuid, timestamptz, timestamptz, text, uuid[])
  from public, anon;
grant execute on function public.criar_plantao(uuid, uuid, timestamptz, timestamptz, text, uuid[])
  to authenticated;

notify pgrst, 'reload schema';
