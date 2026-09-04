-- Lito CRM — qualquer atendente pode transferir a conversa, para qualquer colega
--
-- Regra do Gabriel (04/09/2026): "qualquer usuário poder transferir para o
-- outro, mesmo que esteja em número diferente ou setor diferente".
--
-- O caso que trouxe isso: o Paulo (departamento "Secretaria Backup", vinculado
-- só ao número Backup Secretaria) tentou encaminhar uma conversa do número
-- **Secretaria Principal** e recebeu "Não foi possível alterar o responsável".
-- Não era defeito: era o portão desta função.
--
--   -- Quem pode transferir: o dono atual, admin, ou quem vê tudo do setor.
--   if not (cur = auth.uid() or private.is_admin(loc) or private.sees_all(loc))
--
-- ⚠️ `private.sees_all(loc)` é FALSO para quem tem `only_assigned = true`, e são
-- exatamente os três do time de vendas (Paulo, Alberto, Rogério) — os únicos da
-- empresa nessa condição. Então, para eles, transferir só funcionava na conversa
-- que já era deles. Que é o oposto do que a operação precisa: quem recebe algo
-- que não é do seu setor tem de poder ROTEAR.
--
-- O portão passa a ser só **ser membro da empresa**. Continua sendo `security
-- definer` e continua exigindo que o ALVO seja da mesma empresa — o que a
-- mudança abre é entre setores/números, não entre empresas.

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
   * Quem pode transferir: QUALQUER membro da empresa.
   *
   * ⚠️ O `private.sees_all(loc)` saiu daqui de propósito, e é a mudança inteira.
   * Ele existe para dizer "esta pessoa vê os dados dos outros" — e ver e ROTEAR
   * são coisas diferentes. Encaminhar para o colega certo é a ação que menos
   * deveria depender de privilégio: quem recebeu algo que não é do seu setor
   * precisa justamente poder passar adiante.
   *
   * ⚠️ Segue `security definer`: sem isso o UPDATE bateria no WITH CHECK da RLS
   * de `conversations` (a linha nova, com outro dono, é recusada). A checagem de
   * empresa é a primeira coisa que roda (padrão 0049) — sem ela, definer
   * significaria "qualquer autenticado transfere conversa de qualquer empresa".
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

  /*
   * E TUDO que é do contato migra junto — o lead inteiro passa a ser dele.
   *
   * ⚠️ **Esta cascata NÃO mudou, mas o portão aberto a torna alcançável por
   * qualquer atendente**, e isso precisa estar dito em algum lugar: transferir
   * uma conversa reatribui também as oportunidades, os compromissos e as tarefas
   * daquele contato, e troca o `contacts.owner_id`.
   *
   * Medido antes de abrir: no máximo **3 oportunidades por contato** neste banco,
   * então o alcance de UMA transferência é pequeno e reversível (basta
   * transferir de volta). Foi o que fez a cascata continuar como está em vez de
   * ser recortada junto — recortar mudaria o comportamento de todo mundo para
   * resolver um problema que a medição diz não existir.
   *
   * ⚠️ `contacts.owner_id` tem uma consequência de SEGUNDA ORDEM que vale
   * conhecer: o webhook usa o dono do contato para mandar o cliente direto a
   * quem já o atendeu (quando esse dono é `role = 'user'`). Ou seja, transferir
   * hoje decide também onde a PRÓXIMA mensagem daquele cliente vai cair. Aqui
   * isso é desejável e coerente com a regra nova — mas é efeito, não acaso.
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
-- `create or replace` NÃO reseta grants (o bug da 0080). Conferido antes: `anon`
-- já não tinha EXECUTE aqui, e continua sem.
revoke execute on function public.transfer_conversation(uuid, uuid) from public, anon;
grant  execute on function public.transfer_conversation(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
