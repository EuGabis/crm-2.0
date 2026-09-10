-- ============================================================
-- Redistribui a fila que caiu num vendedor só
--
-- Pedido do Gabriel (2026-09-10): *"vamos redistribuir as conversas que estavam
-- pendentes e foram pro Paulo assim que ele logou e distribuir entre os 3.
-- Apenas as que foram enviadas nesse período e ele não mandou mensagem."*
--
-- É o retroativo da 202609101100: a cota por atendente conserta daqui para a
-- frente, mas os 90 leads que já caíram continuam onde caíram.
--
-- ⚠️ **Rode o ENSAIO primeiro** (o bloco comentado logo abaixo). Ele mostra
-- exatamente quantas conversas serão movidas e para quem — e este arquivo mexe
-- na caixa de gente que está trabalhando agora, então ver antes não é zelo.
-- ============================================================

/*
 * ---------------------- ENSAIO (não altera nada) ----------------------
 *
 * select p.name as hoje_com, count(*) as conversas,
 *        min(cv.last_message_at) as espera_mais_antiga
 *   from public.conversations cv
 *   join public.profiles p on p.id = cv.assigned_to
 *  where cv.assign_reason = 'varredura da fila do setor'
 *    and cv.assigned_by is null
 *    and cv.closed_at is null
 *    and cv.archived_at is null
 *    and cv.last_message_at < now() - interval '30 minutes'
 *    and not exists (
 *      select 1 from public.messages m
 *       where m.conversation_id = cv.id
 *         and m.direction = 'out'
 *         and coalesce(m.automated, false) = false
 *         and coalesce(m.internal, false) = false
 *    )
 *  group by 1 order by 2 desc;
 */

do $$
declare
  d record;
  n_pool int;
  movidas int;
  total int := 0;
begin
  for d in
    select dep.id,
           dep.location_id,
           dep.name,
           /*
            * O pool é o mesmo que o rodízio usa: `lead_pool` quando preenchido,
            * senão os MEMBROS do departamento. Repetir a regra aqui com outra
            * fonte faria a redistribuição usar uma lista e o rodízio outra.
            */
           coalesce(
             nullif(dep.lead_pool, '{}'::uuid[]),
             array(
               select m.user_id
                 from public.location_members m
                where m.department_id = dep.id
                order by m.user_id
             )
           ) as pool
      from public.departments dep
     /*
      * ⚠️ Igualdade exata nos nomes. "Secretaria Backup" é o time comercial e
      * "Secretaria" é a secretaria — casar por trecho já confundiu setor neste
      * projeto, e aqui o erro moveria conversa de aluno para vendedor.
      *
      * ⚠️ E **a Secretaria fica de fora de propósito**: o pedido é sobre o
      * comercial, e lá a proteção é outra (o ritmo da fila).
      */
     where dep.name in ('Secretaria Backup', 'Vendas', 'Comercial')
       and dep.usa_rodizio is true
  loop
    n_pool := coalesce(array_length(d.pool, 1), 0);
    -- Sem pool não há entre quem dividir; e com uma pessoa só, redistribuir
    -- devolveria tudo para ela — trabalho e eventos no fio por nada.
    if n_pool < 2 then
      continue;
    end if;

    with alvo as (
      select cv.id,
             /*
              * Round-robin sobre a fila ordenada por QUEM ESPERA HÁ MAIS TEMPO.
              * Divide em partes iguais por construção: com 90 conversas e 3
              * vendedores, cada `% 3` leva exatamente 30.
              */
             ((row_number() over (order by cv.last_message_at nulls last, cv.id) - 1)
               % n_pool) + 1 as fatia
        from public.conversations cv
       where cv.location_id = d.location_id
         and cv.channel_id in (
           select dc.channel_id
             from public.department_channels dc
            where dc.department_id = d.id
         )
         /*
          * 🔴 O MARCADOR: só o que a VARREDURA DA FILA entregou. É o texto que
          * `distribuirFilaDoSetor` grava em `assign_reason`, então ele
          * identifica exatamente o lote que caiu de uma vez quando o primeiro
          * vendedor logou — sem eu ter de adivinhar data e hora.
          */
         and cv.assign_reason = 'varredura da fila do setor'
         /*
          * ⚠️ **`assigned_by is null` = foi o SISTEMA.** Decisão de pessoa não se
          * desfaz — é o princípio da 0090, e foi a falta dele que fez a
          * devolução arrancar de um vendedor uma conversa que um colega tinha
          * transferido à mão.
          */
         and cv.assigned_by is null
         and cv.closed_at is null
         and cv.archived_at is null
         /*
          * ⚠️ Meia hora de carência: sem ela, um lead entregue há dois minutos
          * — que o vendedor está lendo agora — seria arrancado dele no meio.
          */
         and cv.last_message_at < now() - interval '30 minutes'
         /*
          * 🔴 **"E ele não mandou mensagem"** — literalmente o pedido. Mesma
          * definição de resposta humana que `conversas_paradas` usa: bot
          * (`automated`) e nota interna (`internal`) NÃO contam, senão toda
          * conversa pareceria atendida em segundos pelo auto-responder.
          *
          * É esta linha que garante que ninguém perde um atendimento começado.
          */
         and not exists (
           select 1
             from public.messages m
            where m.conversation_id = cv.id
              and m.direction = 'out'
              and coalesce(m.automated, false) = false
              and coalesce(m.internal, false) = false
         )
    )
    update public.conversations cv
       set assigned_to = d.pool[alvo.fatia],
           /*
            * ⚠️ O motivo NOVO é o que torna esta migração idempotente: ele tira
            * a conversa do filtro `assign_reason = 'varredura da fila do setor'`,
            * então reexecutar não embaralha tudo de novo. Sem isso, cada
            * reexecução daria outro sorteio.
            */
           assign_reason = 'redistribuição da fila que caiu num vendedor só (10/09)',
           /*
            * Zera a memória da devolução: o episódio é novo, e um carimbo antigo
            * bloquearia a primeira devolução legítima do dono novo.
            */
           devolvida_em = null
      from alvo
     where cv.id = alvo.id
       -- Não escreve quem já está no lugar certo: evita evento no fio dizendo
       -- "atribuída a X" quando nada mudou.
       and cv.assigned_to is distinct from d.pool[alvo.fatia];

    get diagnostics movidas = row_count;
    total := total + movidas;
    raise notice 'setor % (pool de %): % conversa(s) movida(s)', d.name, n_pool, movidas;
  end loop;

  raise notice 'total redistribuído: %', total;
end;
$$;

/*
 * ⚠️ O gatilho `private.log_atribuicao` (202608281530) escreve UM EVENTO no fio
 * de cada conversa movida, com o motivo acima — é assim que o atendente entende
 * por que a conversa mudou de mão, em vez de ela sumir da caixa dele em
 * silêncio. Com dezenas de conversas, são dezenas de eventos: esperado.
 *
 * ⚠️ E `private.marca_quem_atribuiu` grava `assigned_by = auth.uid()`, que no
 * SQL Editor é NULL — ou seja, elas continuam marcadas como "atribuídas pelo
 * sistema" e seguem elegíveis à devolução por espera. É o que se quer: são leads
 * do rodízio, não transferências humanas.
 *
 * Conferência depois:
 *
 *   select p.name, count(*)
 *     from public.conversations cv
 *     join public.profiles p on p.id = cv.assigned_to
 *    where cv.assign_reason = 'redistribuição da fila que caiu num vendedor só (10/09)'
 *    group by 1 order by 2 desc;
 */
