-- ============================================================
-- 🔴 O proprietário do lead NÃO segue quem está conversando
--
-- Relato do Gabriel (2026-09-10), com print: *"o comercial fez todas as
-- tratativas e finalizou a negociação. O aluno comprou e passou para o setor da
-- secretaria pra falar sobre documentos, mas o proprietário está com o
-- responsável da conversa. O proprietário é o comercial Rogerio, mas esse
-- contato pode estar conversando com outro."*
--
-- A última frase é a regra inteira: **propriedade e "quem conversa agora" são
-- coisas diferentes.** Uma venda fechada tem um vendedor; passar o aluno para a
-- Secretaria falar de documentos é atendimento, não troca de dono.
--
-- ⚠️ **Dois caminhos gravavam o proprietário seguindo a conversa, e os dois
-- foram fechados** — este arquivo cuida do segundo:
--
--  1. `assignLeadTo` (TypeScript) reescrevia o dono do card de intake a CADA
--     atribuição da conversa (bot, rodízio, devolução, varredura, botão do
--     admin). Foi o que agiu no caso do print: o aluno escreveu para o número da
--     Secretaria, ou seja conversa NOVA, triada pelo bot e distribuída — e por
--     isso o card do Comercial continuou com o vendedor e o de intake virou o
--     atendente. Corrigido em `podeTrocarDonoDoCard`.
--  2. **a cascata desta função**, que reatribuía TODAS as oportunidades do
--     contato, em TODOS os funis, mais o `contacts.owner_id`. Não foi ela neste
--     caso, mas produz o mesmo sintoma na primeira transferência — e o pedido é
--     sobre a regra, não sobre um contato.
--
-- 🔴 **Isto REVERTE uma decisão anterior** (0071 "transfer leva o card" e 0072
-- "transferir leva o lead inteiro"), e não é bug de quem pediu: naquele momento
-- transferência era roteamento DENTRO da Secretaria, onde mover o lead junto é o
-- certo. Desde a 202609041530 qualquer um transfere para qualquer setor, e aí a
-- mesma cascata passou a atravessar o comercial.
--
-- ⚠️ **Compromissos e tarefas CONTINUAM migrando** (escolha do Gabriel): são
-- pendências de TRABALHO, não propriedade — quem assume o atendimento herda a
-- tarefa e o compromisso daquele contato.
--
-- ⚠️ **Conferido que a rota do cliente NÃO quebra:** o webhook só usa
-- `contacts.owner_id` quando CRIA a conversa (o ramo do insert em
-- `api/whatsapp/webhook/route.ts`), e só quando o número não tem bot. Manter o
-- vendedor como dono do contato não desvia a conversa de documentos de quem está
-- atendendo; e no dia em que aquele cliente escrever para um número SEM bot,
-- cair com o vendedor dele é exatamente a intenção original ("o cliente volta e
-- cai com quem já o atendia").
--
-- Substitui função existente com a MESMA assinatura, e o cliente já a chamava:
-- pode ser aplicada ANTES ou DEPOIS do merge, sem ordem.
--
-- ⚠️ `npm run db:check` acusa "definer sem checagem de empresa" aqui, e é FALSO
-- POSITIVO — o mesmo da 202609091100, que tem este corpo. A guarda existe e é a
-- primeira coisa que roda depois de ler a linha: o `not exists` em
-- `location_members` com `m.location_id = loc`. A regra procura
-- `user_locations`/`is_admin`/`sees_all` pelo nome, e esta função confere a
-- membresia direto na tabela. Está escrito aqui para ninguém reauditar.
-- ============================================================

/*
 * ⚠️ O corpo é o da **202609091100** palavra por palavra, MENOS dois updates. O
 * corpo desta função foi reescrito em 0070, 0071, 0072, 202609011300,
 * 202609041530 e 202609091100 — cada um somando uma coisa —, então reescrever
 * "do zero" perderia o portão de membro (202609041530), o motivo por caso ou o
 * piso de não lidas (202609091100).
 */
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
          * Piso de não lidas (202609091100). Três cuidados, cada um excluindo um
          * caso legítimo: devolver à fila não tem "ele" para marcar; assumir
          * para si não pode acender selo para quem está com a tela aberta; e
          * `greatest` nunca vira `= 1`, senão 9 mensagens esperando viram 1.
          */
         unread_count = case
           when to_user is not null and to_user <> (select auth.uid())
             then greatest(coalesce(unread_count, 0), 1)
           else unread_count
         end,
         assign_reason = case
           when to_user is null then 'devolvida à fila pelo atendente'
           else 'transferida por outra pessoa'
         end
   where id = conv_id;

  /*
   * 🔴 **As PENDÊNCIAS migram; a PROPRIEDADE não.**
   *
   * Saíram daqui, e cada uma por um motivo próprio:
   *
   *   update public.opportunities set owner_id = to_user where contact_id = cid;
   *     ⚠️ Reatribuía o card em TODOS os funis — inclusive a venda fechada no
   *     Comercial, que é de onde sai o "Ganhos por atendente" do relatório. Uma
   *     transferência para a Secretaria apagava quem vendeu.
   *
   *   update public.contacts set owner_id = to_user where id = cid;
   *     ⚠️ `contacts.owner_id` já tinha sido diagnosticado neste projeto como
   *     "NÃO é o atendente responsável" (o bug de 2026-08-26, em que a
   *     importação deixou admins donos de 32 mil contatos). Fazê-lo seguir a
   *     transferência era reintroduzir a mesma confusão por outra porta.
   *
   * O que FICA, por escolha do Gabriel: compromisso e tarefa são trabalho a
   * fazer, e quem assume o atendimento assume a pendência.
   */
  if cid is not null then
    update public.appointments set owner_id    = to_user where contact_id = cid;
    update public.tasks        set assignee_id = to_user where contact_id = cid;
  end if;

  return true;
end;
$function$;

-- ⚠️ O par obrigatório: `create function` já concede EXECUTE a PUBLIC, e
-- `create or replace` NÃO reseta grants (o bug da 0080).
revoke execute on function public.transfer_conversation(uuid, uuid) from public, anon;
grant  execute on function public.transfer_conversation(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

/*
 * ⚠️ **NÃO há retroativo aqui, de propósito.** Para consertar o que a cascata já
 * reescreveu seria preciso saber quem era o dono ANTES — e isso não está gravado
 * em lugar nenhum, porque o update sobrescreveu. Adivinhar por semelhança é a
 * chave fraca que este projeto já recusou no cruzamento com a Guru: carimbar o
 * proprietário errado é pior do que o campo estar errado hoje, porque a partir
 * dali ninguém mais duvida dele.
 *
 * O caminho é VER as divergências e corrigir à mão as que importam — o dono do
 * card no seletor da oportunidade, e o dono do contato no cabeçalho do contato
 * (que passou a ser editável neste mesmo PR).
 *
 *   -- Contatos cujo dono divirja do dono de algum card de venda do próprio
 *   -- contato: os candidatos a ter sido reescrito por transferência.
 *   select ct.id, ct.first_name, ct.last_name,
 *          dono.name as dono_do_contato,
 *          string_agg(distinct pl.name || ' -> ' || coalesce(op.name, '(sem dono)'), ', ')
 *            as cards
 *     from public.contacts ct
 *     join public.opportunities o  on o.contact_id = ct.id
 *     join public.pipelines pl     on pl.id = o.pipeline_id
 *     left join public.profiles op on op.id = o.owner_id
 *     left join public.profiles dono on dono.id = ct.owner_id
 *    where ct.owner_id is not null
 *      and o.owner_id is not null
 *      and o.owner_id <> ct.owner_id
 *    group by ct.id, ct.first_name, ct.last_name, dono.name
 *    order by 2
 *    limit 50;
 */
