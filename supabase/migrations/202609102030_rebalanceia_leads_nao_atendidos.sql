-- ============================================================
-- 🔴 A redistribuição de hoje pegou UM SÉTIMO dos leads
--
-- Relato do Gabriel (2026-09-10), depois de aplicar a 202609101430: *"o Paulo
-- está com mais de 67 leads e os outros comerciais com quase metade disso, não
-- distribuiu ainda."*
--
-- 🔴 **A causa é o marcador que eu escolhi: `assign_reason` (texto).** A
-- 202609101430 filtra por `assign_reason = 'varredura da fila do setor'`, e esse
-- é UM dos SETE motivos que o código grava:
--
--     "atribuída pelo bot (origem não informada)"   (padrão de assignLeadTo)
--     "rodízio do bot"                              (nó distribute do fluxo)
--     "rodízio (atendente do fluxo offline)"
--     "atendente do fluxo"                          (nó de atendente fixo)
--     "varredura da fila do setor"                  <- o único que eu peguei
--     "devolvida: cliente esperava N min sem resposta"
--     "redistribuída após N min de espera"
--
-- Os leads da manhã vieram em boa parte pelo BOT, não pela varredura — então o
-- filtro simplesmente não os viu.
--
-- ⚠️ **E isto contradiz uma regra que eu mesmo escrevi na 202609081345:**
-- *"decidir por `assign_reason` (texto) foi REJEITADO: bastaria alguém escrever
-- um motivo novo para a devolução voltar a atropelar transferência humana, em
-- silêncio."* Lá o risco era casar demais; aqui foi casar de menos. **Texto
-- livre não é chave de decisão** — nem para incluir, nem para excluir.
--
-- O critério certo é o que a devolução já usa, e não menciona motivo nenhum:
-- **o SISTEMA atribuiu** (`assigned_by is null`) **e ninguém respondeu**.
-- ============================================================

/*
 * ---------------------- ENSAIO (não altera nada) ----------------------
 *
 * -- 1. Como está a carteira agora, e quanto dela é elegível:
 * select p.name,
 *        count(*) as abertas,
 *        count(*) filter (where cv.assigned_by is null) as pelo_sistema,
 *        count(*) filter (
 *          where cv.assigned_by is null
 *            and not exists (
 *              select 1 from public.messages m
 *               where m.conversation_id = cv.id and m.direction = 'out'
 *                 and coalesce(m.automated, false) = false
 *                 and coalesce(m.internal, false) = false)
 *        ) as elegiveis
 *   from public.conversations cv
 *   join public.profiles p on p.id = cv.assigned_to
 *   join public.department_channels dc on dc.channel_id = cv.channel_id
 *   join public.departments d on d.id = dc.department_id
 *  where d.name in ('Secretaria Backup', 'Vendas', 'Comercial')
 *    and cv.closed_at is null and cv.archived_at is null
 *  group by 1 order by 2 desc;
 *
 * -- 2. Por que a tentativa anterior não pegou (a coluna que eu usei como filtro):
 * select coalesce(cv.assign_reason, '(sem motivo)') as motivo, count(*)
 *   from public.conversations cv
 *   join public.department_channels dc on dc.channel_id = cv.channel_id
 *   join public.departments d on d.id = dc.department_id
 *  where d.name in ('Secretaria Backup', 'Vendas', 'Comercial')
 *    and cv.closed_at is null and cv.archived_at is null
 *  group by 1 order by 2 desc;
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
     -- Igualdade exata: "Secretaria Backup" é o time comercial e "Secretaria" é
     -- a secretaria. E a Secretaria fica FORA — o pedido é sobre o comercial.
     where dep.name in ('Secretaria Backup', 'Vendas', 'Comercial')
       and dep.usa_rodizio is true
  loop
    n_pool := coalesce(array_length(d.pool, 1), 0);
    if n_pool < 2 then
      continue;
    end if;

    with alvo as (
      select cv.id,
             /*
              * Round-robin sobre a fila ordenada por QUEM ESPERA HÁ MAIS TEMPO.
              * Determinístico: mesmo conjunto e mesmo pool dão o mesmo
              * resultado, então reexecutar não embaralha — é o que substitui a
              * idempotência que a versão anterior tirava do texto do motivo.
              */
             ((row_number() over (order by cv.last_message_at nulls last, cv.id) - 1)
               % n_pool) + 1 as fatia
        from public.conversations cv
       where cv.location_id = d.location_id
         and cv.channel_id in (
           select dc.channel_id from public.department_channels dc
            where dc.department_id = d.id
         )
         and cv.assigned_to is not null
         /*
          * 🔴 **O critério, agora sem texto livre:** foi o SISTEMA que atribuiu.
          * Decisão de PESSOA não se desfaz — princípio da 0090, e é o que
          * protege a conversa que um colega transferiu à mão ou que alguém
          * assumiu da fila.
          */
         and cv.assigned_by is null
         and cv.closed_at is null
         and cv.archived_at is null
         -- Carência: lead entregue há minutos está sendo lido agora.
         and cv.last_message_at < now() - interval '30 minutes'
         /*
          * 🔴 **Ninguém respondeu.** Bot (`automated`) e nota interna
          * (`internal`) não contam — mesma definição de `conversas_paradas`,
          * senão toda conversa pareceria atendida em segundos pelo
          * auto-responder. É esta linha que garante que ninguém perde
          * atendimento começado.
          */
         and not exists (
           select 1 from public.messages m
            where m.conversation_id = cv.id
              and m.direction = 'out'
              and coalesce(m.automated, false) = false
              and coalesce(m.internal, false) = false
         )
    )
    update public.conversations cv
       set assigned_to = d.pool[alvo.fatia],
           assign_reason = 'rebalanceamento dos leads não atendidos (10/09)',
           -- Episódio novo: carimbo antigo bloquearia a primeira devolução
           -- legítima do dono novo.
           devolvida_em = null
      from alvo
     where cv.id = alvo.id
       -- Quem já está no lugar certo não é reescrito: evita um evento no fio
       -- dizendo "atribuída a X" quando nada mudou.
       and cv.assigned_to is distinct from d.pool[alvo.fatia];

    get diagnostics movidas = row_count;
    total := total + movidas;
    raise notice 'setor % (pool de %): % conversa(s) movida(s)', d.name, n_pool, movidas;
  end loop;

  raise notice '--- total rebalanceado: % ---', total;

  -- Como ficou, para não depender de uma segunda consulta manual.
  for linha in
    select p.name, count(*) as leads
      from public.conversations cv
      join public.profiles p on p.id = cv.assigned_to
     where cv.assign_reason = 'rebalanceamento dos leads não atendidos (10/09)'
     group by 1 order by 2 desc
  loop
    raise notice '  % -> % lead(s)', linha.name, linha.leads;
  end loop;
end;
$$;

/*
 * ⚠️ A `atribuida_em` é regravada pelo gatilho `marca_quem_atribuiu`
 * (202609101830), então cada dono novo começa com a JANELA CHEIA — sem isso a
 * devolução tomaria de volta no minuto seguinte, que é o defeito da Beatriz.
 *
 * ⚠️ E o gatilho de log escreve um evento por conversa movida: dezenas de
 * eventos são esperados, e é o que faz o atendente entender por que a conversa
 * mudou de mão.
 *
 * Conferência depois:
 *
 *   select p.name, count(*)
 *     from public.conversations cv
 *     join public.profiles p on p.id = cv.assigned_to
 *    where cv.closed_at is null and cv.archived_at is null
 *      and cv.assigned_by is null
 *    group by 1 order by 2 desc;
 */
