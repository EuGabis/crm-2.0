-- Os áudios que ficaram "falhou" porque a CONTA da OpenAI estava sem crédito
-- voltam para a fila.
--
-- Relato do Gabriel (2026-09-22): *"o problema tem sido no resumo do contato,
-- transcrição dos áudios e análise de IA"* — e a mensagem da tela deu o código
-- exato: **429 · `credit_balance_exhausted`**, ou seja saldo zerado na OpenAI.
--
-- 🔴 **Por que não basta recarregar o saldo.** A fila do tique só olha
-- `transcription_status = 'pendente'` (ver `processarFilaDeTranscricao`). Todo
-- áudio que tentou transcrever durante a falta de crédito foi marcado `falhou`,
-- e `falhou` é definitivo: nem depois da recarga eles seriam tentados de novo.
-- Sem esta migração, o histórico de áudio desse período fica sem transcrição
-- para sempre — e a transcrição é o que faz o áudio entrar na busca do inbox.
--
-- ⚠️ **O código já não repete isso**: falha de CONTA (saldo, chave, limite,
-- OpenAI fora do ar) passa a marcar `pendente` em vez de `falhou`. Esta migração
-- só conserta o que ficou para trás, como a 0086 fez com as transcrições longas.
--
-- ⚠️ **Critério ESTREITO, por texto do erro.** O que não pode acontecer é
-- reenfileirar áudio que falhou por defeito do ARQUIVO — esse voltaria a falhar
-- a cada minuto, para sempre, que é o laço infinito que o estado `ignorado`
-- existe para evitar. Por isso o `where` casa só com as marcas de problema de
-- conta, e nunca com "sem arquivo", "acima de 25 MB" ou "nenhuma fala".

begin;

do $$
declare
  v_afetadas integer;
begin
  update public.messages
     set transcription_status = 'pendente',
         transcription_error = null
   where type = 'audio'
     and transcription_status = 'falhou'
     and transcription_error is not null
     and (
       -- Mensagens CRUAS da OpenAI, que era o que o código gravava antes de hoje.
       transcription_error ilike '%credit balance%'
       or transcription_error ilike '%exceeded your current quota%'
       or transcription_error ilike '%insufficient_quota%'
       or transcription_error ilike '%billing%'
       or transcription_error ilike '%rate limit%'
       or transcription_error ilike '%incorrect api key%'
       or transcription_error ilike '%OpenAI 429%'
       or transcription_error ilike '%OpenAI 401%'
       or transcription_error ilike '%OpenAI 5%'
       or transcription_error ilike '%OPENAI_API_KEY%'
       -- E as traduzidas, para o caso de alguma já ter sido gravada pelo código novo.
       or transcription_error ilike '%SEM CRÉDITO%'
       or transcription_error ilike '%chave da OpenAI foi recusada%'
     );

  get diagnostics v_afetadas = row_count;

  /*
   * ⚠️ Migração que altera dado tem de DIZER quantas linhas mexeu. Duas
   * migrações deste projeto responderam "sucesso" tendo mexido em ZERO linhas,
   * e quem descobriu foi o Gabriel olhando a tela — duas vezes.
   */
  raise notice 'audios reenfileirados: %', v_afetadas;

  if v_afetadas = 0 then
    raise notice 'nenhum audio com marca de falha de conta — confira com: select transcription_status, left(transcription_error, 120), count(*) from public.messages where type = ''audio'' group by 1, 2 order by 3 desc;';
  end if;
end $$;

commit;
