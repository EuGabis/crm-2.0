-- ============================================================
-- Lito CRM — Conversas: anexos e áudio (Supabase Storage)
--
-- O composer da caixa de entrada passa a enviar imagens, documentos
-- (PDF/DOCX) e áudios gravados pelo microfone. Os binários vão para um
-- bucket PRIVADO (`conversation-media`) com caminho
-- `{location_id}/{conversation_id}/{uuid}.{ext}`; os metadados ficam na
-- própria linha de `public.messages` (media_path/name/mime/size), e a
-- exibição usa URL assinada temporária.
--
-- Segue o MESMO padrão multi-tenant das demais migrações: bucket privado,
-- políticas de storage.objects pelo primeiro segmento do caminho (= o
-- location_id), checagem de membership via private.user_locations().
--
-- Idempotente: pode rodar de novo sem erro.
-- ============================================================
set check_function_bodies = off;

-- ---------- Bucket privado ----------
insert into storage.buckets (id, name, public)
values ('conversation-media', 'conversation-media', false)
on conflict (id) do nothing;

-- ---------- Novos tipos de mensagem + colunas de mídia ----------
-- 'image' e 'file' juntam-se a text/audio/event.
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages add constraint messages_type_check
  check (type in ('text', 'audio', 'image', 'file', 'event'));

alter table public.messages add column if not exists media_path text;  -- {location_id}/{conversation_id}/{uuid}.{ext}
alter table public.messages add column if not exists media_name text;  -- nome original (ex.: "Proposta.pdf")
alter table public.messages add column if not exists media_mime text;  -- image/png | application/pdf | audio/webm | ...
alter table public.messages add column if not exists media_size bigint; -- bytes

-- ---------- Políticas do Storage (bucket conversation-media) ----------
-- A pasta raiz do objeto é o location_id; membros da empresa leem/gravam/apagam
-- só o que está sob a pasta da própria empresa.
drop policy if exists "membros leem midia de conversas" on storage.objects;
create policy "membros leem midia de conversas" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'conversation-media'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  );

drop policy if exists "membros gravam midia de conversas" on storage.objects;
create policy "membros gravam midia de conversas" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'conversation-media'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  );

drop policy if exists "membros apagam midia de conversas" on storage.objects;
create policy "membros apagam midia de conversas" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'conversation-media'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  );
