-- ============================================================
-- Lito CRM — Uma conversa por (empresa, contato, número) + dedup das existentes
--
-- Bug: o webhook fazia "acha (maybeSingle) e insere" SEM trava. Duas entregas da
-- Meta quase simultâneas criavam 2 conversas do mesmo contato+canal; a partir daí
-- o `.maybeSingle()` da busca passava a FALHAR (mais de uma linha) e o webhook
-- criava uma conversa NOVA a cada mensagem — bola de neve (ex.: 9 conversas do
-- mesmo contato, todas travadas no "Digite o seu nome:").
--
-- Correção em duas partes:
--   1) DEDUP das duplicatas já existentes: para cada (location, contato, canal),
--      mantém a conversa MAIS ANTIGA (keeper), move as mensagens das duplicatas
--      para ela e apaga as duplicatas (o bot_session da duplicata cai por cascade).
--   2) ÍNDICE ÚNICO impedindo novas duplicatas. O webhook passa a tratar a
--      violação (23505) pegando a conversa existente (mudança de código à parte).
-- Idempotente (o índice usa IF NOT EXISTS; o dedup é no-op se não houver dupes).
-- ============================================================
set check_function_bodies = off;

-- 1) Move as mensagens das duplicatas para o keeper (conversa mais antiga do grupo).
update public.messages m
set conversation_id = d.keeper_id
from (
  select c.id as dup_id, k.keeper_id
  from public.conversations c
  join (
    select distinct on (location_id, contact_id, channel_id)
           id as keeper_id, location_id, contact_id, channel_id
    from public.conversations
    order by location_id, contact_id, channel_id, created_at, id
  ) k using (location_id, contact_id, channel_id)
  where c.id <> k.keeper_id
) d
where m.conversation_id = d.dup_id;

-- 2) Apaga as conversas duplicadas (mensagens já migradas; bot_session da dup
--    some por cascade — o keeper mantém o dele).
delete from public.conversations c
using (
  select c2.id as dup_id
  from public.conversations c2
  join (
    select distinct on (location_id, contact_id, channel_id)
           id as keeper_id, location_id, contact_id, channel_id
    from public.conversations
    order by location_id, contact_id, channel_id, created_at, id
  ) k using (location_id, contact_id, channel_id)
  where c2.id <> k.keeper_id
) d
where c.id = d.dup_id;

-- 3) Reacerta o preview/última atividade do keeper a partir das mensagens que ele
--    passou a ter (a duplicação embaralhava esses campos).
update public.conversations c
set last_message_at = agg.max_at,
    last_message_preview = coalesce(agg.preview, c.last_message_preview)
from (
  select conversation_id,
         max(created_at) as max_at,
         (array_agg(body order by created_at desc))[1] as preview
  from public.messages
  where not internal
  group by conversation_id
) agg
where agg.conversation_id = c.id;

-- 4) Trava: uma conversa por empresa+contato+número. Impede a corrida de repetir.
create unique index if not exists conversations_contact_channel_uidx
  on public.conversations (location_id, contact_id, channel_id);
