-- ============================================================
-- Permissão de LEITURA de todas as conversas, por pessoa
--
-- Pedido do Gabriel (2026-09-10): *"para o usuário Cibelle Paiva, quero que ela
-- consiga abrir a conversa lá em contatos para visualizar as mensagens."*
--
-- Hoje ela abre a conversa pelo contato (o RPC `contact_conversation` acha o id
-- de propósito, para o botão funcionar mesmo sendo de outro atendente) e o fio
-- vem VAZIO — a RLS de `messages` (0074) só entrega a conversa atribuída a ela
-- ou a fila sem dono do próprio setor. Desde hoje a tela pelo menos explica
-- isso em vez de mostrar uma casca, mas explicar não era o pedido.
--
-- ⚠️ **`sees_all` NÃO resolve, e é por isso que existe coluna nova.** Ele diz
-- "vê os dados dos outros" no sentido de `contacts`/`opportunities`; em
-- conversas, a 0074 recortou de propósito: quem tem `sees_all` vê as suas + a
-- FILA do setor (sem dono), e conversa COM dono é privada do dono — foi um
-- pedido explícito ("ao transferir, tem que sumir").
--
-- ⚠️ **E `colaborativo` (0080) também não**: ele é por DEPARTAMENTO e alcança só
-- os números daquele setor. A Cibelle precisa abrir o contato que ligou, seja
-- qual for o número por onde ele falou.
--
-- Então a permissão é do que ela precisa e nada mais: **ler**. Não assume, não
-- responde, não transfere — para isso continua valendo a regra de todo mundo.
--
-- Idempotente. Aditiva: pode ser aplicada ANTES do merge.
-- ============================================================

alter table public.location_members
  add column if not exists le_todas_conversas boolean not null default false;

/**
 * Esta pessoa pode LER qualquer conversa da empresa?
 *
 * ⚠️ `security definer` porque a policy de `location_members` é por empresa e
 * este helper é chamado de dentro das policies de `conversations`/`messages` —
 * sem definer, avaliar a permissão exigiria ler a tabela sob RLS no meio de
 * outra RLS.
 *
 * ⚠️ Amarra na `location_id` recebida: sem isso, quem tem a marca numa empresa
 * a teria em todas — o erro que a 0080 documenta em `contact_conversation`.
 */
create or replace function private.le_todas_conversas(loc uuid)
returns boolean
language sql
security definer
stable
set search_path = public, private
as $fn$
  select exists (
    select 1
      from public.location_members m
     where m.user_id = (select auth.uid())
       and m.location_id = loc
       and m.le_todas_conversas is true
  );
$fn$;

revoke all on function private.le_todas_conversas(uuid) from public, anon;
grant execute on function private.le_todas_conversas(uuid) to authenticated;

-- ------------------------------------------------------------
-- As policies de LEITURA ganham o ramo novo
-- ------------------------------------------------------------
/*
 * ⚠️ O corpo abaixo é o da **0074**, palavra por palavra, mais UM `or`. As
 * policies de conversas foram recriadas em 0035, 0053, 0062, 0063 e 0074 — cada
 * uma somando uma condição — e reescrever "do zero" aqui perderia
 * `channel_allowed` (setor), `conv_with_bot` (conversa no bot) ou o recorte do
 * pool. Este arquivo só ACRESCENTA.
 *
 * ⚠️ E mexe apenas em SELECT. As de UPDATE/INSERT ficam intocadas: quem lê tudo
 * não passa a responder por ninguém.
 */
drop policy if exists "membros leem" on public.conversations;
create policy "membros leem" on public.conversations
  for select to authenticated
  using (
    location_id in (select private.user_locations())
    and (
      assigned_to = (select auth.uid())
      -- 🔴 O ramo novo: leitura ampla, deliberada e por pessoa.
      or private.le_todas_conversas(location_id)
      or (
        private.sees_all(location_id)
        and private.channel_allowed(location_id, channel_id)
        and (private.is_admin(location_id) or not private.conv_with_bot(id))
        -- não-admin: só o pool (sem dono); admin vê tudo
        and (private.is_admin(location_id) or assigned_to is null)
      )
    )
  );

drop policy if exists "membros leem" on public.messages;
create policy "membros leem" on public.messages
  for select to authenticated
  using (
    location_id in (select private.user_locations())
    and (
      private.conv_assigned_to_me(conversation_id)
      or private.le_todas_conversas(location_id)
      or (
        private.sees_all(location_id)
        and private.channel_allowed(location_id, channel_id)
        and (private.is_admin(location_id) or not private.conv_with_bot(conversation_id))
        and (private.is_admin(location_id) or private.conv_unassigned(conversation_id))
      )
    )
  );

-- ------------------------------------------------------------
-- Liga para a Cibelle
-- ------------------------------------------------------------
/*
 * ⚠️ Por E-MAIL e não por nome: nome repete e muda, e-mail é a identidade que o
 * `auth` usa. Se o `update` disser 0 linhas, o e-mail é outro neste banco — e a
 * permissão fica DESLIGADA, que é o lado seguro.
 */
update public.location_members m
   set le_todas_conversas = true
 where m.user_id in (
   select p.id from public.profiles p where lower(p.email) = 'cibelle@litoaviation.com'
 );

/*
 * ⚠️ **Confira as linhas afetadas.** Zero significa que o e-mail acima não é o
 * dela — descubra com a consulta abaixo e rode o `update` com o certo, em vez de
 * supor que ficou ligado:
 *
 *   select p.id, p.name, p.email, m.le_todas_conversas
 *     from public.profiles p
 *     join public.location_members m on m.user_id = p.id
 *    order by p.name;
 */
