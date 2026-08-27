-- Lito CRM — tira do PUBLIC o EXECUTE das funções de `public`
--
-- Achado pela guarda de migração (`npm run db:audit`) na primeira execução:
-- **17 das 26 funções criadas em `public` recebem `grant execute` e NUNCA
-- `revoke ... from public, anon`**. É o bug da migração 0080 repetido em 17
-- lugares — e o `AGENTS.md` afirmava justamente o contrário, dizendo que as
-- funções das 0047/0048/0078/0079 já faziam o par (não fazem).
--
-- Por que acontece: `create function` no Postgres **já concede EXECUTE a
-- PUBLIC**. Só `grant execute to authenticated` NÃO tira isso — ele adiciona um
-- privilégio, não remove o que veio de graça. Sem o `revoke`, a função é
-- chamável por `anon`, isto é, SEM LOGIN.
--
-- Na 0080 isso vazou de verdade: `public.contact_conversation(<uuid>,
-- 'whatsapp')` devolvia, para quem não estava autenticado, o id da conversa e o
-- atendente atribuído de QUALQUER empresa. As 17 de agora provavelmente
-- devolvem vazio, porque têm a checagem de empresa na primeira linha (padrão
-- 0049) e o `private.user_locations()` de `anon` é vazio. Mas "não vaza porque a
-- guarda interna segura" é rede única: a próxima função escrita sem guarda ganha
-- o vazamento inteiro, e continua sendo CPU gasta com chamada de quem não fez
-- login.

/* ------------------------------------------------------------------ *
 * ⚠️ Por que um laço, e não 17 `revoke` escritos à mão
 *
 * `revoke execute on function public.foo(uuid, text)` exige a assinatura EXATA.
 * Um tipo errado em qualquer uma das 17 derruba a migração inteira — e a lista
 * saiu de leitura ESTÁTICA dos arquivos, sem conferência contra o banco (falta
 * DATABASE_URL no .env.local). O laço lê `pg_proc`, então a assinatura vem do
 * próprio Postgres via `oid::regprocedure` e não há como errar.
 *
 * De quebra fica idempotente e cobre o que a leitura estática não viu: função
 * criada fora de migração, ou que eu tenha contado errado.
 * ------------------------------------------------------------------ */
do $revoke_public$
declare
  r record;
  tem_caminho_proprio boolean;
  n_revogadas int := 0;
  n_puladas   int := 0;
  n_extensao  int := 0;
  oid_auth    oid := to_regrole('authenticated');
  oid_service oid := to_regrole('service_role');
begin
  for r in
    select p.oid,
           p.oid::regprocedure as assinatura,
           p.proacl,
           -- Função que pertence a uma EXTENSÃO fica de fora: mexer no
           -- privilégio dela é mexer no pacote de outra pessoa, e revogar de
           -- PUBLIC pode derrubar operador que o schema todo usa.
           exists (
             select 1 from pg_depend d
              where d.objid = p.oid and d.deptype = 'e'
           ) as de_extensao
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
     order by p.oid::regprocedure::text
  loop
    if r.de_extensao then
      n_extensao := n_extensao + 1;
      continue;
    end if;

    /*
     * ⚠️ **Não revogar às cegas.** Se NINGUÉM além do PUBLIC alcança a função,
     * tirar o PUBLIC a torna inchamável e quebra quem a usa — o oposto do
     * objetivo. A varredura estática achou exatamente um caso assim
     * (`public.ingest_email_event`, da 0010, que nunca recebeu `grant`).
     *
     * `proacl` é NULL quando só valem os privilégios padrão (dono + PUBLIC), e
     * `aclexplode(NULL)` devolve zero linhas — então o NULL cai naturalmente em
     * "sem caminho próprio" e é PULADO, com aviso nomeando a função.
     *
     * Por isso a checagem é no ACL e não em `has_function_privilege`: esta
     * última responde `true` para `authenticated` quando o acesso vem do
     * PUBLIC, que é justo o que se quer distinguir.
     */
    select exists (
      select 1
        from aclexplode(r.proacl) a
       where a.privilege_type = 'EXECUTE'
         and a.grantee in (oid_auth, oid_service)
    ) into tem_caminho_proprio;

    if not tem_caminho_proprio then
      n_puladas := n_puladas + 1;
      raise notice 'PULADA (só o PUBLIC alcança — revogar quebraria): %', r.assinatura;
      continue;
    end if;

    -- `from public, anon`: PUBLIC cobre o privilégio implícito da criação;
    -- `anon` cobre um grant explícito que alguma migração tenha feito.
    execute format('revoke execute on function %s from public, anon', r.assinatura);
    n_revogadas := n_revogadas + 1;
  end loop;

  raise notice '--------------------------------------------';
  raise notice 'revogadas de public+anon : %', n_revogadas;
  raise notice 'puladas (sem outro caminho): %', n_puladas;
  raise notice 'de extensão (intocadas)  : %', n_extensao;
end
$revoke_public$;

/*
 * Confira depois de aplicar — nenhuma linha deve voltar:
 *
 *   select p.oid::regprocedure as funcao
 *     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 *    where n.nspname = 'public'
 *      and has_function_privilege('anon', p.oid, 'execute')
 *      and not exists (select 1 from pg_depend d
 *                       where d.objid = p.oid and d.deptype = 'e')
 *    order by 1;
 *
 * O que voltar aqui é função que o laço PULOU por não ter outro caminho: decida
 * caso a caso se ela precisa de `grant execute to authenticated` (e então o
 * revoke) ou se deve ser chamada só pela service role.
 */
