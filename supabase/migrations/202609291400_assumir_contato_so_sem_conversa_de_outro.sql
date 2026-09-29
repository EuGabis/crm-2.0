-- Assumir contato sem dono NÃO vale quando a conversa dele está com OUTRA pessoa.
--
-- Relato do Gabriel (2026-09-29): o lead Thomas Freitas caiu hoje e o rodízio o
-- entregou ao Alberto; o Paulo abriu o contato, clicou em "marcar como meu" e
-- virou o proprietário de um lead que estava sendo atendido por um colega.
--
-- A regra `NULL → eu` (202609181800) existe para o vendedor assinar embaixo do
-- lead que ELE trouxe. Contato sem dono cuja conversa aberta está com outra
-- pessoa não é "de ninguém": é trabalho em andamento do colega, e assumi-lo é a
-- transferência disfarçada que a 202609181500 proíbe.
--
-- ⚠️ Só a conversa ABERTA (não finalizada, não arquivada) conta: conversa
-- encerrada solta o responsável (0092) e não prende o contato a ninguém.
-- ⚠️ Admin e service role continuam livres (as regras abaixo não mudam).
-- ⚠️ Não corrige o que já foi assumido: o admin troca no seletor do contato.

begin;

create or replace function private.protege_owner_do_contato()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private'
as $fn$
begin
  if new.owner_id is not distinct from old.owner_id then
    return new;
  end if;

  -- service role (webhook, bot, rodízio, importação): sem sessão, grava livre.
  if auth.uid() is null then
    return new;
  end if;

  if private.is_admin(new.location_id) then
    return new;
  end if;

  -- Assumir para si um contato sem dono — desde que a conversa aberta dele não
  -- esteja com outra pessoa.
  if old.owner_id is null and new.owner_id = auth.uid() then
    if exists (
      select 1 from public.conversations c
       where c.contact_id = new.id
         and c.assigned_to is not null
         and c.assigned_to <> auth.uid()
         and c.closed_at is null
         and c.archived_at is null
    ) then
      raise exception 'a conversa deste contato está com outro atendente — peça ao administrador para definir o proprietário'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Soltar o PRÓPRIO contato (202609211210).
  if old.owner_id = auth.uid() and new.owner_id is null then
    return new;
  end if;

  raise exception 'só administradores trocam o proprietário; você pode assumir um contato sem dono ou se desvincular do seu'
    using errcode = '42501';
end;
$fn$;

commit;

-- Para ver quem assumiu contato cuja conversa aberta está com outra pessoa:
-- select ct.id, ct.first_name, ct.last_name, po.name as proprietario, pa.name as atendente
--   from public.contacts ct
--   join public.conversations c on c.contact_id = ct.id
--    and c.closed_at is null and c.archived_at is null
--    and c.assigned_to is not null and c.assigned_to <> ct.owner_id
--   join public.profiles po on po.id = ct.owner_id
--   join public.profiles pa on pa.id = c.assigned_to
--  where ct.created_at > now() - interval '7 days';
