-- Lito CRM — recompõe a prévia das conversas que ficaram em branco
--
-- O webhook gravava `last_message_preview` com o `body` da mensagem, e em mídia
-- `body` é a LEGENDA — vazia na maioria das fotos. Resultado: a linha da conversa
-- aparecia sem texto nenhum na lista (30 conversas quando isto foi escrito).
--
-- A causa está corrigida no código (`previaDeMidia` no webhook, mesma convenção
-- de ícones que o composer já usava no envio). Esta migração conserta o que já
-- estava gravado — sem ela, essas conversas só sairiam do branco quando
-- recebessem uma mensagem nova.
--
-- ⚠️ Só toca em prévia VAZIA. Prévia preenchida pode ter sido escrita pela
-- transcrição do áudio (0085) ou por um envio do composer, e sobrescrever isso
-- com um rótulo genérico seria perder informação.
with ultima as (
  select distinct on (m.conversation_id)
         m.conversation_id,
         m.type,
         coalesce(btrim(m.body), '') as legenda,
         coalesce(m.transcription, '') as transcricao,
         coalesce(m.media_name, '') as arquivo
  from public.messages m
  where coalesce(m.internal, false) = false
    and coalesce(m.type, '') <> 'event'
  order by m.conversation_id, m.created_at desc
)
update public.conversations c
   set last_message_preview = case
         -- Áudio: `body` é a DURAÇÃO, não legenda. Quem tem transcrição mostra o
         -- texto (a mesma escolha da 0085); os demais, o rótulo.
         when u.type = 'audio' then
           case when u.transcricao <> '' then '🎤 ' || left(u.transcricao, 120)
                else '🎤 Áudio' end
         when u.type = 'image' then
           case when u.legenda <> '' then '📷 ' || u.legenda else '📷 Imagem' end
         when u.type = 'video' then
           case when u.legenda <> '' then '🎬 ' || u.legenda else '🎬 Vídeo' end
         when u.type = 'file' then
           case when u.legenda <> '' then '📎 ' || u.legenda
                when u.arquivo <> '' then '📎 ' || u.arquivo
                else '📎 Arquivo' end
         else u.legenda
       end
  from ultima u
 where u.conversation_id = c.id
   and coalesce(btrim(c.last_message_preview), '') = ''
   -- Conversa cuja última mensagem também não tem texto nenhum continuaria
   -- vazia; não vale escrever string vazia por cima de string vazia.
   and not (u.type not in ('audio', 'image', 'video', 'file') and u.legenda = '');
