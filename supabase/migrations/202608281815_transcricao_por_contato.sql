-- Lito CRM — desligar a transcrição de áudio POR CONTATO
--
-- Pedido do Gabriel (2026-08-28): testar o envio de áudio com a transcrição
-- desativada, e **só para o contato 11 98877-2030** — não para a empresa inteira.
-- É a forma certa de testar: isola a variável sem tirar a transcrição de quem
-- está atendendo de verdade.
--
-- ⚠️ **Por que uma coluna, e não editar o gatilho com o telefone dentro.**
-- Trocar o corpo de `marcar_audio_para_transcrever` para pular um número fixo
-- funcionaria e não exigiria migração — mas deixa um telefone cravado numa função
-- de produção, que fica lá para sempre se alguém esquecer de desfazer. Um teste
-- não pode depender de alguém lembrar de limpar. Com a coluna, desligar e religar
-- é um `update` de uma linha, e o estado fica visível na tabela.

alter table public.contacts
  add column if not exists transcrever_audio boolean not null default true;

comment on column public.contacts.transcrever_audio is
  'false = áudios deste contato não entram na fila de transcrição.';

/*
 * O gatilho passa a consultar o contato da conversa.
 *
 * ⚠️ Marca `ignorado` e NÃO deixa nulo. Os dois tirariam o áudio da fila, mas
 * `ignorado` é um estado que a 0085 já definiu ("saiu da fila de propósito") e
 * aparece na consulta de status — nulo seria indistinguível de "áudio antigo,
 * anterior à transcrição", e a diferença some justamente quando alguém for
 * conferir se o teste estava valendo.
 *
 * A consulta extra por INSERT de áudio é irrelevante: são ~200 áudios por mês
 * neste banco (medido na 0085), não 200 por segundo.
 */
create or replace function private.marcar_audio_para_transcrever()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transcrever boolean;
begin
  if new.type = 'audio' and new.transcription is null
     and new.transcription_status is null then

    select c.transcrever_audio
      into v_transcrever
      from public.conversations cv
      join public.contacts c on c.id = cv.contact_id
     where cv.id = new.conversation_id;

    -- `coalesce(true)`: sem conversa/contato resolvível, o padrão é transcrever.
    -- Um lookup que falha não pode virar "desliga em silêncio".
    if coalesce(v_transcrever, true) then
      new.transcription_status := 'pendente';
    else
      new.transcription_status := 'ignorado';
    end if;
  end if;
  return new;
end;
$$;

-- ---------- O teste ----------
--
-- Desliga só para 11 98877-2030. `private.phone_key` (0047) normaliza os dois
-- lados: o CRM guarda telefone com e sem DDI, com e sem pontuação, e comparar as
-- strings cruas erraria o contato.
update public.contacts
   set transcrever_audio = false
 where private.phone_key(phone) = private.phone_key('11988772030');

-- ⚠️ CONFIRA o resultado: se vier VAZIO, o telefone não casou e o teste rodaria
-- COM a transcrição ligada — falso negativo, e ninguém perceberia. O `update`
-- acima não avisa quando não acha ninguém.
select c.id, c.first_name, c.last_name, c.phone, c.transcrever_audio
  from public.contacts c
 where private.phone_key(c.phone) = private.phone_key('11988772030');

-- Para RELIGAR depois do teste (rodar sozinho, no SQL Editor):
--
--   update public.contacts set transcrever_audio = true
--    where private.phone_key(phone) = private.phone_key('11988772030');
--
-- E, se quiser transcrever o áudio do teste depois:
--
--   update public.messages set transcription_status = 'pendente'
--    where type = 'audio' and transcription is null
--      and transcription_status = 'ignorado'
--      and created_at > now() - interval '2 hours';
