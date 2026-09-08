-- ============================================================
-- Devolução por espera: conserta QUATRO defeitos, todos vistos em produção
-- em 2026-09-08 entre 13:08 e 13:19 (150 eventos, 13 conversas).
--
-- A devolução por espera (28/08) nunca havia rodado — a 202609081310 a fez
-- rodar, e aí os defeitos latentes dela apareceram todos de uma vez:
--
-- 1) 🔴 LAÇO INFINITO, um ciclo POR MINUTO. Reatribuir não faz o cliente ser
--    respondido, então no tique seguinte a conversa continuava parada e ela
--    devolvia de novo, para sempre. O fio virou uma escada de
--    "Devolvida à fila · Atribuída a X · Devolvida à fila · Atribuída a Y".
--
-- 2) 🔴 DESFAZIA TRANSFERÊNCIA HUMANA. Medido: uma conversa transferida à mão
--    de Jenifer para Paulo Lopes (que é de OUTRO setor e outro número) foi
--    arrancada dele e jogada de volta no rodízio da Secretaria. O princípio
--    já estava escrito neste repositório, na 0090 — "decisão humana não se
--    desfaz" — e não havia sido aplicado aqui.
--
-- 3) 🔴 O TEMPO REPORTADO ERA FICÇÃO, nos DOIS sentidos. A âncora era o
--    PRIMEIRO contato dentro de uma janela de 7 dias:
--      · inflava — reportou 688 min para quem havia escrito 137 min antes,
--        480 para 135, 274 para 177 (soma a espera desde a primeira mensagem
--        da semana, mesmo já respondida no meio);
--      · APAGAVA — reportou 0 para um cliente esperando 3.301 min, porque a
--        mensagem dele saiu da janela de 7 dias.
--    Ou seja: o número dependia de QUANDO se olhava, não do atendimento.
--
-- 4) 🔴 DEVOLVIA CONVERSA JÁ RESPONDIDA. Dois casos: última resposta humana
--    13:16 contra última mensagem do cliente 10:35. A regra do Gabriel é
--    explícita — só redistribuir se o atendente NÃO responder o contato.
--
-- Idempotente.
-- ============================================================
set check_function_bodies = off;

-- ------------------------------------------------------------
-- 1. Quem atribuiu: pessoa ou sistema
-- ------------------------------------------------------------
/*
 * `assigned_by` = `auth.uid()` de quem mudou o responsável; NULL = sistema
 * (webhook, bot, rodízio, varredura, cron — nenhum deles tem sessão).
 *
 * É o que sustenta a regra nova: **o rodízio só retoma o que o rodízio deu.**
 * `assign_reason` (202608281530) já existia, mas decidir por TEXTO seria frágil
 * — bastaria alguém escrever um motivo novo para a devolução voltar a atropelar
 * transferência humana, e o defeito reapareceria em silêncio.
 */
alter table public.conversations
  add column if not exists assigned_by uuid references auth.users(id) on delete set null,
  -- Quando o rodízio devolveu esta conversa. É a MEMÓRIA que faltava: sem ela,
  -- devolver não muda nada no mundo e a condição continua verdadeira no minuto
  -- seguinte — o laço.
  add column if not exists devolvida_em timestamptz;

/*
 * ⚠️ GATILHO, e não um `set assigned_by` em cada caminho. São OITO caminhos que
 * mudam `assigned_to` (dois em TypeScript e seis em SQL) — a 202608281530 já
 * aprendeu isso ao instrumentar o log: consertar um por um deixa de fora
 * justamente o próximo que alguém criar.
 *
 * BEFORE (o log é AFTER) porque precisa escrever na PRÓPRIA linha.
 */
create or replace function private.marca_quem_atribuiu()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $function$
begin
  if new.assigned_to is distinct from old.assigned_to then
    new.assigned_by := auth.uid();
    -- Responsável novo = episódio novo: a memória de devolução não pode
    -- sobreviver a uma decisão humana de roteamento.
    if auth.uid() is not null then
      new.devolvida_em := null;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists marca_quem_atribuiu on public.conversations;
create trigger marca_quem_atribuiu
  before update of assigned_to on public.conversations
  for each row execute function private.marca_quem_atribuiu();

/*
 * Retroativo: as conversas atribuídas por TRANSFERÊNCIA HUMANA recebem um
 * `assigned_by` para que a devolução não as toque quando for religada.
 *
 * ⚠️ Critério ESTREITO — só quem tem evento de transferência à mão registrado
 * pelo gatilho da 202608281530 como tendo AUTOR (o texto do sistema diz
 * "pelo sistema"). Não há como reconstruir o autor de antes disso, e chutar
 * carimbaria de "humano" o que o rodízio deu — o oposto do que se quer.
 */
update public.conversations c
   set assigned_by = c.assigned_to
 where c.assigned_to is not null
   and c.assigned_by is null
   and exists (
     select 1 from public.messages m
      where m.conversation_id = c.id
        and m.type = 'event'
        and m.body ilike '%transferida%'
        and m.body not ilike '%pelo sistema%'
        and m.created_at > now() - interval '30 days'
   );

-- ------------------------------------------------------------
-- 2. "Quem está esperando" — agora medindo o que a operação vê
-- ------------------------------------------------------------
/*
 * 🔴 A ÂNCORA MUDOU, e é a correção do defeito 3.
 *
 * ANTES: primeira mensagem de entrada DENTRO de uma janela de 7 dias. Isso
 * media "há quanto tempo esta conversa existe sem uma primeira resposta" — que
 * é a pergunta do SLA (0079) e a pergunta ERRADA aqui, além de depender da
 * janela: inflava enquanto a mensagem estava dentro dela e virava ZERO no dia
 * em que saía.
 *
 * AGORA: a ÚLTIMA mensagem do cliente, e só quando NENHUMA resposta humana veio
 * depois dela. É literalmente a regra do Gabriel — "só distribuir se o
 * atendente não responder o contato" — e é também o que o atendente vê ao abrir
 * a conversa: a bola está com a gente desde aquela mensagem.
 *
 * ⚠️ **Isto NÃO substitui `sla_conversations` e não deve convergir com ela.**
 * SLA mede capacidade de resposta a um atendimento novo (primeira entrada →
 * primeira resposta); a devolução mede "a bola está com a gente AGORA, e há
 * quanto tempo". São perguntas diferentes; forçá-las a ter uma definição só foi
 * o erro que produziu o defeito 3.
 *
 * O que continua igual, de propósito:
 *  · minutos ÚTEIS pela mesma `private.business_minutes` (0079) — sem isso toda
 *    conversa de sexta à noite seria "devolvida" na madrugada do sábado;
 *  · a resposta do BOT não conta como atendimento — o auto-responder responde
 *    em segundos e, contando, nenhuma conversa pareceria parada;
 *  · nota interna não conta — não vai para o cliente.
 */
create or replace function public.conversas_paradas(
  p_location uuid,
  p_limite_min integer default 15
)
returns table (
  conversation_id uuid,
  contact_id uuid,
  assigned_to uuid,
  assigned_by uuid,
  channel_id uuid,
  devolvida_em timestamptz,
  ultima_do_cliente timestamptz,
  espera_util_min numeric,
  /*
   * 🔴 **O aluno passou pelo bot?** Regra do Gabriel (2026-09-08): quem NÃO
   * passou pelo bot não deve ser distribuído. O rodízio existe para o lead que
   * o bot triou (nome, e-mail, assunto); conversa aberta pelo próprio CRM
   * ("Nova conversa"), contato antigo de antes da integração ou abordagem
   * nossa não são lead de fila — e distribuí-los põe na caixa de alguém uma
   * conversa sem contexto nenhum.
   *
   * Medido: das 299 conversas abertas, **135 (45%) nunca passaram pelo bot** —
   * 77 delas sem o cliente ter escrito uma linha.
   */
  passou_pelo_bot boolean
)
language plpgsql
stable
security definer
set search_path = public, private
as $function$
begin
  if p_location is null then
    return;
  end if;
  -- Defesa em profundidade: hoje só a service_role executa (ver os grants no
  -- fim). O ramo existe para o dia em que alguém conceder a `authenticated`
  -- sem reler esta migração.
  if auth.uid() is not null
     and p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  with abertas as (
    select c.id, c.contact_id, c.assigned_to, c.assigned_by, c.channel_id, c.devolvida_em
      from public.conversations c
     where c.location_id = p_location
       and c.closed_at is null
       and c.archived_at is null
  ),
  /*
   * ⚠️ Sem janela de tempo na âncora. Era a janela que produzia o "0 min" para
   * quem esperava 3.301. O custo é aceitável e foi medido: `messages` tem ~22
   * mil linhas e o agregado por conversa roda em dezenas de ms.
   */
  /*
   * ⚠️ **Dois sinais, unidos por OR, e nenhum sozinho basta:**
   *  · `bot_sessions` é apagada quando uma conversa finalizada reabre (o webhook
   *    zera a sessão para o bot triar de novo), então a AUSÊNCIA dela não prova
   *    que o bot nunca falou;
   *  · mensagem `automated` é durável, mas uma sessão recém-criada pode existir
   *    antes de o bot dizer a primeira palavra.
   *
   * Medidos neste banco, os dois concordaram em 164 de 164 conversas (zero
   * divergência nos dois sentidos) — o OR é a rede para os casos de borda acima.
   */
  bot as (
    select a.id,
           ( exists (select 1 from public.bot_sessions s where s.conversation_id = a.id)
             or exists (
               select 1 from public.messages m
                where m.conversation_id = a.id
                  and m.direction = 'out'
                  and m.automated is true
             ) ) as passou
      from abertas a
  ),
  ult as (
    select m.conversation_id,
           max(m.created_at) filter (where m.direction = 'in') as t_cliente,
           max(m.created_at) filter (
             where m.direction = 'out'
               and coalesce(m.automated, false) = false
               and coalesce(m.internal, false) = false
           ) as t_humano
      from public.messages m
     where m.location_id = p_location
       and coalesce(m.type, '') <> 'event'
     group by m.conversation_id
  )
  select a.id::uuid, a.contact_id::uuid, a.assigned_to::uuid, a.assigned_by::uuid,
         a.channel_id::uuid, a.devolvida_em::timestamptz, u.t_cliente::timestamptz,
         private.business_minutes(u.t_cliente, now())::numeric,
         b.passou::boolean
    from abertas a
    join ult u on u.conversation_id = a.id
    join bot b on b.id = a.id
   where u.t_cliente is not null
     -- A BOLA ESTÁ COM A GENTE: ninguém respondeu depois da última do cliente.
     and (u.t_humano is null or u.t_humano < u.t_cliente)
     and private.business_minutes(u.t_cliente, now()) >= p_limite_min
   order by private.business_minutes(u.t_cliente, now()) desc;
end;
$function$;

/*
 * ⚠️ O par `revoke from public, anon` NÃO basta neste projeto: `pg_default_acl`
 * concede EXECUTE de toda função nova a anon, authenticated E service_role
 * INDIVIDUALMENTE, então o `authenticated` sobrevive ao revoke do PUBLIC.
 * Nenhuma tela consome esta função — quem chama é o tique.
 */
revoke execute on function public.conversas_paradas(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.conversas_paradas(uuid, integer) to service_role;

/*
 * ⚠️ **NOME NOVO, e por duas razões concretas.**
 *
 * 1) `create or replace` NÃO pode trocar o tipo de retorno (a antiga devolve 5
 *    colunas, esta devolve 8): daria `42P13 cannot change return type of
 *    existing function`. Recriar exigiria `drop` antes — e o `drop` derrubaria
 *    a função que o código NO AR ainda chama.
 *
 * 2) Neste projeto **o código chega à produção ANTES da migração** (deploy
 *    automático no merge, migração à mão). Com nomes diferentes, os dois mundos
 *    coexistem sem se atropelar: enquanto o código velho estiver no ar ele
 *    chama `conversas_esperando`, e o novo passa a chamar `conversas_paradas`.
 *
 * A antiga é removida na 202609081346, que é para aplicar DEPOIS do merge.
 */

-- ------------------------------------------------------------
-- 3. O religamento NÃO mora aqui, de propósito
-- ------------------------------------------------------------
/*
 * ⚠️ `devolver_apos_min` foi zerado à mão em 13:19 para estancar o laço, e este
 * arquivo **não o religa**. Se religasse, aplicar esta migração antes do merge
 * devolveria o laço na hora — o código no ar ainda é o defeituoso.
 *
 * Religar é passo deliberado, na 202609081346, depois do merge.
 */
