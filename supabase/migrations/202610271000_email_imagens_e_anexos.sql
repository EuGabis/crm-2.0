-- Imagem do computador, anexos e design nas campanhas de e-mail (2026-10-27).
--
-- O editor só aceitava imagem por URL — a imagem tinha de estar hospedada em
-- outro lugar antes. E não havia anexo nenhum.
--
-- 1. Bucket PÚBLICO `email-midia`, caminho {location_id}/{uuid}-{nome}. Tem de
--    ser público: quem abre o e-mail (Gmail, Outlook) baixa a imagem sem sessão
--    nenhuma do CRM. Escrita/exclusão só por membros da empresa, pela pasta
--    (mesmo padrão do `branding`, 0034). Teto de 20 MB por arquivo.
-- 2. `email_campaigns.attachments` (jsonb [{name,url,size,type}]).
--    ⚠️ O anexo vai como LINK DE DOWNLOAD no corpo do e-mail, não como anexo
--    MIME: o envio em lote do Resend (que a campanha usa) não aceita
--    `attachments` ("not supported yet" na doc), e mandar um por um levaria
--    horas numa base de 20 mil. De quebra, anexo pesado em e-mail de massa é
--    um dos sinais clássicos de spam.
--
-- Idempotente.

insert into storage.buckets (id, name, public, file_size_limit)
values ('email-midia', 'email-midia', true, 20971520)
on conflict (id) do update set public = true, file_size_limit = 20971520;

drop policy if exists "email midia leitura publica" on storage.objects;
create policy "email midia leitura publica" on storage.objects
  for select using (bucket_id = 'email-midia');

drop policy if exists "membros gravam email midia" on storage.objects;
create policy "membros gravam email midia" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'email-midia'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  );

drop policy if exists "membros apagam email midia" on storage.objects;
create policy "membros apagam email midia" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'email-midia'
    and nullif((storage.foldername(name))[1], '')::uuid in (select private.user_locations())
  );

alter table public.email_campaigns
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- 3. `email_campaigns.design` — cores, fonte, cabeçalho/logo, largura, rodapé
--    (`lib/email/design.ts`). Vazio = o visual de antes; `accent_color` segue
--    valendo para campanha antiga. O app normaliza tudo antes de virar CSS.
alter table public.email_campaigns
  add column if not exists design jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
