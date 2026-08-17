-- ============================================================
-- Lito CRM — Mídia Drive real (pastas + arquivos no Supabase Storage)
--
-- O módulo mostrava oito nomes de arquivo fixos no código ("Depoimento
-- Donizetti v4.mp4", "14,09 GB usados") e todos os botões só emitiam toast.
-- Agora é armazenamento de verdade.
--
-- Mesmo desenho de `payment_files` (0015): binários num bucket PRIVADO
-- (`media-drive`), metadados numa tabela com RLS de membership, e as policies
-- de `storage.objects` espelhando isso pelo primeiro segmento do caminho
-- (a pasta raiz = o location_id).
--
-- Pastas são uma tabela própria, não prefixos do caminho: renomear pasta viraria
-- mover N objetos no storage, e pasta vazia não existiria. O caminho no bucket
-- continua `{location_id}/{uuid}.{ext}`, sem a hierarquia — quem organiza é o
-- `folder_id`.
--
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

-- ---------- Bucket privado ----------
insert into storage.buckets (id, name, public)
values ('media-drive', 'media-drive', false)
on conflict (id) do nothing;

-- ---------- Pastas ----------
create table if not exists public.media_folders (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  name text not null,
  -- Subpasta: `on delete cascade` some com a árvore junto (os arquivos ficam,
  -- ver `media_files.folder_id`).
  parent_id uuid references public.media_folders (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists media_folders_location_idx
  on public.media_folders (location_id, parent_id, name);

-- ---------- Arquivos ----------
create table if not exists public.media_files (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  -- `on delete set null`: apagar a pasta NÃO apaga o arquivo, ele volta para a
  -- raiz. Perder um vídeo por causa de uma pasta excluída não tem desfazer.
  folder_id uuid references public.media_folders (id) on delete set null,
  name text not null,
  path text not null,
  size bigint,
  mime text,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (location_id, path)
);

create index if not exists media_files_location_idx
  on public.media_files (location_id, created_at desc);
create index if not exists media_files_folder_idx
  on public.media_files (location_id, folder_id);

-- ---------- RLS (padrão membership) ----------
alter table public.media_folders enable row level security;
alter table public.media_files enable row level security;
revoke all on public.media_folders from anon;
revoke all on public.media_files from anon;

do $$
declare
  t text;
begin
  foreach t in array array['media_folders', 'media_files']
  loop
    execute format('drop policy if exists "membros leem midia" on public.%I;', t);
    execute format($p$
      create policy "membros leem midia" on public.%I
        for select to authenticated
        using (location_id in (select private.user_locations()));
    $p$, t);

    execute format('drop policy if exists "membros criam midia" on public.%I;', t);
    execute format($p$
      create policy "membros criam midia" on public.%I
        for insert to authenticated
        with check (location_id in (select private.user_locations()));
    $p$, t);

    execute format('drop policy if exists "membros editam midia" on public.%I;', t);
    execute format($p$
      create policy "membros editam midia" on public.%I
        for update to authenticated
        using (location_id in (select private.user_locations()))
        with check (location_id in (select private.user_locations()));
    $p$, t);

    execute format('drop policy if exists "membros excluem midia" on public.%I;', t);
    execute format($p$
      create policy "membros excluem midia" on public.%I
        for delete to authenticated
        using (location_id in (select private.user_locations()));
    $p$, t);
  end loop;
end;
$$;

-- ---------- Policies do Storage (bucket media-drive) ----------
-- A pasta raiz do objeto é o location_id: membros leem/gravam/apagam só o que
-- está sob a pasta da própria empresa.
drop policy if exists "membros leem storage de midia" on storage.objects;
create policy "membros leem storage de midia" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media-drive'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  );

drop policy if exists "membros gravam storage de midia" on storage.objects;
create policy "membros gravam storage de midia" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media-drive'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  );

drop policy if exists "membros excluem storage de midia" on storage.objects;
create policy "membros excluem storage de midia" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media-drive'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  );
