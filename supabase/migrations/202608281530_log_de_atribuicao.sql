-- Lito CRM — toda mudança de responsável deixa rastro no fio
--
-- Relato (2026-08-28): "alguns clientes estão caindo direto para o atendente sem
-- finalizar com o bot". O print mostrava a conversa do Cesar com o bot no meio da
-- triagem (pediu o nome, o cliente respondeu) e **já atribuída a uma atendente**
-- — sem nenhum evento no fio dizendo quem atribuiu, nem por quê.
--
-- ⚠️ **Não deu para responder "por que foi para ela" olhando o código**, e essa é
-- a descoberta que motiva esta migração: o CRM troca o responsável de uma conversa
-- por pelo menos OITO caminhos, e só DOIS deixavam rastro.
--
--   registram evento:  assignLeadTo (rodízio) · devolução por espera
--   NÃO registravam:   transfer_conversation (0070) · claim_conversation (0073)
--                      take_over_conversation (0080) · get_conversation (0086)
--                      assign_conversation_to_self (0087) · finish_conversation (0092)
--                      webhook: dono do contato · webhook: reabertura com humano
--
-- Investigar isso caminho por caminho é o método que já se provou caro neste
-- projeto (doze rodadas no áudio recusado pela Meta). O conserto é instrumentar,
-- não adivinhar.

-- ---------- Por que veio ----------
-- Coluna preenchida por quem atribui, na MESMA transação da atribuição. Quem não
-- preencher gera evento dizendo "motivo não informado", que é informação útil:
-- aponta exatamente o caminho que ainda falta instrumentar.
alter table public.conversations
  add column if not exists assign_reason text;

/*
 * ⚠️ **GATILHO, e não um `insert` em cada função.** É a mesma decisão da
 * transcrição de áudio (0085): "quem enfileira é um TRIGGER, não quem insere —
 * áudio entra por quatro caminhos e o quinto que alguém criar amanhã
 * esqueceria". Aqui são OITO caminhos, dois deles em TypeScript e seis em SQL;
 * corrigir um por um deixaria o próximo de fora, e o próximo é justamente o que
 * vai causar a dúvida da próxima vez.
 *
 * `security definer` porque `messages` tem RLS e o gatilho precisa gravar
 * independentemente de quem disparou a atribuição — inclusive o webhook, que roda
 * com a service role, e o pg_cron.
 */
create or replace function private.log_atribuicao()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $fn$
declare
  v_nome  text;
  v_autor text;
  v_texto text;
begin
  -- Só reage à mudança de responsável. `is distinct from` e não `<>`: null está
  -- dos dois lados do problema (atribuir a partir da fila, e devolver para ela).
  if new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;

  if new.assigned_to is null then
    v_texto := 'Devolvida à fila do setor';
  else
    select p.name into v_nome from public.profiles p where p.id = new.assigned_to;
    v_texto := 'Atribuída a ' || coalesce(v_nome, 'atendente');
    if new.assigned_offline then
      v_texto := v_texto || ' (estava offline)';
    end if;
  end if;

  -- Quem fez. `auth.uid()` é null no webhook e no cron — e "pelo sistema" é a
  -- informação certa nesse caso, não uma lacuna.
  select p.name into v_autor
    from public.profiles p
   where p.id = (select auth.uid());
  v_texto := v_texto || ' · ' || coalesce(v_autor, 'pelo sistema');

  v_texto := v_texto || ' · ' || coalesce(new.assign_reason, 'motivo não informado');

  insert into public.messages (location_id, conversation_id, direction, type, channel, body)
  values (new.location_id, new.id, 'out', 'event', coalesce(new.channel, 'whatsapp'), v_texto);

  return new;
end
$fn$;

drop trigger if exists log_atribuicao on public.conversations;
create trigger log_atribuicao
  after update of assigned_to on public.conversations
  for each row
  execute function private.log_atribuicao();

/*
 * ⚠️ A função fica em `private` e o gatilho é o único chamador — não há
 * `grant` a fazer, e o schema `private` não é exposto na API. É o par oposto do
 * cuidado das funções de `public` (revoke de PUBLIC/anon): aqui o problema não
 * existe porque ninguém alcança o schema.
 */
