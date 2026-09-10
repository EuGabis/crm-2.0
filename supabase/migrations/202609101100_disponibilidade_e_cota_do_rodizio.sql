-- ============================================================
-- Status "Online / Ausente" do atendente, e a trava da devolução
--
-- Pedidos do Gabriel (2026-09-10), depois de o Paulo logar primeiro e receber os
-- 90 leads que esperavam na fila:
--
--  1) "no comercial temos a regra de distribuir igualmente os leads para todos
--     os vendedores" — resolvido em código (`escolherPorCarga`), sem coluna
--     nova: a cota sai da carga que já está em `conversations`;
--  2) "a regra dos 15 minutos, vamos deixar apenas quando os 3 vendedores
--     estiverem online, e o bot só manda para outro vendedor se o vendedor não
--     mandar a primeira mensagem em 20 minutos";
--  3) "os vendedores ficam no CRM pós expediente para responder os leads, mas
--     não querem receber leads novos" — daí o status.
--
-- ⚠️ **O status separa duas coisas que estavam coladas em `last_seen_at`**:
-- ESTAR NO CRM e QUERER LEAD NOVO. Sem ele, a única forma de parar de receber
-- era fechar o CRM — e aí a pessoa também parava de responder quem já está com
-- ela, que é justamente o que ela ficou para fazer.
--
-- Ordem: **pode ser aplicada ANTES do merge.** Tudo aqui é aditivo, e o código
-- no ar não conhece nenhuma das duas colunas. O código novo, por sua vez,
-- tolera elas não existirem (`disponiveisOrdered` e `devolverInativas` refazem a
-- consulta sem a coluna) — então a ordem não importa nos dois sentidos.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. O status do atendente
-- ------------------------------------------------------------
alter table public.location_members
  add column if not exists disponibilidade text not null default 'online';

/*
 * ⚠️ `check` e não enum: o dia em que entrar um terceiro estado ("em reunião",
 * "almoço"), um enum exigiria `alter type` — que não roda dentro de transação
 * junto com o resto no Postgres antigo e complica a migração inteira.
 *
 * ⚠️ O DEFAULT é 'online', e isso importa: quem nunca tocou no seletor continua
 * recebendo lead exatamente como hoje. Um default 'ausente' pararia o rodízio da
 * empresa inteira no instante em que a coluna nascesse.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'location_members_disponibilidade_valida'
  ) then
    alter table public.location_members
      add constraint location_members_disponibilidade_valida
      check (disponibilidade in ('online', 'ausente'));
  end if;
end;
$$;

/**
 * O próprio atendente muda o seu status.
 *
 * ⚠️ **`security definer` porque a policy de UPDATE de `location_members` é de
 * ADMIN** (a tabela guarda papel, permissões e departamento — quem edita a
 * própria linha editaria o próprio acesso). Sem a função, o vendedor não
 * conseguiria se marcar ausente; com ela, ele muda UMA coluna e só a dele.
 *
 * ⚠️ `auth.uid()` decide a linha — nunca um parâmetro. Recebendo o id de fora,
 * qualquer autenticado marcaria o colega como ausente e o tiraria do rodízio.
 *
 * ⚠️ **`npm run db:check` acusa "definer sem checagem de empresa" aqui, e é
 * FALSO POSITIVO** — está escrito para ninguém reauditar. A guarda procura
 * `user_locations`/`is_admin`/`sees_all`, e esta função não precisa de nenhum:
 * o `where user_id = auth.uid()` já restringe a UMA linha, a de quem chamou.
 * Não há como alcançar outra empresa porque não há como alcançar outra pessoa.
 */
create or replace function public.definir_disponibilidade(p_valor text)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  n int;
begin
  if p_valor is null or p_valor not in ('online', 'ausente') then
    return false;
  end if;
  update public.location_members
     set disponibilidade = p_valor
   where user_id = auth.uid();
  get diagnostics n = row_count;
  -- Devolve se ESCREVEU. `update` que não acha linha não é erro no Postgres, e
  -- a tela diria "salvo" sem ter salvo — a armadilha já documentada em
  -- `removeMessage`.
  return n > 0;
end;
$function$;

/*
 * ⚠️ O par `revoke`/`grant`, e aqui ele tem de citar os TRÊS papéis: neste
 * projeto `pg_default_acl` concede EXECUTE de toda função nova a anon,
 * authenticated e service_role individualmente, então revogar só de
 * `public, anon` deixaria o resto de pé. Quem precisa executar é a tela.
 */
revoke execute on function public.definir_disponibilidade(text) from public, anon, authenticated;
grant execute on function public.definir_disponibilidade(text) to authenticated;

-- ------------------------------------------------------------
-- 2. A devolução só com o time inteiro disponível
-- ------------------------------------------------------------
/*
 * ⚠️ COLUNA, não o nome do setor no código. "Secretaria Backup" é o time
 * comercial e "Secretaria" é a secretaria — casar por nome no runtime já
 * confundiu setor neste projeto (foi assim que o bot da secretaria acabou
 * escrevendo no funil Comercial).
 */
alter table public.departments
  add column if not exists devolver_so_com_todos_online boolean not null default false;

-- ------------------------------------------------------------
-- 3. Dividir igualmente: liga a COTA por atendente
-- ------------------------------------------------------------
/*
 * 🔴 **Por SETOR, e não global.** A regra foi dita para o comercial; ligada em
 * todo mundo, mudaria a Secretaria sem ninguém pedir — e num sentido perigoso:
 * lá o problema que originou o rodízio foi lead PARADO na fila, e a cota é
 * justamente o que segura lead quando falta gente. A proteção da Secretaria
 * contra despejo é outra e já existe: o ritmo (`intervalo_fila_min`, 1 lead a
 * cada 7 min, migração 202609090930).
 *
 * A cota em si não tem coluna: ela sai da carga que já está em `conversations`
 * (conversas abertas atribuídas nos números do setor). Ver `escolherPorCarga`.
 */
alter table public.departments
  add column if not exists dividir_igualmente boolean not null default false;

-- ------------------------------------------------------------
-- 4. A régua nova do comercial: 20 minutos, e só com todos disponíveis
-- ------------------------------------------------------------
/*
 * ⚠️ 20 minutos ÚTEIS, pela mesma `private.business_minutes` de sempre — o
 * relógio congela fora do expediente. É o que faz o "pós expediente" do pedido
 * não virar devolução de madrugada; o status Ausente cobre o resto.
 *
 * ⚠️ A Secretaria FICA em 15: a régua dela nasceu de outra queixa (fila de
 * espera de aluno) e o Gabriel só mudou a do comercial. Um `update` sem `where`
 * teria arrastado as duas para o mesmo número, que é como duas réguas viram uma
 * discussão sobre qual vale.
 */
update public.departments
   set devolver_apos_min = 20,
       devolver_so_com_todos_online = true,
       dividir_igualmente = true
 where name in ('Secretaria Backup', 'Vendas', 'Comercial');

/*
 * Confira as linhas afetadas e o estado final:
 *
 *   select name, usa_rodizio, devolver_apos_min, devolver_so_com_todos_online,
 *          dividir_igualmente, intervalo_fila_min
 *     from public.departments order by name;
 *
 *   select p.name, m.disponibilidade,
 *          round(extract(epoch from (now() - m.last_seen_at))/60.0, 0) as min_atras
 *     from public.location_members m
 *     join public.profiles p on p.id = m.user_id
 *    order by m.disponibilidade, p.name;
 */
