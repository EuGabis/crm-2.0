-- Dias SEM MEDIDA de presença: os cobertos por uma sessão descartada na 202611031300.
--
-- Sem isto, o dia coberto só pela sessão descartada aparecia como 0h — e 0h afirma
-- que a pessoa não usou o CRM (caso medido: Alberto, domingo 02/11, que estava
-- mexendo no CRM às 14:47). A tela passa a escrever "sem medida" nesses dias.
--
-- A tabela de descartadas mora em `private` (sem acesso pela API), daí a função
-- security definer, com a checagem de empresa na primeira linha (padrão 0049).
-- Aditiva: pode ser aplicada antes ou depois do merge.

create or replace function public.dias_sem_medida_presenca(p_location uuid, p_de date, p_ate date)
returns table (usuario uuid, dia date)
language plpgsql
stable
security definer
set search_path to 'public', 'private'
as $fn$
begin
  if p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  with limites as (
    select g.d::date as d,
           (g.d::date::timestamp at time zone 'America/Sao_Paulo') as ini,
           ((g.d::date + 1)::timestamp at time zone 'America/Sao_Paulo') as fim
      from generate_series(p_de, p_ate, interval '1 day') as g(d)
  )
  select distinct x.user_id, l.d
    from private.presence_sessions_descartadas x
    join limites l on x.inicio < l.fim and x.fim > l.ini
   where x.location_id = p_location;
end;
$fn$;

revoke execute on function public.dias_sem_medida_presenca(uuid, date, date) from public, anon, authenticated;
grant execute on function public.dias_sem_medida_presenca(uuid, date, date) to authenticated;
