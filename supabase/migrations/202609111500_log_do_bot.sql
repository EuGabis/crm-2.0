-- ============================================================
-- Log do bot: quem recebeu cada lead, quando e por qual caminho
--
-- Pedido do Gabriel (2026-09-11), no meio do incidente de distribuição:
-- *"vamos criar uma tela de log do bot — aparece o comercial Alberto, Rogerio e
-- Paulo, mostra os leads que ele recebeu (nome, número e horário), mostra em
-- qual período esses leads foram atribuídos a ele, e o fluxo."*
--
-- ⚠️ **Não é relatório: é INSTRUMENTO.** Nos dois incidentes desta semana ("o
-- Paulo recebeu 90", "o Alberto recebeu todos") eu precisei DEDUZIR qual dos
-- três caminhos de atribuição tinha despejado os leads, porque nenhuma tela
-- mostrava isso junto. Deduzir custou duas rodadas e uma correção no lugar
-- errado. Esta função põe numa linha só o que estava espalhado por quatro
-- tabelas: quem recebeu, quando chegou, quando foi atribuído, POR QUAL MOTIVO e
-- em qual fluxo do bot.
--
-- ⚠️ **Inclui quem NÃO tem dono** (`atendente_id` nulo). A fila é metade da
-- informação: "o Alberto levou 34 e 66 estão esperando" e "o Alberto levou 34 de
-- 34" são operações completamente diferentes, e sem a fila na mesma tela não dá
-- para distinguir uma da outra.
--
-- Aditiva (só cria função). Pode ser aplicada ANTES do merge.
-- ============================================================

/*
 * ⚠️ `drop` + `create` e não `create or replace`: se um dia esta função ganhar
 * coluna, o Postgres recusa a troca de tipo de retorno com 42P13. Nascendo
 * assim, a próxima alteração não precisa lembrar disso.
 *
 * ⚠️ E como o `drop` recria os privilégios do zero, o par `revoke`/`grant` no
 * fim NÃO é redundância.
 */
drop function if exists public.log_do_bot(uuid, integer);

create function public.log_do_bot(p_location uuid, p_dias integer default 1)
returns table (
  conversation_id uuid,
  contato         text,
  telefone        text,
  chegou_em       timestamptz,
  atribuida_em    timestamptz,
  atendente_id    uuid,
  atendente       text,
  motivo          text,
  fluxo           text,
  canal           text,
  desfecho        text,
  na_fila         boolean
)
language plpgsql
stable
security definer
set search_path = public, private
as $fn$
begin
  /*
   * ⚠️ A checagem de empresa é a PRIMEIRA linha do corpo (padrão 0049) e fica
   * FORA da consulta: escrita como CTE no `from`, ela vira um join opaco e o
   * planner desiste dos índices (medido na 0078: 153 ms contra 81 ms).
   *
   * ⚠️ E ela é o que separa `security definer` de "qualquer autenticado lê o
   * lead de qualquer empresa".
   */
  if p_location is not distinct from null
     or p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  with janela as (
    select (now() - make_interval(days => greatest(coalesce(p_dias, 1), 1))) as desde
  ),
  -- Só conversas de números que pertencem a algum setor: é o universo do
  -- rodízio. Conversa de e-mail ou de número solto não é "lead do bot".
  base as (
    select cv.id,
           cv.contact_id,
           cv.assigned_to,
           cv.assign_reason,
           cv.atribuida_em,
           cv.created_at,
           cv.awaiting_distribution,
           cv.channel_id
      from public.conversations cv, janela j
     where cv.location_id = p_location
       and cv.channel_id is not null
       /*
        * ⚠️ Chegou OU foi atribuída na janela. Só por `atribuida_em` esconderia
        * a fila (que não tem dono e portanto não tem carimbo) — e a fila é
        * justamente o que diz se a divisão está segurando ou despejando.
        */
       and (cv.created_at >= j.desde or cv.atribuida_em >= j.desde)
  )
  select
    b.id::uuid,
    /*
     * ⚠️ `nullif(btrim(...), '')` e não `coalesce` direto: contato sem sobrenome
     * gera " " (um espaço), que na tela vira uma linha com nome em branco e
     * parece dado faltando.
     */
    coalesce(
      nullif(btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, '')), ''),
      'Sem nome'
    )::text,
    coalesce(ct.phone, '')::text,
    /*
     * "Horário" do lead = quando o CLIENTE escreveu a primeira vez. O
     * `created_at` da conversa é a rede: conversa aberta pelo CRM não tem
     * mensagem de entrada, e ali os dois coincidem.
     */
    coalesce(
      (select min(m.created_at) from public.messages m
        where m.conversation_id = b.id and m.direction = 'in'),
      b.created_at
    )::timestamptz,
    b.atribuida_em::timestamptz,
    b.assigned_to::uuid,
    coalesce(pf.name, '')::text,
    /*
     * 🔴 O MOTIVO é a coluna que os dois incidentes pediram. Ele diz QUAL dos
     * caminhos atribuiu — "rodízio do bot", "varredura da fila do setor",
     * "distribuição pelo relatório (rodízio)", "escolha do administrador",
     * "devolvida: cliente esperava N min", "transferida por outra pessoa".
     */
    coalesce(b.assign_reason, '')::text,
    -- Nome do fluxo quando existe; senão a chave configurada no número.
    coalesce(bf.name, wc.bot_flow, '')::text,
    -- ⚠️ As colunas são `name`/`phone_e164` (0022), não label/phone_number.
    coalesce(nullif(wc.name, ''), nullif(wc.phone_e164, ''), '')::text,
    coalesce(bd.rotulo, bd.resultado, '')::text,
    (b.assigned_to is null)::boolean
  from base b
  left join public.contacts ct on ct.id = b.contact_id
  left join public.profiles pf on pf.id = b.assigned_to
  left join public.whatsapp_channels wc on wc.id = b.channel_id
  left join public.bot_flows bf
         on bf.location_id = p_location and bf.key = wc.bot_flow
  /*
   * ⚠️ `lateral ... limit 1`: `bot_desfechos` é append-only e a conversa que
   * reabre passa pela triagem de novo. Sem o corte, um lead com duas triagens
   * viraria DUAS linhas e a soma por atendente deixaria de bater com a
   * realidade — o defeito que a 202609041015 já teve no relatório de triagem.
   */
  left join lateral (
    select d.resultado, d.rotulo
      from public.bot_desfechos d
     where d.conversation_id = b.id
     order by d.created_at desc
     limit 1
  ) bd on true
  order by b.atribuida_em desc nulls last, b.created_at desc;
end;
$fn$;

/*
 * ⚠️ O par obrigatório. E aqui ele tem uma razão a mais: `pg_default_acl` neste
 * projeto concede EXECUTE de toda função nova a anon, authenticated E
 * service_role INDIVIDUALMENTE — então `revoke ... from public` sozinho não tira
 * nada de ninguém (medido em 2026-09-08). Citar `anon` é obrigatório.
 */
revoke execute on function public.log_do_bot(uuid, integer) from public, anon;
grant  execute on function public.log_do_bot(uuid, integer) to authenticated;

notify pgrst, 'reload schema';

/*
 * Conferência — ⚠️ como o usuário REAL, não pelo MCP: a service role cai na
 * guarda de empresa e recebe ZERO LINHAS SEM ERRO, o que já passou por "a função
 * funciona" duas vezes neste projeto.
 *
 *   begin;
 *   select set_config('request.jwt.claims',
 *          json_build_object('sub', '<uuid de um usuario>')::text, true);
 *   set local role authenticated;
 *   select atendente, motivo, count(*)
 *     from public.log_do_bot('<location_id>', 2)
 *    group by 1, 2 order by 3 desc;
 *   rollback;
 *
 * É essa consulta que responde a pergunta dos dois incidentes: se o motivo
 * dominante for "distribuição pelo relatório (rodízio)", quem despejou foi o
 * botão; se for "varredura da fila do setor", foi o tique de minuto.
 */
