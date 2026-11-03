-- Descarta as sessões de presença infladas pelo defeito corrigido na 202611031200.
--
-- Ao voltar de Ausente para Online, touch_presence esticava a última sessão até
-- agora, engolindo noites e fins de semana (caso medido: Karina, uma sessão de
-- 108h de 29/10 19:59 a 03/11 08:08). O tempo real dentro dessas sessões não foi
-- registrado em lugar nenhum, então não há como cortá-las no ponto certo —
-- inventar um fim seria número falso com cara de medida.
--
-- Critério: sessão com mais de 12h. Um turno real não chega lá (o logout por
-- inatividade derruba o "user" em 10 min parado), e o limite deixa de fora as
-- sessões longas legítimas de um dia de trabalho.
--
-- ⚠️ As linhas NÃO são apagadas de vez: vão para private.presence_sessions_descartadas
-- antes, para poder voltar atrás. Para desfazer:
--   insert into public.presence_sessions (id, location_id, user_id, inicio, fim, tipo)
--   select id, location_id, user_id, inicio, fim, tipo
--     from private.presence_sessions_descartadas;
--
-- ⚠️ Aplicar DEPOIS da 202611031200 (precisa da coluna `tipo`). Idempotente:
-- rodar de novo só move o que ainda passar de 12h.
--
-- Prévia antes de aplicar:
--   select p.name, s.inicio at time zone 'America/Sao_Paulo' inicio,
--          s.fim at time zone 'America/Sao_Paulo' fim,
--          round(extract(epoch from (s.fim - s.inicio)) / 3600.0, 1) horas
--     from public.presence_sessions s join public.profiles p on p.id = s.user_id
--    where s.fim - s.inicio > interval '12 hours' order by horas desc;

create table if not exists private.presence_sessions_descartadas (
  id uuid primary key,
  location_id uuid not null,
  user_id uuid not null,
  inicio timestamptz not null,
  fim timestamptz not null,
  tipo text not null,
  descartada_em timestamptz not null default now()
);

alter table private.presence_sessions_descartadas enable row level security;

do $$
declare
  v_qtd integer;
begin
  insert into private.presence_sessions_descartadas (id, location_id, user_id, inicio, fim, tipo)
  select s.id, s.location_id, s.user_id, s.inicio, s.fim, s.tipo
    from public.presence_sessions s
   where s.fim - s.inicio > interval '12 hours'
  on conflict (id) do nothing;

  delete from public.presence_sessions s
   where s.fim - s.inicio > interval '12 hours';
  get diagnostics v_qtd = row_count;

  raise notice 'Sessões acima de 12h descartadas: %', v_qtd;
end;
$$;
