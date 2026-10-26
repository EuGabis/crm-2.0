-- Tarefas segmentadas por responsável (pedido 2026-10-23).
--
-- As quatro policies de `tasks` (laço da 0002) só conferiam a EMPRESA: o
-- vendedor via, marcava como feita e excluía a tarefa de qualquer colega.
-- Medido: 551 tarefas, 502 do Alberto, todas visíveis para todo mundo.
--
-- Regra nova, a mesma de `opportunities` (0004): quem vê tudo
-- (`private.sees_all` = only_assigned false, e admin) continua vendo tudo; o
-- resto vê as tarefas DELE e as sem responsável (essas não podem virar tarefa
-- que ninguém enxerga).
--
-- INSERT continua só por empresa, de propósito: criar tarefa PARA um colega
-- (passagem de bastão) é legítimo. O app não pede a linha de volta nesse caso
-- (o RETURNING bateria na policy de SELECT e o insert inteiro cairia em 42501).
--
-- Idempotente.

drop policy if exists "membros leem" on public.tasks;
create policy "membros leem" on public.tasks for select to authenticated
  using (
    location_id in (select private.user_locations())
    and (private.sees_all(location_id)
         or assignee_id is null
         or assignee_id = (select auth.uid()))
  );

drop policy if exists "membros editam" on public.tasks;
create policy "membros editam" on public.tasks for update to authenticated
  using (
    location_id in (select private.user_locations())
    and (private.sees_all(location_id)
         or assignee_id is null
         or assignee_id = (select auth.uid()))
  )
  with check (location_id in (select private.user_locations()));

drop policy if exists "membros excluem" on public.tasks;
create policy "membros excluem" on public.tasks for delete to authenticated
  using (
    location_id in (select private.user_locations())
    and (private.sees_all(location_id)
         or assignee_id is null
         or assignee_id = (select auth.uid()))
  );
