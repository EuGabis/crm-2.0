-- ============================================================
-- FUP: devolve as conversas que SUBIRAM na caixa ao lugar delas
-- ============================================================
-- Relato (2026-10-08): o envio do FUP gravava `last_message_at = agora` e a
-- prévia "📨 FUP: convite para o grupo", e a conversa subia ao topo da caixa
-- do vendedor como se ele tivesse acabado de falar com o cliente. O código já
-- não faz mais isso; esta migração desfaz o que ficou.
--
-- Critério ESTREITO: só conversa cuja prévia AINDA é a do FUP — ou seja,
-- ninguém escreveu nada depois dele. Se o cliente respondeu, a prévia já mudou
-- e o horário é real; não se toca.
--
-- O horário volta para o da última mensagem de VERDADE (sem o próprio FUP,
-- sem evento do fio, sem nota interna, sem apagada), e a prévia para o texto
-- dela — mesma convenção de ícones de `private.recalcular_previa`.
--
-- Idempotente: na segunda execução não sobra prévia de FUP.
-- ============================================================

do $$
declare
  n integer;
begin
  with alvo as (
    select c.id,
           ult.created_at, ult.body, ult.type, ult.media_name
      from public.conversations c
      cross join lateral (
        select m.created_at, m.body, m.type, m.media_name
          from public.messages m
         where m.conversation_id = c.id
           and m.type <> 'event'
           and not m.internal
           and m.deleted_at is null
           and m.template_name is distinct from 'fup_unico_autom_tico'
         order by m.created_at desc, m.id desc
         limit 1
      ) ult
     where c.last_message_preview = '📨 FUP: convite para o grupo'
  )
  update public.conversations c
     set last_message_at = alvo.created_at,
         last_message_preview = case
           when alvo.type = 'text' then coalesce(alvo.body, '')
           when alvo.type = 'image' then '📷 Imagem'
           when alvo.type = 'video' then '🎥 Vídeo'
           when alvo.type = 'audio' then '🎤 Áudio'
           else '📎 ' || coalesce(nullif(alvo.media_name, ''), 'Arquivo')
         end
    from alvo
   where c.id = alvo.id;

  get diagnostics n = row_count;
  -- Esperado: perto dos ~134 FUPs enviados, menos os que o cliente respondeu.
  raise notice 'conversas devolvidas ao lugar: %', n;
end;
$$;
