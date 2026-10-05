-- ============================================================
-- Domínio novo: https://www.litocrm.app (antes https://lito-crm.vercel.app)
--
-- Os três crons (automações, marketing, sincronização da Guru) chamam a URL
-- guardada nestas tabelas do schema private. Só a URL muda; o segredo NÃO é
-- tocado (sobrescrevê-lo derrubaria o motor com 401 — ver 0009/0011).
--
-- ⚠️ ANTES de aplicar, confira que o domínio novo responde às rotas de máquina:
--   abrir https://www.litocrm.app/api/whatsapp/send-media  → deve vir JSON
--   (rota fora do proxy; 404 ou página de erro = domínio ainda não pronto).
--
-- Conferir depois de 1–2 minutos:
--   select status_code, created from net._http_response order by created desc limit 5;
--   -- deve ser 200. Se não for, volte trocando 'www.litocrm.app' por
--   -- 'lito-crm.vercel.app' nos três updates abaixo.
-- Idempotente.
-- ============================================================

update private.automation_config
   set tick_url = 'https://www.litocrm.app/api/automations/tick';

update private.marketing_config
   set tick_url = 'https://www.litocrm.app/api/marketing/tick';

update private.guru_sync_config
   set sync_url = 'https://www.litocrm.app/api/integrations/guru/sync';
