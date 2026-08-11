-- ============================================================
-- Lito CRM — Email Marketing: cor de destaque da campanha (Brand Board)
-- Rode este arquivo inteiro de uma vez no SQL Editor.
-- ============================================================
alter table public.email_campaigns
  add column if not exists accent_color text;
