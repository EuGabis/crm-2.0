-- A lista de conversas precisa saber o que SAIU do alcance de quem está olhando.
--
-- Relato do Gabriel (2026-09-21): *"essa conversa foi transferida da Beatriz
-- para o Daniel, mas ainda aparecia no chat dela — e ela finalizou por continuar
-- aparecendo, mesmo sem estar mais com ela."*
--
-- 🔴 **A varredura só sabe ACRESCENTAR.** `resyncConversations` busca
-- `updated_at > cursor` e junta o que voltou; uma conversa que saiu do alcance
-- da pessoa **simplesmente não volta na consulta** — e a store nunca remove
-- nada. O Realtime também não salva: `postgres_changes` respeita a RLS, então o
-- UPDATE que tirou a conversa dela não gera evento PARA ELA. Resultado: a linha
-- fica na tela até um F5, e quem está olhando age sobre ela.
--
-- Linha do tempo do caso:
--   10:47  atribuída a Beatriz (rodízio — atendente do fluxo offline)
--   11:03  devolvida por espera e redistribuída para Daniel
--   11:39  Daniel responde (áudio)
--   11:59  **Beatriz finaliza** — da lista velha, 56 minutos depois de a
--          conversa ter deixado de ser dela
--
-- ⚠️ O clique dela não foi recusado pelo servidor, e isso está CERTO pela regra
-- vigente: `finish_conversation` autoriza `private.can_supervise_conv`, que é
-- verdadeiro para setor `colaborativo` (0080). Ou seja — **não é buraco de
-- permissão, é informação errada na tela.** O que ela viu dizia que a conversa
-- era dela.

begin;

/*
 * Todas as conversas da empresa alteradas desde um instante — IDS e nada mais.
 *
 * ⚠️ `security definer` porque ela precisa enxergar inclusive o que o chamador
 * NÃO pode ver: é justamente essa diferença que vira a lápide. A checagem de
 * empresa é a primeira coisa que roda (padrão 0049) — sem ela, `definer`
 * significaria "qualquer autenticado lista as conversas de qualquer empresa".
 *
 * O que ela expõe é um uuid de conversa da PRÓPRIA empresa, sem nenhuma coluna
 * junto: com o id na mão o chamador continua sem conseguir ler a linha, porque
 * a RLS de `conversations` não mudou.
 */
create or replace function private.conversas_mudadas(p_location uuid, p_desde timestamptz)
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'private'
as $fn$
  select c.id
    from public.conversations c
   where p_location in (select private.user_locations())
     and c.location_id = p_location
     and c.updated_at > p_desde;
$fn$;

revoke execute on function private.conversas_mudadas(uuid, timestamptz) from public, anon;
grant execute on function private.conversas_mudadas(uuid, timestamptz) to authenticated;

/*
 * As conversas que mudaram e que quem está perguntando NÃO pode mais ver.
 *
 * 🔴 **`security INVOKER` de propósito — e é o cerne do desenho.** A segunda
 * metade do `except` consulta `public.conversations` como o CHAMADOR, então
 * quem decide "visível" é a própria policy, em tempo de execução.
 *
 * ⚠️ A alternativa era repetir aqui a expressão da policy (`assigned_to = me or
 * le_todas_conversas or (sees_all and channel_allowed and …)`) — quatro ramos
 * que já foram reescritos em SEIS migrações (0035, 0053, 0062, 0063, 0074,
 * 202609110930). Uma cópia divergiria na sétima, e o efeito de divergir aqui é o
 * PIOR possível: a lápide apagaria da tela uma conversa que a pessoa pode ver.
 * Sumir sem motivo é pior do que o defeito que isto conserta.
 */
create or replace function public.conversas_que_sairam(p_location uuid, p_desde timestamptz)
returns setof uuid
language sql
stable
set search_path to 'public', 'private'
as $fn$
  select t.id from private.conversas_mudadas(p_location, p_desde) as t(id)
  except
  select c.id
    from public.conversations c
   where c.location_id = p_location
     and c.updated_at > p_desde;
$fn$;

revoke execute on function public.conversas_que_sairam(uuid, timestamptz) from public, anon;
grant execute on function public.conversas_que_sairam(uuid, timestamptz) to authenticated;

-- O PostgREST cacheia a assinatura das funções; sem isto a primeira chamada
-- responde `PGRST202` (existe no banco, não no cache de esquema).
notify pgrst, 'reload schema';

commit;
