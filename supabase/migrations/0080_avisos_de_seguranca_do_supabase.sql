-- Lito CRM — avisos do linter de segurança do Supabase
--
-- O painel apontava dois "Security Definer View" como CRITICAL. Investigando a
-- lista completa (`get_advisors`), o achado mais grave era OUTRO: seis funções
-- `security definer` com EXECUTE para PUBLIC — chamáveis pela API REST **sem
-- login**. Conferido como `anon` antes de mexer: a chamada
--
--   select * from public.contact_conversation('<uuid de contato>', 'whatsapp');
--
-- devolvia o id da conversa e o atendente atribuído, de qualquer empresa, para
-- quem não estava autenticado.

-- ---------- 1. Nenhuma função nossa é chamável sem login ----------
-- A causa é o padrão do Postgres: `create function` já concede EXECUTE a PUBLIC,
-- e essas seis não tinham o `revoke`. Não muda nada para o app — as seis são
-- chamadas com a sessão do usuário (`authenticated`), nenhuma com service role
-- (conferido em `db/conversations.ts`, `session-manager.tsx` e na rota
-- `marketing/campaigns/[id]/send`).
--
-- ⚠️ Ao criar função nova em `public`, faça sempre o par
-- `revoke ... from public, anon` + `grant ... to authenticated` — é o que as
-- funções das migrações 0047/0048/0078/0079 já fazem, e por isso elas NÃO
-- apareceram nesta lista.
revoke execute on function public.contact_conversation(uuid, text) from public, anon;
revoke execute on function public.claim_conversation(uuid) from public, anon;
revoke execute on function public.transfer_conversation(uuid, uuid) from public, anon;
revoke execute on function public.touch_presence() from public, anon;
revoke execute on function public.publish_campaign(uuid, text, timestamptz) from public, anon;
revoke execute on function public.add_campaign_recipients(uuid, uuid[]) from public, anon;

grant execute on function public.contact_conversation(uuid, text) to authenticated;
grant execute on function public.claim_conversation(uuid) to authenticated;
grant execute on function public.transfer_conversation(uuid, uuid) to authenticated;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.publish_campaign(uuid, text, timestamptz) to authenticated;
grant execute on function public.add_campaign_recipients(uuid, uuid[]) to authenticated;

-- ---------- 2. `contact_conversation` passa a checar a empresa ----------
-- Ela nasceu sem checagem NENHUMA (nem `auth.uid()`, nem empresa): ignorar a
-- RLS é justamente o propósito dela — o botão "Abrir conversa" do card precisa
-- achar a conversa mesmo que ela seja de outro atendente. Só que "de outro
-- atendente" e "de outra empresa" são coisas diferentes, e sem o filtro de
-- empresa um membro da empresa A resolvia conversa de contato da empresa B.
--
-- O guard preserva a intenção original (dentro da empresa, a RLS continua
-- ignorada) e fecha o vazamento entre empresas. Com o revoke acima, sem sessão
-- `private.user_locations()` volta vazio e a função não devolve nada.
create or replace function public.contact_conversation(cid uuid, chan text default 'whatsapp')
returns table(conv_id uuid, assigned_to uuid)
language sql
stable
security definer
set search_path = public, private
as $function$
  select c.id, c.assigned_to
  from public.conversations c
  where c.contact_id = cid
    and c.channel = chan
    and c.location_id in (select private.user_locations())
  order by c.last_message_at desc nulls last
  limit 1;
$function$;

revoke execute on function public.contact_conversation(uuid, text) from public, anon;
grant execute on function public.contact_conversation(uuid, text) to authenticated;

-- ---------- 3. As duas views apontadas como CRITICAL ----------
-- No Postgres 15+ a view roda com os privilégios de QUEM A CRIOU, a menos que
-- `security_invoker` esteja ligado — é isso que o linter reclama.
--
-- `media_integration_status` (0045) não tem UM consumidor no app: era do Canva,
-- removido em 2026-08-17, e o Google Drive passou a usar o Picker. Ligar o
-- invoker resolve o aviso e o objeto continua no banco, como a 0045 decidiu —
-- se um dia voltar um provedor por OAuth, ele está lá (e aí releia a 0045: a
-- tabela é admin-only, então quem lê o token tem que ser a service role).
alter view public.media_integration_status set (security_invoker = true);

-- ⚠️ `payment_integration_status` é OUTRA história: ligar o invoker nela
-- REINTRODUZ um bug que este projeto já teve DUAS VEZES. `payment_credentials`
-- é admin-only desde a 0008; a view existe exatamente para o usuário comum ver
-- o ESTADO da integração sem alcançar o token. Com invoker, a policy admin-only
-- volta a valer e todo não-admin vê "Guru não conectada" numa empresa conectada.
--
-- Column-level `grant` não resolve: admin e usuário comum são o MESMO role
-- (`authenticated`), e quem os separa é a RLS, que é por linha, não por coluna.
--
-- A saída é a view virar uma casca com invoker ligado sobre uma FUNÇÃO definer
-- que faz a checagem de empresa explicitamente. O linter fica satisfeito (a
-- view não é mais definer), o `db/payments.ts` continua fazendo
-- `.from("payment_integration_status")` — nenhuma mudança no app — e a
-- proteção do token deixa de depender da lista de colunas da view.
create or replace function public.payment_integration_status_rows()
returns table (
  location_id uuid,
  provider text,
  connected_at timestamptz,
  last_synced_at timestamptz,
  history_backfill_cursor timestamptz,
  history_backfill_done boolean,
  contacts_sync_done boolean,
  contacts_total_rows integer
)
language sql
stable
security definer
set search_path = public, private
as $$
  select pc.location_id, pc.provider, pc.created_at, pc.last_synced_at,
         pc.history_backfill_cursor, pc.history_backfill_done,
         pc.contacts_sync_done, pc.contacts_total_rows
  from public.payment_credentials pc
  where pc.location_id in (select private.user_locations());
$$;

revoke execute on function public.payment_integration_status_rows() from public, anon;
grant execute on function public.payment_integration_status_rows() to authenticated, service_role;

create or replace view public.payment_integration_status
with (security_invoker = true) as
  select * from public.payment_integration_status_rows();

revoke all on public.payment_integration_status from anon;
grant select on public.payment_integration_status to authenticated;

-- ---------- 4. search_path da função de deduplicação ----------
-- `alter function` em vez de recriar: o corpo não muda, e reescrevê-lo aqui só
-- criaria a chance de divergir da versão que está aplicada.
alter function private.merge_duplicate_contacts() set search_path = public, private;
