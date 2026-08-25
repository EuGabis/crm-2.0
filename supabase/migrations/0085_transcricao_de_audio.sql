-- Lito CRM — transcrição dos áudios das conversas
--
-- Áudio no atendimento tem um custo escondido: para saber o que o cliente disse
-- é preciso PARAR e ouvir, com fone, no ritmo de quem falou. A transcrição faz o
-- áudio virar texto pesquisável (a busca global do inbox procura no corpo das
-- mensagens) e legível de relance na lista.
--
-- Volume medido neste banco, 30 dias: 63 áudios recebidos (~13 min) e 137
-- enviados (~62 min). A ~US$ 0,006/min isso dá menos de US$ 0,50 por mês — foi o
-- que permitiu transcrever TUDO automaticamente em vez de exigir um clique.

alter table public.messages
  add column if not exists transcription text,
  -- 'pendente' = na fila do tick · 'ok' · 'falhou' · 'ignorado' (áudio sem
  -- arquivo, ou longo demais). NULL = mensagem que não é áudio.
  add column if not exists transcription_status text,
  add column if not exists transcription_error text;

-- A fila do tick: só os áudios pendentes, e o índice é PARCIAL porque a tabela
-- inteira tem centenas de milhares de linhas e a fila costuma ter zero.
create index if not exists messages_transcricao_pendente_idx
  on public.messages (created_at)
  where transcription_status = 'pendente';

-- Todo áudio nasce na fila, venha do webhook (cliente), do composer (atendente)
-- ou de qualquer outro caminho.
--
-- ⚠️ É TRIGGER, não `default` na coluna nem responsabilidade de quem insere:
-- áudio entra por quatro caminhos diferentes (webhook do WhatsApp, `sendMedia`
-- do composer, painel Arquivos, disparo de mídia) e o quinto que alguém criar
-- amanhã ia esquecer de marcar. Aqui é o banco que garante.
create or replace function private.marcar_audio_para_transcrever()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if new.type = 'audio' and new.transcription is null
     and new.transcription_status is null then
    new.transcription_status := 'pendente';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audio_para_transcrever on public.messages;
create trigger trg_audio_para_transcrever
  before insert on public.messages
  for each row execute function private.marcar_audio_para_transcrever();

-- Os áudios que já existem entram na fila também: o histórico é justamente o que
-- ninguém vai voltar para ouvir.
update public.messages
   set transcription_status = 'pendente'
 where type = 'audio' and transcription is null and transcription_status is null;
