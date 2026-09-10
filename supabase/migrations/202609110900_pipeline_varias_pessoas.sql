-- ============================================================
-- "Quem vê este pipeline": VÁRIAS pessoas, não uma
--
-- Pedido do Gabriel (2026-09-10): no diálogo "Quem vê este pipeline", ao
-- escolher "Uma pessoa", poder escolher mais de uma.
--
-- A 0039 modelou o escopo `user` com UM `owner_id`. Para dois vendedores
-- dividirem um funil, a única saída era promover o funil a `department` — o que
-- entrega o funil ao departamento INTEIRO, ou seja o oposto do que se quer.
--
-- ⚠️ **`owner_id` NÃO sai de cena, e isso é de propósito.** Ele continua sendo
-- quem ADMINISTRA (renomeia, mexe nas fases, muda quem vê) — `pipeline_manageable`
-- não é tocada aqui. O diálogo se chama "Quem VÊ": dar administração a todos os
-- escolhidos seria decidir uma segunda coisa que ninguém pediu, e tirar
-- administração de quem já tem seria pior.
--
-- Idempotente. Pode ser aplicada ANTES do merge: a coluna é aditiva e o código
-- no ar não a conhece.
-- ============================================================

alter table public.pipelines
  add column if not exists viewer_ids uuid[] not null default '{}';

/*
 * Retroativo: o dono atual entra na lista, para o modelo ficar UNIFORME —
 * "quem vê" é sempre `owner_id` ∪ `viewer_ids`, e nenhuma consulta precisa
 * lembrar que o dono é um caso especial. Sem isto, um funil já existente
 * mostraria "0 pessoas" no diálogo com o dono ainda vendo.
 */
update public.pipelines
   set viewer_ids = array[owner_id]
 where scope = 'user'
   and owner_id is not null
   and viewer_ids = '{}'::uuid[];

-- ------------------------------------------------------------
-- Quem vê: o dono OU quem está na lista
-- ------------------------------------------------------------
/*
 * ⚠️ `set search_path = ''` (como na 0039) obriga a qualificar TUDO —
 * `public.pipelines`, `auth.uid()`, `private.is_admin`. Um nome sem esquema aqui
 * não resolve e a função quebra em runtime, não no `create`.
 *
 * ⚠️ `= any(...)` e não `@>`: com `viewer_ids` vazio o `any` é falso, que é o
 * que se quer. E o operador de contenção pediria índice GIN para valer a pena —
 * são poucas linhas em `pipelines` (dezenas), então a varredura é irrelevante.
 */
create or replace function private.pipeline_visible(pipe uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.pipelines p
     where p.id = pipe
       and (
         p.scope = 'empresa'
         or private.is_admin(p.location_id)
         or (p.scope = 'user' and (
              p.owner_id = auth.uid()
              or auth.uid() = any (coalesce(p.viewer_ids, '{}'::uuid[]))
            ))
         or (p.scope = 'department' and p.department_id in (select private.user_department_ids()))
       )
  );
$$;

revoke all on function private.pipeline_visible(uuid) from public, anon;
grant execute on function private.pipeline_visible(uuid) to authenticated;

/*
 * ⚠️ A policy de SELECT de `pipelines` repete a regra em SQL puro (não chama a
 * função) — é assim desde a 0039, para o planner não perder o índice num
 * `exists` opaco. Repetida, ela tem de ser mantida EM SINCRONIA com a função
 * acima: as duas respondem "quem vê", e divergir faria o funil aparecer na lista
 * e as fases dele não (ou o contrário).
 */
drop policy if exists "membros leem" on public.pipelines;
create policy "membros leem" on public.pipelines
  for select to authenticated
  using (
    location_id in (select private.user_locations())
    and (
      scope = 'empresa'
      or private.is_admin(location_id)
      or (scope = 'user' and (
           owner_id = (select auth.uid())
           or (select auth.uid()) = any (coalesce(viewer_ids, '{}'::uuid[]))
         ))
      or (scope = 'department' and department_id in (select private.user_department_ids()))
    )
  );

/*
 * ⚠️ **`membros criam` e `membros editam` NÃO mudam.** Quem administra continua
 * sendo o admin e o `owner_id`:
 *
 *  · se a escrita passasse a aceitar `viewer_ids`, um dos escolhidos poderia se
 *    remover da lista ou renomear o funil de outra pessoa;
 *  · e o `with check` do UPDATE é o que impede um usuário comum promover o
 *    próprio funil a 'empresa' (0039). Afrouxá-lo aqui reabriria isso.
 *
 * Consequência assumida: quem está em `viewer_ids` VÊ o funil, as fases e os
 * leads, e pode organizá-los como qualquer membro que enxerga um funil de
 * empresa — mas não muda o nome nem quem vê. Se um dia for preciso dar
 * administração a mais de um, o lugar é `pipeline_manageable`, e é outra
 * decisão.
 */

/*
 * Conferência:
 *
 *   select name, scope, owner_id, viewer_ids from public.pipelines order by name;
 *
 *   -- como um usuário específico (transação revertida):
 *   begin;
 *   select set_config('request.jwt.claims',
 *          json_build_object('sub', '<uuid do usuario>')::text, true);
 *   set local role authenticated;
 *   select id, name from public.pipelines order by name;
 *   rollback;
 */
