-- ============================================================
-- Transferir para OUTRO atendente deixa a conversa NÃO LIDA para ele
--
-- Pedido do Gabriel (2026-09-09): "ao transferir uma conversa para outro
-- atendente, quero que a conversa apareça para ele como não lida."
--
-- Faz sentido e o defeito é real: quem recebe uma transferência não tem sinal
-- nenhum de que ela chegou. A conversa entra na caixa dele já lida, sem selo e
-- sem entrar no contador de "Não lidos" — ou seja, ela aparece no meio da lista
-- ordenada por última mensagem, indistinguível de tudo o que ele já tratou. O
-- evento no fio só é visto por quem ABRE a conversa, que é justamente o que não
-- vai acontecer.
--
-- ⚠️ Só muda o `update` do responsável. O corpo inteiro é o que já estava no
-- banco (202609041530) — reescrever a lógica junto seria mudança de
-- comportamento disfarçada de correção.
--
-- ⚠️ `npm run db:check` acusa esta função por ser `security definer` sem
-- mencionar `private.user_locations()`. É FALSO POSITIVO e vem desde a
-- 202609041530: a checagem de empresa É a primeira coisa que roda, só que
-- escrita direto contra `location_members` (`user_id = auth.uid() and
-- location_id = loc`) em vez de pela função. Registrado aqui para ninguém
-- reauditar.
--
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

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

  /*
   * Quem pode transferir: QUALQUER membro da empresa (202609041530). Ver e
   * ROTEAR são coisas diferentes — encaminhar para o colega certo é a ação que
   * menos deveria depender de privilégio.
   *
   * Segue `security definer`: sem isso o UPDATE bateria no WITH CHECK da RLS de
   * `conversations`. A checagem de empresa é a primeira coisa que roda (padrão
   * 0049).
   */
  if not exists (
    select 1 from public.location_members m
    where m.user_id = (select auth.uid()) and m.location_id = loc
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

  update public.conversations
     set assigned_to = to_user,
         /*
          * 🔴 A MUDANÇA. Três cuidados, e cada um exclui um caso legítimo:
          *
          * · `to_user is not null` — devolver à FILA não é transferir para um
          *   atendente, e não há "ele" para quem marcar. (⏳ Se um dia se quiser
          *   que a fila do grupo também acenda, é decisão separada: ali o selo
          *   apareceria para o setor inteiro.)
          *
          * · `to_user <> auth.uid()` — ASSUMIR para si não pode marcar como não
          *   lida. Quem assume está com a conversa aberta na tela; acender o
          *   selo para a própria pessoa que acabou de abrir é ruído, e ela
          *   apagaria na hora.
          *
          * · `greatest(..., 1)` e NUNCA `= 1` — a conversa pode ter 9 mensagens
          *   não lidas do cliente, e sobrescrever com 1 apagaria a informação de
          *   quanta coisa está esperando. Só garante o piso.
          */
         unread_count = case
           when to_user is not null and to_user <> (select auth.uid())
             then greatest(coalesce(unread_count, 0), 1)
           else unread_count
         end,
         -- Transferir para NULL é devolver à caixa do grupo, e o motivo precisa
         -- distinguir os dois casos — senão o fio diz "Devolvida à fila do setor
         -- · transferida", que não explica nada.
         assign_reason = case
           when to_user is null then 'devolvida à fila pelo atendente'
           else 'transferida por outra pessoa'
         end
   where id = conv_id;

  /*
   * E TUDO que é do contato migra junto — o lead inteiro passa a ser dele.
   *
   * ⚠️ Cascata INALTERADA, e vale reler antes de mexer: transferir uma conversa
   * reatribui as oportunidades, os compromissos e as tarefas daquele contato, e
   * troca o `contacts.owner_id`. Medido: no máximo 3 oportunidades por contato
   * neste banco, então o alcance de UMA transferência é pequeno e reversível.
   *
   * ⚠️ `contacts.owner_id` tem consequência de SEGUNDA ORDEM: o webhook usa o
   * dono do contato para mandar o cliente direto a quem já o atendeu (quando
   * esse dono é `role = 'user'`). Transferir decide também onde a PRÓXIMA
   * mensagem daquele cliente vai cair.
   */
  if cid is not null then
    update public.opportunities set owner_id    = to_user where contact_id = cid;
    update public.appointments  set owner_id    = to_user where contact_id = cid;
    update public.tasks         set assignee_id = to_user where contact_id = cid;
    update public.contacts      set owner_id    = to_user where id = cid;
  end if;

  return true;
end;
$function$;

-- ⚠️ O par obrigatório: `create function` já concede EXECUTE a PUBLIC, e
-- `create or replace` NÃO reseta grants (o bug da 0080).
revoke execute on function public.transfer_conversation(uuid, uuid) from public, anon;
grant  execute on function public.transfer_conversation(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
