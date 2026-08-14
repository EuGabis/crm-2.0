-- ============================================================
-- Lito CRM — Logo da empresa (whitelabel)
--
-- locations.logo_url guarda a URL pública do logo; o binário vai para o bucket
-- PÚBLICO `branding` no caminho {location_id}/logo-{ts}.{ext}. Leitura liberada
-- (logo aparece no app e em e-mail); escrita/exclusão só por membros da empresa,
-- escopadas pela pasta = location_id (mesmo padrão de payment-files/0015).
-- Setar logo_url em locations é admin-only (a RLS de UPDATE de locations reforça).
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

alter table public.locations add column if not exists logo_url text;

insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

drop policy if exists "logo leitura pública" on storage.objects;
create policy "logo leitura pública" on storage.objects
  for select using (bucket_id = 'branding');

drop policy if exists "membros gravam logo" on storage.objects;
create policy "membros gravam logo" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'branding'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  );

drop policy if exists "membros atualizam logo" on storage.objects;
create policy "membros atualizam logo" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'branding'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  )
  with check (
    bucket_id = 'branding'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  );

drop policy if exists "membros apagam logo" on storage.objects;
create policy "membros apagam logo" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'branding'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  );
