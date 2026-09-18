-- Só ADMINISTRADOR muda o proprietário do contato.
--
-- Pedido do Gabriel (2026-09-18): *"os usuários que não são administrador estão
-- conseguindo mudar o proprietário do contato, mas apenas administrador pode
-- fazer isso."*
--
-- 🔴 **REVERTE uma decisão minha da 202609111030**, que dizia: *"não é
-- admin-only: a RLS de `contacts` autoriza qualquer membro a editar e
-- transferir conversa também é de qualquer um — travar só a tela daria impressão
-- de proteção sem proteger nada."* O primeiro argumento continua verdadeiro, e é
-- exatamente por isso que esta migração existe: **a tela sozinha não bastaria.**
-- O que mudou foi a REGRA, não o mecanismo — e a regra é do Gabriel.
--
-- ⚠️ **Por que um GATILHO e não uma policy.** A RLS do Postgres é por LINHA, não
-- por coluna: não há como dizer "este usuário pode editar a linha, menos esta
-- coluna". Uma policy de UPDATE que exigisse `is_admin` trancaria o cadastro
-- INTEIRO do contato para quem atende — nome, telefone, etiqueta, DND —, que é o
-- trabalho do dia a dia. O gatilho recusa só a troca de `owner_id`.
--
-- ⚠️ E é o mesmo motivo de `payment_integration_status` ter virado casca sobre
-- função definer (0080): `grant` por coluna também não serve, porque admin e
-- atendente são o MESMO role (`authenticated`) e quem os separa é a RLS.

begin;

create or replace function private.protege_owner_do_contato()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private'
as $fn$
begin
  -- Nada a fazer quando o proprietário não mudou: é o caso de 99% dos updates
  -- (nome, telefone, etiqueta, DND) e eles não podem pagar por esta regra.
  if new.owner_id is not distinct from old.owner_id then
    return new;
  end if;

  /*
   * ⚠️ `auth.uid()` NULO = service role (webhook, bot, rodízio, importação,
   * cron). Nenhum deles tem sessão, e todos precisam poder gravar o dono —
   * `dbContactActions.add` grava no cadastro individual, e a cascata de
   * `transfer_conversation` já não toca aqui desde a 202609111030. Bloquear o
   * sistema junto com o atendente quebraria a criação de contato.
   */
  if auth.uid() is null then
    return new;
  end if;

  if not private.is_admin(new.location_id) then
    raise exception 'apenas administradores podem mudar o proprietário do contato'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

drop trigger if exists protege_owner_do_contato on public.contacts;
create trigger protege_owner_do_contato
  before update on public.contacts
  for each row
  execute function private.protege_owner_do_contato();

-- ⚠️ Função de GATILHO em `private`: o gatilho é o único chamador, então não há
-- `grant` a fazer — o oposto do cuidado das funções de `public`, onde o risco
-- existe porque qualquer autenticado as alcança.

commit;
