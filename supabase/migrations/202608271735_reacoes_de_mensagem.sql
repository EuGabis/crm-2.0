-- Lito CRM — reação de mensagem (emoji), como no WhatsApp
--
-- Sintoma: quando o contato reagia a uma mensagem, o CRM mostrava uma BOLHA com
-- o texto `[reaction]` — solta no fio, sem o emoji e sem dizer a qual mensagem
-- se referia. Causa: o webhook não conhece o tipo `reaction` e caía no `else`
-- genérico (`body = '[' || tipo || ']'`).
--
-- ⚠️ **Reação NÃO é mensagem, é atributo da mensagem reagida.** No WhatsApp ela
-- aparece colada no balão de destino, e é isso que a torna legível: uma bolha
-- separada não diz a que se refere nem quando some (reagir e desreagir é a mesma
-- operação com emoji vazio). Guardar como linha em `messages` produziria fio
-- poluído e uma bolha órfã por cada des-reação.
--
-- Por isso: coluna na mensagem de DESTINO, não tabela nova. Reação é conjunto
-- pequeno e limitado por mensagem (uma por pessoa, e conversa de WhatsApp é 1:1),
-- então tabela própria só acrescentaria join, RLS e migração para guardar o que
-- cabe num jsonb.

alter table public.messages add column if not exists reactions jsonb;

/*
 * Aplica ou remove a reação, de forma ATÔMICA.
 *
 * ⚠️ Em função e não em TypeScript no webhook porque isto é
 * ler-modificar-escrever num jsonb: reagir e desreagir rápido (ou duas pessoas
 * num grupo) são dois webhooks concorrentes, e no código a segunda escrita
 * apagaria a primeira. Mesmo motivo de `log_conversation_event` e
 * `save_handoff_summary` existirem como função.
 *
 * `p_emoji` vazio = REMOVER a reação de `p_by` (é assim que o WhatsApp comunica
 * "desreagiu": o mesmo evento com o campo vazio).
 *
 * Devolve o id da mensagem afetada, ou NULL quando o destino não existe aqui —
 * reação a mensagem anterior à integração, por exemplo. O chamador usa isso para
 * logar em vez de falhar.
 */
create or replace function public.set_message_reaction(
  p_location uuid,
  p_target_wa_id text,
  p_emoji text,
  p_by text,
  p_at timestamptz
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_id uuid;
  v_reacoes jsonb;
begin
  select m.id, coalesce(m.reactions, '[]'::jsonb)
    into v_id, v_reacoes
    from public.messages m
   where m.location_id = p_location
     and m.wa_message_id = p_target_wa_id
   limit 1;

  if v_id is null then
    return null;
  end if;

  -- UMA reação por pessoa: a nova substitui a anterior da mesma origem, que é a
  -- semântica do WhatsApp (trocar o emoji não empilha dois).
  v_reacoes := coalesce(
    (select jsonb_agg(e)
       from jsonb_array_elements(v_reacoes) e
      where e->>'by' is distinct from p_by),
    '[]'::jsonb
  );

  if coalesce(btrim(p_emoji), '') <> '' then
    v_reacoes := v_reacoes || jsonb_build_object('emoji', p_emoji, 'by', p_by, 'at', p_at);
  end if;

  update public.messages
     -- NULL quando não sobra nenhuma: `[]` e `null` renderizariam igual, e nulo
     -- deixa o índice/consulta "tem reação?" trivial.
     set reactions = case when jsonb_array_length(v_reacoes) = 0 then null else v_reacoes end
   where id = v_id;

  return v_id;
end
$fn$;

/*
 * ⚠️ O par revoke+grant é obrigatório: `create function` já concede EXECUTE a
 * PUBLIC, e só o grant não tira isso (foi o achado que gerou a 0080 e a
 * 202608271044). Aqui quem chama é o WEBHOOK, com a service role — `authenticated`
 * NÃO recebe, porque nenhuma tela do CRM envia reação hoje. No dia em que enviar,
 * a função vai precisar de checagem de empresa antes do grant.
 */
revoke execute on function public.set_message_reaction(uuid, text, text, text, timestamptz)
  from public, anon;
grant execute on function public.set_message_reaction(uuid, text, text, text, timestamptz)
  to service_role;

/*
 * ⚠️ Limpa as bolhas `[reaction]` que o bug já gravou.
 *
 * Critério ESTREITO: só mensagem de ENTRADA, tipo texto, com corpo exatamente
 * `[reaction]` — string que só o `else` genérico do nosso webhook produz.
 *
 * Por que APAGAR e não converter: a linha nunca guardou o emoji nem o
 * `message_id` de destino, então não há o que recuperar. `[reaction]` sozinho não
 * informa nada, e é justamente a bolha de que o Gabriel reclamou. Apagar remove
 * ruído sem perder informação — mas é irreversível, e está dito aqui para quem
 * revisar poder discordar antes de aplicar.
 */
delete from public.messages
 where direction = 'in'
   and type = 'text'
   and body = '[reaction]';
