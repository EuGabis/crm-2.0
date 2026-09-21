-- O proprietário pode SE DESVINCULAR do próprio contato.
--
-- Pedido do Gabriel (2026-09-21): *"a opção do proprietário se desvincular do
-- contato, pois ele pode querer tirar aquele contato da fila dele e não querer
-- ser mais o proprietário."*
--
-- 🔴 **Reverte uma decisão MINHA da 202609181800, e de olhos abertos.** Aquele
-- arquivo travou `eu → NULL` com este argumento, que continua verdadeiro:
--
--   > sem essa trava a regra seria contornável em dois passos — o Paulo solta,
--   > o Alberto assume, e a transferência acontece sem nenhum administrador no
--   > meio.
--
-- ⚠️ O buraco é REAL e volta a existir. O que mudou é o peso do outro lado: o
-- caso de uso legítimo (largar um contato que não é meu trabalho) é do dia a
-- dia, e a alternativa era o vendedor abrir chamado com o administrador para
-- cada lead que não é dele. Passar a carteira ao colega por dois passos
-- combinados é possível — mas exige os DOIS querendo, e não é mais barato do
-- que pedir ao administrador. Com a trava, o caso comum pagava pelo raro.
--
-- ⚠️ **O que NÃO abre, e é o que mantém a 202609181500 de pé:**
--   - `alguém → outro`  : escolher o dono de um terceiro — só admin;
--   - `outro → NULL`    : soltar o contato DO COLEGA — só admin. Sem isso,
--                         "desvincular" seria um jeito indireto de tirar a
--                         carteira de quem está trabalhando.

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

  /*
   * 🔴 **Soltar o PRÓPRIO contato.** Também aqui as duas condições andam
   * juntas: é o meu contato (`old.owner_id = auth.uid()`) e ele fica SEM dono
   * (`new.owner_id is null`). Largar para a fila do grupo é diferente de
   * escolher o próximo dono — esta segunda continua sendo de administrador.
   */
  if old.owner_id = auth.uid() and new.owner_id is null then
    return new;
  end if;

  if not private.is_admin(new.location_id) then
    raise exception 'só administradores trocam o proprietário; você pode assumir um contato sem dono ou se desvincular do seu'
      using errcode = '42501';
  end if;

  return new;
end;
$fn$;

commit;
