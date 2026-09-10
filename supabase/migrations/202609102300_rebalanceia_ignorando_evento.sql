-- ============================================================
-- 🔴 As DUAS redistribuições de hoje foram NO-OP. Esta é a causa da segunda.
--
-- Relato do Gabriel: *"o Paulo ainda continua com a disparidade de leads"*,
-- depois de aplicar a 202609102030.
--
-- **A pílula cinza contava como resposta humana.** O critério "ninguém
-- respondeu" que eu escrevi nas duas migrações é:
--
--     not exists (select 1 from messages
--                  where conversation_id = cv.id and direction = 'out'
--                    and coalesce(automated, false) = false
--                    and coalesce(internal,  false) = false)
--
-- ⚠️ Falta `type <> 'event'`. E os EVENTOS do fio ("Atribuída a X · pelo
-- sistema · rodízio do bot") são inseridos exatamente assim — `direction = 'out'`,
-- `type = 'event'`, **sem `automated`** — pelo gatilho `log_atribuicao`
-- (202608281530) e pelo `botLogEvent` do motor.
--
-- Ou seja: **toda conversa que o rodízio já tocou tem um desses**, o `not exists`
-- dava falso em todas, e o `update` casou ZERO linhas. Nas duas vezes.
--
-- 🔴 **E eu tinha o predicado CERTO ao lado.** `conversas_paradas`
-- (202609081345, 202609101830) exclui `type = 'event'` — com comentário
-- explicando. Eu reescrevi a mesma pergunta em outro arquivo em vez de reusar, e
-- as duas cópias divergiram na primeira linha que importava. É o erro que este
-- repositório documenta desde a primeira semana, agora cometido por mim três
-- vezes num dia: **duas definições da mesma pergunta divergem.**
--
-- Por isso aqui a pergunta ganha UM lugar: `private.respondida_por_humano`.
-- ============================================================
set check_function_bodies = off;

/**
 * Alguém RESPONDEU esta conversa? (a definição canônica)
 *
 * ⚠️ Três exclusões, e cada uma já causou defeito:
 *  · `automated` — a resposta do BOT não é atendimento; contá-la faria toda
 *    conversa parecer atendida em segundos pelo auto-responder (0079);
 *  · `internal`  — nota interna não sai do CRM;
 *  · **`type = 'event'`** — a pílula cinza do fio é `direction = 'out'` e não
 *    tem `automated`. É a que faltava, e é a que zerou as duas redistribuições
 *    de 2026-09-10.
 *
 * `stable` e não `immutable`: lê tabela. Usada em `where`, então o índice por
 * `conversation_id` de `messages` é o que a mantém barata.
 */
create or replace function private.respondida_por_humano(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $fn$
  select exists (
    select 1
      from public.messages m
     where m.conversation_id = p_conv
       and m.direction = 'out'
       and coalesce(m.automated, false) = false
       and coalesce(m.internal, false) = false
       and coalesce(m.type, '') <> 'event'
  );
$fn$;

-- Mora em `private` (não exposto na API) e o único chamador é SQL nosso — não há
-- `grant` a fazer, o oposto do cuidado das funções de `public`.
revoke execute on function private.respondida_por_humano(uuid) from public, anon, authenticated;

/*
 * ---------------------- ENSAIO (não altera nada) ----------------------
 *
 * select p.name,
 *        count(*) as abertas,
 *        count(*) filter (where cv.assigned_by is null) as pelo_sistema,
 *        count(*) filter (
 *          where cv.assigned_by is null
 *            and not private.respondida_por_humano(cv.id)
 *        ) as elegiveis
 *   from public.conversations cv
 *   join public.profiles p on p.id = cv.assigned_to
 *   join public.department_channels dc on dc.channel_id = cv.channel_id
 *   join public.departments d on d.id = dc.department_id
 *  where d.name in ('Secretaria Backup', 'Vendas', 'Comercial')
 *    and cv.closed_at is null and cv.archived_at is null
 *  group by 1 order by 2 desc;
 *
 * ⚠️ Agora `elegiveis` deve ser um número ALTO para o Paulo. Nas tentativas
 * anteriores ele era zero — e zero linhas afetadas sem erro nenhum é
 * exatamente o que fez as duas migrações passarem por bem-sucedidas.
 */

do $$
declare
  d record;
  n_pool int;
  movidas int;
  total int := 0;
  linha record;
begin
  for d in
    select dep.id, dep.location_id, dep.name,
           coalesce(
             nullif(dep.lead_pool, '{}'::uuid[]),
             array(
               select m.user_id from public.location_members m
                where m.department_id = dep.id order by m.user_id
             )
           ) as pool
      from public.departments dep
     -- Igualdade exata: "Secretaria Backup" é o time comercial, "Secretaria" é a
     -- secretaria — e esta fica FORA, o pedido é sobre o comercial.
     where dep.name in ('Secretaria Backup', 'Vendas', 'Comercial')
       and dep.usa_rodizio is true
  loop
    n_pool := coalesce(array_length(d.pool, 1), 0);
    if n_pool < 2 then
      continue;
    end if;

    with alvo as (
      select cv.id,
             -- Round-robin por quem espera há mais tempo. Determinístico: mesmo
             -- conjunto e mesmo pool dão o mesmo resultado, então reexecutar não
             -- embaralha.
             ((row_number() over (order by cv.last_message_at nulls last, cv.id) - 1)
               % n_pool) + 1 as fatia
        from public.conversations cv
       where cv.location_id = d.location_id
         and cv.channel_id in (
           select dc.channel_id from public.department_channels dc
            where dc.department_id = d.id
         )
         and cv.assigned_to is not null
         -- O SISTEMA atribuiu. Decisão de PESSOA não se desfaz (princípio da
         -- 0090): protege o que um colega transferiu ou alguém assumiu à mão.
         and cv.assigned_by is null
         and cv.closed_at is null
         and cv.archived_at is null
         -- Carência: lead entregue há minutos está sendo lido agora.
         and cv.last_message_at < now() - interval '30 minutes'
         -- 🔴 A pergunta, agora num lugar só.
         and not private.respondida_por_humano(cv.id)
    )
    update public.conversations cv
       set assigned_to = d.pool[alvo.fatia],
           assign_reason = 'rebalanceamento dos leads não atendidos (10/09 23h)',
           -- Episódio novo: carimbo antigo bloquearia a primeira devolução
           -- legítima do dono novo. E `atribuida_em` é regravada pelo gatilho
           -- (202609101830), então cada um começa com a JANELA CHEIA — sem isso a
           -- devolução tomaria de volta no minuto seguinte.
           devolvida_em = null
      from alvo
     where cv.id = alvo.id
       and cv.assigned_to is distinct from d.pool[alvo.fatia];

    get diagnostics movidas = row_count;
    total := total + movidas;
    raise notice 'setor % (pool de %): % conversa(s) movida(s)', d.name, n_pool, movidas;
  end loop;

  raise notice '--- total rebalanceado: % ---', total;

  /*
   * ⚠️ O relatório sai no NOTICE de propósito. As duas migrações anteriores
   * responderam "sucesso" tendo mexido em zero linhas, e foi só o Gabriel olhar
   * a tela que revelou isso. Um número na saída torna o no-op impossível de
   * passar por bem-sucedido.
   */
  for linha in
    select p.name,
           count(*) filter (where cv.assigned_by is null
                              and not private.respondida_por_humano(cv.id)) as nao_atendidos,
           count(*) as abertas
      from public.conversations cv
      join public.profiles p on p.id = cv.assigned_to
      join public.department_channels dc on dc.channel_id = cv.channel_id
      join public.departments d on d.id = dc.department_id
     where d.name in ('Secretaria Backup', 'Vendas', 'Comercial')
       and cv.closed_at is null and cv.archived_at is null
     group by 1 order by 3 desc
  loop
    raise notice '  % -> % nao atendidos de % abertas', linha.name, linha.nao_atendidos, linha.abertas;
  end loop;
end;
$$;
