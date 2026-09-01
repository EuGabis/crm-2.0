-- Lito CRM — toda atribuição por PESSOA passa a gravar o motivo
--
-- A 202608281530 pôs um gatilho que escreve no fio um evento a cada mudança de
-- `assigned_to`, no formato:
--
--   Atribuída a <quem> · pelo sistema | por <autor> · <motivo>
--
-- O motivo sai de `conversations.assign_reason`, preenchido na MESMA transação
-- por quem atribui. Os caminhos em TypeScript foram instrumentados; as funções
-- SQL, não. Medido neste banco em 01/09/2026: **29 atribuições por pessoa em 7
-- dias saíram como "motivo não informado"** — o evento dizia QUEM, e não dizia se
-- foi assumir da fila, transferir, supervisionar ou finalizar.
--
-- Foi essa lacuna que obrigou a ler a conversa inteira para descobrir que a
-- atendente tinha ASSUMIDO uma conversa no meio da triagem do bot (caso do
-- contato Marcilio Mattos, 31/08 18:57). Com o motivo, isso é uma linha.
--
-- ⚠️ **O corpo de cada função é o que já estava no banco**, copiado de
-- `pg_get_functiondef`. A única mudança é o `assign_reason` nos `update` que
-- realmente trocam o responsável — mais os `revoke` da seção final. Qualquer
-- outra alteração aqui seria mudança de comportamento disfarçada de correção de
-- log.

-- ── 1. Assumir da fila ──────────────────────────────────────────────────────
create or replace function public.claim_conversation(conv_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
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
     set assigned_to = (select auth.uid()),
         assign_reason = 'assumida da fila'
   where id = conv_id and assigned_to is null;
  return found;
end;
$function$;

-- ── 2. Assumir ao responder ─────────────────────────────────────────────────
create or replace function public.assign_conversation_to_self(conv_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_loc   uuid;
  v_owner uuid;
  v_uid   uuid := (select auth.uid());
begin
  select location_id, assigned_to into v_loc, v_owner
  from public.conversations
  where id = conv_id;

  if v_loc is null or v_loc not in (select private.user_locations()) then
    return false;
  end if;

  -- De OUTRO atendente e eu não sou admin → não posso enviar (nem roubo).
  if v_owner is not null and v_owner <> v_uid and not private.is_admin(v_loc) then
    return false;
  end if;

  if v_owner is null then
    -- Sem dono → ASSUMO (atribuo a mim) + pauso o bot + reabro.
    update public.conversations
       set assigned_to = v_uid,
           assign_reason = 'assumida ao responder',
           bot_paused = true,
           closed_at = null, closed_by = null, archived_at = null, archived_by = null
     where id = conv_id;
  else
    -- Já tem dono (minha, ou de outro com eu sendo admin): NÃO troco o dono —
    -- só pauso o bot e reabro. Admin ajuda sem sequestrar a conversa.
    --
    -- ⚠️ `assign_reason` NÃO é tocado aqui de propósito: o responsável não muda,
    -- então o gatilho não dispara e escrever um motivo novo só deixaria a coluna
    -- descrevendo uma atribuição que não aconteceu.
    update public.conversations
       set bot_paused = true,
           closed_at = null, closed_by = null, archived_at = null, archived_by = null
     where id = conv_id;
  end if;
  return true;
end;
$function$;

-- ── 3. Supervisor assume ────────────────────────────────────────────────────
create or replace function public.take_over_conversation(conv_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_loc uuid;
begin
  /*
   * ⚠️ `npm run db:check` avisa que esta função é `security definer` e não
   * menciona `user_locations`/`is_admin`/`sees_all`. CONFERIDO no banco em
   * 01/09/2026: a checagem está DELEGADA a `private.can_supervise_conv`, que
   * amarra na `location_id` DA CONVERSA — ou `private.is_admin(c.location_id)`,
   * ou membership em `location_members` com `lm.location_id = c.location_id`.
   * A guarda procura o nome da função por palavra-chave, então não vê a
   * delegação; o aviso é falso positivo AQUI e continua valendo em geral.
   */
  if not private.can_supervise_conv(conv_id) then
    return false;
  end if;
  update public.conversations
     set assigned_to = (select auth.uid()),
         assign_reason = 'supervisão assumiu',
         -- Humano assumiu → bot para; e reabre se estava finalizada/arquivada.
         bot_paused = true,
         closed_at = null,
         closed_by = null,
         archived_at = null,
         archived_by = null
   where id = conv_id
   returning location_id into v_loc;
  return v_loc is not null;
end;
$function$;

-- ── 4. Transferir ───────────────────────────────────────────────────────────
create or replace function public.transfer_conversation(conv_id uuid, to_user uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  loc uuid;
  cur uuid;
  cid uuid;
begin
  select location_id, assigned_to, contact_id into loc, cur, cid
  from public.conversations
  where id = conv_id;
  if loc is null then
    return false;
  end if;

  -- Quem pode transferir: o dono atual, admin, ou quem vê tudo do setor.
  if not (
    cur = (select auth.uid())
    or private.is_admin(loc)
    or private.sees_all(loc)
  ) then
    return false;
  end if;

  -- Alvo (se houver) precisa ser membro da mesma empresa.
  if to_user is not null and not exists (
    select 1 from public.location_members m
    where m.user_id = to_user and m.location_id = loc
  ) then
    return false;
  end if;

  -- A conversa vai para o novo atendente. Transferir para NULL é devolver à
  -- caixa do grupo, e o motivo precisa distinguir os dois casos — senão o fio
  -- diz "Devolvida à fila do setor · transferida", que não explica nada.
  update public.conversations
     set assigned_to = to_user,
         assign_reason = case
           when to_user is null then 'devolvida à fila pelo atendente'
           else 'transferida por outra pessoa'
         end
   where id = conv_id;

  -- E TUDO que é do contato migra junto — o lead inteiro passa a ser dele.
  if cid is not null then
    update public.opportunities set owner_id    = to_user where contact_id = cid;
    update public.appointments  set owner_id    = to_user where contact_id = cid;
    update public.tasks         set assignee_id = to_user where contact_id = cid;
    update public.contacts      set owner_id    = to_user where id = cid;
  end if;

  return true;
end;
$function$;

-- ── 5. Finalizar ────────────────────────────────────────────────────────────
create or replace function public.finish_conversation(conv_id uuid, p_done boolean)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_loc uuid;
  v_can boolean;
begin
  select location_id into v_loc from public.conversations where id = conv_id;
  if v_loc is null then return false; end if;

  v_can :=
    private.is_admin(v_loc)
    or exists (select 1 from public.conversations c
               where c.id = conv_id and c.assigned_to = (select auth.uid()))
    or private.can_supervise_conv(conv_id)
    or exists (
      select 1 from public.conversations c
      join public.location_members lm
        on lm.user_id = (select auth.uid()) and lm.location_id = c.location_id
      where c.id = conv_id and c.assigned_to is null
    );
  if not v_can then return false; end if;

  if p_done then
    -- Finalizar SOLTA o responsável (é o que faz a conversa voltar a ser triada
    -- quando o cliente escreve de novo). O gatilho dispara, então o motivo tem
    -- de estar aqui.
    update public.conversations
       set closed_at = now(), closed_by = (select auth.uid()),
           assigned_to = null,
           assign_reason = 'atendimento finalizado'
     where id = conv_id;
  else
    update public.conversations
       set closed_at = null, closed_by = null
     where id = conv_id;
  end if;
  return true;
end;
$function$;

-- ── Privilégios ─────────────────────────────────────────────────────────────
--
-- ⚠️ **Conferido no banco em 01/09/2026: `anon` tinha EXECUTE em
-- `assign_conversation_to_self` e em `take_over_conversation`** — as duas
-- funções que TROCAM o dono da conversa. É o mesmo defeito da 0080, e a causa é
-- o padrão do Postgres: `create function` já concede EXECUTE a PUBLIC, e
-- `create or replace` NÃO reseta grants, então o `revoke` que nunca foi escrito
-- nunca passou a existir.
--
-- O dano era limitado porque as duas checam a empresa/supervisão antes de
-- escrever, e `private.user_locations()` de `anon` é vazio — mas "não vaza
-- porque a guarda interna segura" é rede única. Com o par abaixo, `anon` recebe
-- `42501 permission denied for function`.
--
-- `service_role` mantém o EXECUTE que já tinha: o webhook e o motor de
-- automações chamam com a service role.
revoke execute on function public.claim_conversation(uuid) from public, anon;
revoke execute on function public.assign_conversation_to_self(uuid) from public, anon;
revoke execute on function public.take_over_conversation(uuid) from public, anon;
revoke execute on function public.transfer_conversation(uuid, uuid) from public, anon;
revoke execute on function public.finish_conversation(uuid, boolean) from public, anon;

grant execute on function public.claim_conversation(uuid) to authenticated;
grant execute on function public.assign_conversation_to_self(uuid) to authenticated;
grant execute on function public.take_over_conversation(uuid) to authenticated;
grant execute on function public.transfer_conversation(uuid, uuid) to authenticated;
grant execute on function public.finish_conversation(uuid, boolean) to authenticated;

grant execute on function public.claim_conversation(uuid) to service_role;
grant execute on function public.assign_conversation_to_self(uuid) to service_role;
grant execute on function public.take_over_conversation(uuid) to service_role;
grant execute on function public.transfer_conversation(uuid, uuid) to service_role;
grant execute on function public.finish_conversation(uuid, boolean) to service_role;
