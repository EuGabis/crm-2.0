-- ============================================================
-- Lito CRM — Reivindicar conversa respeita SETOR (canal) e o BOT
--
-- Bug: com contatos universais, qualquer atendente abria o contato de qualquer
-- pessoa e o `claim_conversation` (0067) atribuía a conversa SEM dono a ele —
-- sem checar se o número é do SETOR dele nem se a conversa ainda está com o bot.
-- Resultado: alguém do Comercial (canal 3408) abria e "puxava" um lead que
-- chegou na Secretaria (canal 1599).
--
-- Correção: só é possível assumir uma conversa sem dono quando ela é
--   - da própria empresa,
--   - de um canal do SEU setor (private.channel_allowed), e
--   - NÃO está sendo conduzida pelo bot (essas são distribuídas para o setor
--     certo pelo rodízio, não "puxadas" na mão).
-- Espelha exatamente a regra de visibilidade das conversas (0063) para o caso
-- "sem dono". Reatribuir conversa que já tem dono continua sendo transferência
-- (transfer_conversation), coisa do dono/admin.
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

create or replace function public.claim_conversation(conv_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  loc uuid;
  chan uuid;
begin
  -- Só interessa conversa que existe e está SEM dono.
  select location_id, channel_id into loc, chan
  from public.conversations
  where id = conv_id and assigned_to is null;
  if loc is null then
    return false;
  end if;

  -- Empresa do usuário, canal do setor dele, e fora do bot.
  if not (loc in (select private.user_locations())) then
    return false;
  end if;
  if not private.channel_allowed(loc, chan) then
    return false;
  end if;
  if private.conv_with_bot(conv_id) then
    return false;
  end if;

  update public.conversations
     set assigned_to = (select auth.uid())
   where id = conv_id and assigned_to is null;
  return found;
end;
$$;
revoke all on function public.claim_conversation(uuid) from anon;
grant execute on function public.claim_conversation(uuid) to authenticated;
