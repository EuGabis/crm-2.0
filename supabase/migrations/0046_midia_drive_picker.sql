-- ============================================================
-- Lito CRM — Mídia: arquivos do Drive escolhidos pelo Google Picker
--
-- POR QUE MUDOU: a primeira versão pedia o escopo `drive.readonly` e listava o
-- Drive inteiro. Esse escopo é RESTRITO — a doc oficial
-- (developers.google.com/workspace/drive/api/guides/api-specific-auth) exige
-- verificação de segurança do Google para usá-lo fora dos "test users". A
-- recomendação de lá, para app que só precisa que o usuário ESCOLHA arquivos,
-- é `drive.file` + Google Picker: acesso apenas ao que foi escolhido, sem
-- verificação.
--
-- Com o Picker, quem guarda a lista é o CRM: o usuário escolhe no diálogo do
-- Google e a referência (id, nome, tipo, link) fica aqui. Sem esta tabela, a
-- escolha valeria só até fechar a aba.
--
-- Não guardamos o conteúdo do arquivo — só o ponteiro. O arquivo continua no
-- Drive de quem escolheu.
--
-- Idempotente.
-- ============================================================

create table if not exists public.media_drive_items (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  /** id do arquivo no Google Drive. */
  file_id text not null,
  name text not null,
  mime text,
  icon_url text,
  url text,
  picked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Escolher o mesmo arquivo duas vezes não pode duplicar o card.
  unique (location_id, file_id)
);

create index if not exists media_drive_items_location_idx
  on public.media_drive_items (location_id, created_at desc);

alter table public.media_drive_items enable row level security;
revoke all on public.media_drive_items from anon;

drop policy if exists "membros leem drive" on public.media_drive_items;
create policy "membros leem drive" on public.media_drive_items
  for select to authenticated
  using (location_id in (select private.user_locations()));

drop policy if exists "membros criam drive" on public.media_drive_items;
create policy "membros criam drive" on public.media_drive_items
  for insert to authenticated
  with check (location_id in (select private.user_locations()));

drop policy if exists "membros excluem drive" on public.media_drive_items;
create policy "membros excluem drive" on public.media_drive_items
  for delete to authenticated
  using (location_id in (select private.user_locations()));
