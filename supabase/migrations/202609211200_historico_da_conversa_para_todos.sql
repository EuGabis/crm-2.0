-- Qualquer membro da empresa LÊ o histórico de conversa de um contato, mesmo o
-- que não é dele — somente leitura, pelo visualizador da tela de Contatos.
--
-- Pedido do Gabriel (2026-09-21): *"deixar a opção para os usuários visualizar
-- a conversa, mesmo que não esteja atribuída a ele. Mas só abre o HISTÓRICO da
-- conversa, não a caixa de conversa."*
--
-- ⚠️ **Era uma pendência escrita neste projeto**, na seção "Visualizar conversa
-- e ATIVIDADE": *"conversa que a RLS esconde simplesmente não é listada — um
-- atendente pode ver 'Conversas (1)' num contato que falou por três números, sem
-- nada dizendo que há mais. Contar o que não se pode ler exigiria função
-- security definer."* É esta função.
--
-- 🔴 **LER e ATUAR são coisas diferentes, e é isso que torna a abertura
-- aceitável.** Nada aqui deixa ninguém responder, assumir, transferir, editar
-- ou apagar: quem faz isso são as policies de UPDATE/INSERT de `conversations`
-- e `messages`, que NÃO são tocadas. O visualizador não tem composer — é a
-- separação que o próprio pedido faz ("só o histórico, não a caixa").
--
-- ⚠️ **Isto ALARGA a visibilidade de leitura de propósito, e passa por cima do
-- recorte por número da 0035** (`private.channel_allowed`): um atendente da
-- Secretaria passa a poder ler a conversa que o mesmo contato teve pelo número
-- do Comercial. É o pedido literal ("mesmo que não esteja atribuída a ele"), e o
-- caminho é estreito — sempre a partir de UM contato, nunca uma lista da
-- empresa. A caixa de entrada continua exatamente como está.
--
-- ⚠️ `location_members.le_todas_conversas` (202609110930) NÃO fica redundante:
-- ela abre a CAIXA (ler o fio dentro do inbox, com tudo o que a tela oferece);
-- esta abre só o visualizador de um contato.

begin;

/*
 * ⚠️ `returns setof public.<tabela>` e NÃO `returns table (col …)`.
 *
 * Enumerar as colunas obriga a manter DUAS definições em sincronia — e uma
 * migração que acrescente coluna em `messages` (já aconteceu com transcrição,
 * reações, edição/exclusão) deixaria o visualizador sem ela, ou faria a função
 * falhar com `42804 structure of query does not match function result type`,
 * que é um erro que não diz QUAL coluna divergiu. Com `setof`, o contrato
 * acompanha a tabela sozinho.
 */
create or replace function public.contato_conversas(p_contact uuid)
returns setof public.conversations
language plpgsql
security definer
set search_path to 'public', 'private'
as $fn$
declare
  v_loc uuid;
begin
  /*
   * 🔴 A checagem de empresa é a PRIMEIRA coisa que roda (padrão da 0049). Sem
   * ela, `security definer` significa "qualquer autenticado lê a conversa de
   * qualquer empresa".
   *
   * ⚠️ A empresa sai do CONTATO, nunca de um parâmetro: parâmetro é escolhido
   * por quem chama, e a função estaria conferindo a afirmação de quem pergunta.
   */
  select c.location_id into v_loc from public.contacts c where c.id = p_contact;
  if v_loc is null or v_loc not in (select private.user_locations()) then
    return;
  end if;

  return query
    select cv.*
      from public.conversations cv
     where cv.contact_id = p_contact
       and cv.location_id = v_loc
     order by cv.created_at, cv.id;
end;
$fn$;

/*
 * As mensagens das conversas DESSE contato, numa chamada só.
 *
 * ⚠️ Recebe o contato e não uma lista de conversas: com a lista, quem chama
 * poderia passar o id de uma conversa de outro contato da mesma empresa e a
 * função entregaria — o filtro tem de nascer do mesmo lugar que a autorização.
 */
create or replace function public.contato_mensagens(p_contact uuid)
returns setof public.messages
language plpgsql
security definer
set search_path to 'public', 'private'
as $fn$
declare
  v_loc uuid;
begin
  select c.location_id into v_loc from public.contacts c where c.id = p_contact;
  if v_loc is null or v_loc not in (select private.user_locations()) then
    return;
  end if;

  return query
    select m.*
      from public.messages m
      join public.conversations cv on cv.id = m.conversation_id
     where cv.contact_id = p_contact
       and cv.location_id = v_loc
     order by m.created_at, m.id;
end;
$fn$;

/*
 * ⚠️ O par `revoke` + `grant`, sempre. `create function` concede EXECUTE a
 * PUBLIC por padrão, e neste projeto o `alter default privileges` ainda concede
 * a `anon` DIRETAMENTE — então só o `grant to authenticated` não bastaria: o
 * `anon` continuaria executando. Foi o bug da 0080.
 */
revoke execute on function public.contato_conversas(uuid) from public, anon;
revoke execute on function public.contato_mensagens(uuid) from public, anon;
grant execute on function public.contato_conversas(uuid) to authenticated;
grant execute on function public.contato_mensagens(uuid) to authenticated;

-- O PostgREST cacheia a assinatura das funções; sem isto a primeira chamada
-- responde `PGRST202` (existe no banco, não no cache de esquema).
notify pgrst, 'reload schema';

commit;
