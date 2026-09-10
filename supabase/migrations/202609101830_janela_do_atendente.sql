-- ============================================================
-- 🔴 A devolução tomava a conversa UM MINUTO depois de entregá-la
--
-- Fio real (Secretaria, número 11 94767-1223, 2026-09-10):
--
--   07:24  cliente: "Preciso do link de pagamento"
--   07:24  resposta automática: "aguarde, em breve iremos te atender"
--   07:24  atendente do fluxo offline -> rodízio do setor
--   07:24  ninguém no rodízio -> lead aguardando distribuição
--   10:35  Atribuída a Beatriz Brito · varredura da fila do setor
--   10:36  Devolvida à fila · devolvida: cliente esperava 156 min sem resposta
--   10:36  Atribuída a Daniel Messias · redistribuída após 156 min de espera
--
-- ⚠️ **A Beatriz teve UM MINUTO.** Nada nisso é aleatório: o lead esperou 3h na
-- fila (ninguém online antes das 10h30 — correto), então no instante em que ele
-- foi entregue a espera do cliente JÁ era 156 min, muito acima do limite. O
-- tique seguinte olhou a mesma conta e devolveu.
--
-- 🔴 **A causa é uma decisão minha, escrita na 202608280930:** *"o relógio é a
-- ESPERA DO CLIENTE, não 'há quanto tempo foi atribuída'"*. Medir a espera do
-- aluno é a régua certa para dizer se ele está esperando demais — e é a régua
-- ERRADA para decidir se ESTE atendente falhou. Quem acabou de receber não teve
-- como falhar em nada.
--
-- A regra passa a exigir as DUAS coisas:
--   1) o cliente espera além do limite (como já era), E
--   2) o atendente ficou com a conversa por mais que o limite.
--
-- Ordem: pode ser aplicada ANTES ou DEPOIS do merge. A coluna é aditiva e o
-- código novo tolera a ausência dela.
-- ============================================================
set check_function_bodies = off;

-- ------------------------------------------------------------
-- 1. Quando a conversa chegou nas mãos de quem está com ela
-- ------------------------------------------------------------
alter table public.conversations
  add column if not exists atribuida_em timestamptz;

/*
 * ⚠️ **Quem preenche é o GATILHO que já existe**, não cada caminho de
 * atribuição. São OITO caminhos que mudam `assigned_to` (dois em TypeScript,
 * seis em SQL) — é a lição da 202608281530: consertar um por um deixa de fora
 * justamente o próximo que alguém criar.
 *
 * ⚠️ O corpo abaixo é o que JÁ ESTAVA no banco mais duas linhas. Reescrever a
 * lógica junto seria mudança de comportamento disfarçada de correção.
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
    -- A janela começa AGORA para o novo responsável — inclusive quando a
    -- conversa volta para a fila (`assigned_to` nulo), porque aí não há
    -- ninguém com quem contar o tempo e o campo não deve ficar preso no
    -- carimbo do dono anterior.
    new.atribuida_em := case when new.assigned_to is null then null else now() end;
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
 * ⚠️ **Retroativo com `now()`, de propósito.** As conversas já atribuídas não
 * têm como saber QUANDO foram atribuídas — o carimbo nunca existiu. As duas
 * alternativas eram piores:
 *
 *  · deixar NULL e tratar como "sem janela" = uma RAJADA de devoluções no
 *    minuto seguinte à migração, que é exatamente o defeito que ela conserta;
 *  · deixar NULL e tratar como "não devolve" = devolução congelada até cada
 *    conversa trocar de mão.
 *
 * Com `now()`, todo mundo ganha UMA janela cheia a partir da aplicação. O custo
 * é atrasar em 20 minutos a devolução legítima de quem já estava parado; o teto
 * de um dia útil (`DEVOLVER_TETO_MIN`) já mantém o backlog antigo fora disso.
 */
update public.conversations
   set atribuida_em = now()
 where assigned_to is not null
   and atribuida_em is null
   and closed_at is null
   and archived_at is null;

-- ------------------------------------------------------------
-- 2. A função da devolução passa a exigir a janela do atendente
-- ------------------------------------------------------------
/*
 * ⚠️ `drop` + `create`: a coluna nova troca o tipo de retorno e
 * `create or replace` daria `42P13`. É seguro porque a assinatura é IDÊNTICA e a
 * mudança é ADITIVA — quem lê por nome de campo não percebe, e o script roda
 * numa transação.
 */
drop function if exists public.conversas_paradas(uuid, integer);

create function public.conversas_paradas(
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
  passou_pelo_bot boolean,
  ja_respondida boolean,
  /**
   * Minutos ÚTEIS que a conversa está com o responsável ATUAL.
   *
   * ⚠️ Em minutos úteis pela mesma `private.business_minutes`, e não corridos:
   * quem recebe um lead às 18h55 não pode perdê-lo às 19h15 por causa de vinte
   * minutos que caíram fora do expediente.
   */
  minutos_com_atendente numeric
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
  -- fim). O ramo existe para o dia em que alguém conceder a `authenticated` sem
  -- reler esta migração.
  if auth.uid() is not null
     and p_location not in (select private.user_locations()) then
    return;
  end if;

  return query
  with abertas as (
    select c.id, c.contact_id, c.assigned_to, c.assigned_by, c.channel_id,
           c.devolvida_em, c.atribuida_em
      from public.conversations c
     where c.location_id = p_location
       and c.closed_at is null
       and c.archived_at is null
  ),
  /*
   * ⚠️ Dois sinais para "passou pelo bot", unidos por OR, e nenhum sozinho
   * basta: `bot_sessions` é apagada quando uma conversa finalizada reabre, e a
   * mensagem `automated` pode ainda não existir numa sessão recém-criada.
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
           /*
            * "Humano" exclui o BOT (`automated`) e a NOTA INTERNA: nenhum dos
            * dois é atendimento, e contá-los faria toda conversa parecer
            * respondida em segundos.
            */
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
         b.passou::boolean,
         (u.t_humano is not null)::boolean,
         private.business_minutes(a.atribuida_em, now())::numeric
    from abertas a
    join ult u on u.conversation_id = a.id
    join bot b on b.id = a.id
   where u.t_cliente is not null
     -- A BOLA ESTÁ COM A GENTE: ninguém respondeu depois da última do cliente.
     and (u.t_humano is null or u.t_humano < u.t_cliente)
     and private.business_minutes(u.t_cliente, now()) >= p_limite_min
     /*
      * 🔴 **A JANELA DO ATENDENTE** — a correção deste arquivo.
      *
      * Sem esta linha, um lead que esperou 3h na fila era entregue e tomado no
      * tique seguinte: a espera do cliente já estava acima do limite antes de o
      * atendente existir na história.
      *
      * ⚠️ `atribuida_em is not null` é exigido: sem carimbo não há como afirmar
      * que a janela passou, e o lado seguro é NÃO mexer. Uma conversa nesse
      * estado volta a ser elegível na primeira vez que trocar de mão, quando o
      * gatilho grava o campo.
      */
     and a.atribuida_em is not null
     and private.business_minutes(a.atribuida_em, now()) >= p_limite_min
   order by private.business_minutes(u.t_cliente, now()) desc;
end;
$function$;

/*
 * ⚠️ O par `revoke`/`grant` citando os TRÊS papéis: `pg_default_acl` concede
 * EXECUTE de toda função nova a anon, authenticated e service_role
 * individualmente, e o `drop` acima recriou os privilégios do zero.
 */
revoke execute on function public.conversas_paradas(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.conversas_paradas(uuid, integer) to service_role;

/*
 * Conferência — quem está elegível à devolução AGORA e por quê:
 *
 *   select p.name as com_quem, cp.espera_util_min, cp.minutos_com_atendente,
 *          cp.ja_respondida
 *     from public.departments d
 *     cross join lateral public.conversas_paradas(d.location_id, d.devolver_apos_min) cp
 *     left join public.profiles p on p.id = cp.assigned_to
 *    where d.devolver_apos_min > 0
 *    order by cp.espera_util_min desc limit 20;
 *
 * (rode com `set local role service_role;` antes — a guarda de empresa devolve
 *  zero linhas para o postgres sem sessão, e zero linhas não é prova de nada)
 */
