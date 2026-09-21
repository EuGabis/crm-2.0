-- O vendedor pode marcar A SI MESMO num contato SEM dono — mas não pode trocar
-- o dono de ninguém.
--
-- Pedido do Gabriel (2026-09-18), na sequência da 202609181500: *"o Paulo
-- conversou e adicionou ele, mas ele não ficou como proprietário. Ele não pode
-- alterar o proprietário, mas ele não pode ficar sem marcar o lead dele como
-- proprietário."*
--
-- 🔴 **Consequência direta da 202609181500, e o defeito é meu.** Aquela migração
-- leu "não pode mudar o proprietário" como "não pode escrever `owner_id`", e com
-- isso derrubou junto o caminho legítimo: o vendedor assumir um contato que não
-- é de ninguém. Medido hoje: o contato Alindromar (criado 10:49, depois de a
-- 202609181500 entrar às 10:23) tem `owner_id` NULO e QUATRO cards do Paulo —
-- ele trouxe o lead, trabalhou o lead, e o CRM não deixou ele assinar embaixo.
--
-- ⚠️ **A distinção que faltava: ALTERAR ≠ ASSUMIR o que não tem dono.**
--   - `NULL → eu`      : assumir um contato órfão. É o trabalho do vendedor.
--   - `alguém → outro` : tirar o contato do colega. É decisão de administrador.
--
-- ⚠️ **SOLTAR o próprio continua sendo de admin, e isso não é rigor gratuito:**
-- sem essa trava a regra seria contornável em dois passos — o Paulo solta, o
-- Alberto assume, e a transferência acontece sem nenhum administrador no meio.

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
   * cron). Nenhum deles tem sessão, e todos precisam poder gravar o dono.
   */
  if auth.uid() is null then
    return new;
  end if;

  /*
   * 🔴 **Assumir um contato SEM dono, para SI MESMO.** As duas condições juntas
   * são o que separa isto de uma transferência disfarçada:
   *   - `old.owner_id is null` — não está tirando de ninguém;
   *   - `new.owner_id = auth.uid()` — está marcando a si, não escolhendo um
   *     terceiro (senão dava para "presentear" o lead a um colega).
   */
  if old.owner_id is null and new.owner_id = auth.uid() then
    return new;
  end if;

  if not private.is_admin(new.location_id) then
    raise exception 'só administradores trocam o proprietário; você pode assumir um contato sem dono'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

commit;
