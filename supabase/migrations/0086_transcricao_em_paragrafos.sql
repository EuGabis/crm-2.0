-- Lito CRM — reenfileira as transcrições longas para ganharem parágrafos
--
-- A 0085 gravava a transcrição como a API devolvia: um bloco corrido. Num áudio
-- de dois minutos isso vira um parágrafo de mil e oitocentos caracteres — que é
-- exatamente o que ninguém lê, e o motivo de a transcrição parecer inútil em
-- áudio longo.
--
-- Agora o transcritor pede `response_format=verbose_json`, usa os SEGMENTOS com
-- tempo e quebra onde a pessoa pausou (ver `emParagrafos` em
-- `src/lib/ai/transcribe.ts`). Para o texto já gravado, a única forma de ganhar
-- as quebras é transcrever de novo.
--
-- ⚠️ Só os LONGOS voltam para a fila. Áudio curto não tem o que quebrar, e
-- reprocessar os 42 curtos seria pagar de novo por um resultado idêntico.
-- O corte de 320 caracteres é o mesmo `MAX_PARAGRAFO` do código.
update public.messages
   set transcription_status = 'pendente'
 where type = 'audio'
   and transcription is not null
   and length(transcription) > 320
   -- Já tem quebra = já passou pelo formato novo. Sem esta condição, rodar a
   -- migração duas vezes reprocessaria tudo de novo.
   and position(chr(10) in transcription) = 0;
