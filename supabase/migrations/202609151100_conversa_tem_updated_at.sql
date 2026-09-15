-- ============================================================
-- 🔴 "A caixa de entrada não atualiza — preciso dar F5"
--
-- Dois relatos do mesmo dia (2026-09-15), e a causa é a mesma família:
--
--   1) *"muitos usuários relatam que a tela de conversas não atualiza às vezes;
--      ele fica com a tela aberta e atualiza manualmente, e aí sim aparece"*;
--   2) *"esse lead apareceu para o Paulo, mas não apareceram todas as mensagens
--      que o aluno enviou para o bot"*.
--
-- A rede de segurança do refresh silencioso (`useInboxLiveSync`) tem duas
-- varreduras: `syncInboxDelta` (mensagens novas, por cursor) e
-- `resyncConversations` (conversas que ficaram visíveis). A segunda fazia:
--
--     supabase.from("conversations").select(CONV_SELECT)     -- sem range, sem order
--
-- ⚠️ **É a armadilha nº 7 do AGENTS.md pela terceira vez**: o PostgREST corta no
-- "Max rows" (1000) sem erro e sem aviso, e **sem `order` QUAIS mil voltam é
-- indefinido**. Medido hoje: **4.049 conversas**. Ou seja, a cada minuto cada aba
-- baixava mil linhas com join de contato — caras e arbitrárias — e a conversa
-- que acabou de ficar visível podia simplesmente não estar entre elas.
--
-- E ela só ACRESCENTAVA (`filter(c => !known.has(c.id))`): conversa que já estava
-- na lista nunca era atualizada. Finalizar, transferir, atribuir e devolver **não
-- mexem em `last_message_at`**, então essas mudanças só chegavam pelo Realtime —
-- e quando o websocket morre em silêncio (notebook suspenso, wi-fi trocando de
-- rede, proxy cortando conexão ociosa) nada mais as traz. É exatamente o relato:
-- a tela fica aberta e velha, o F5 conserta.
--
-- ============================================================
-- O que esta migração acrescenta: um carimbo de ATUALIZAÇÃO na conversa.
--
-- Sem ele, revalidar significava rebaixar a lista inteira, e é por isso que a
-- varredura era cara e chegou a ser recortada em mil linhas. Com ele a pergunta
-- vira "o que mudou desde a última vez?" — que é a mesma forma do
-- `syncInboxDelta` para mensagens, e custa algumas linhas por minuto em vez de
-- centenas.
--
-- ⚠️ ADITIVA. O código novo **refaz a consulta sem a coluna** quando ela não
-- existe (neste projeto o código vai ao ar ANTES da migração), então pode ser
-- aplicada antes ou depois do merge.
-- ============================================================

alter table public.conversations
  add column if not exists updated_at timestamptz not null default now();

comment on column public.conversations.updated_at is
  'Última alteração de QUALQUER campo da conversa. É o cursor da varredura da caixa de entrada — atribuição, finalização e arquivamento não mexem em last_message_at.';

/*
 * 🔴 **O backfill vem ANTES do gatilho, e a ordem não é estética.**
 *
 * O `default now()` já carimbou as 4.049 linhas com o instante do ALTER, então
 * toda conversa parece "atualizada agora" e a PRIMEIRA varredura de cada aba
 * baixaria o banco inteiro — justamente o que esta migração vem evitar. E se o
 * gatilho já existisse, o próprio `update` do backfill o dispararia e gravaria
 * `now()` de novo, anulando a correção em silêncio.
 */
update public.conversations
   set updated_at = greatest(created_at, coalesce(last_message_at, created_at),
                             coalesce(closed_at, created_at),
                             coalesce(archived_at, created_at));

create or replace function private.marca_conversa_atualizada()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

/*
 * ⚠️ GATILHO, e não `set updated_at = now()` em cada caminho de escrita — a
 * lição da 202608281530 (o log de atribuição) e da 0085 (a fila de transcrição):
 * a conversa é escrita por mais de uma dezena de lugares, entre webhook, bot,
 * rodízio, funções `security definer` e a própria tela, e o próximo que alguém
 * criar amanhã esqueceria de carimbar. Um carimbo que falha em UM caminho é pior
 * que carimbo nenhum: a varredura passa a perder exatamente aquele tipo de
 * mudança, e em silêncio.
 */
drop trigger if exists conversas_marca_atualizacao on public.conversations;
create trigger conversas_marca_atualizacao
  before update on public.conversations
  for each row execute function private.marca_conversa_atualizada();

/*
 * O índice é o que torna a varredura barata: ela pergunta sempre
 * "desta empresa, o que mudou depois de X".
 */
create index if not exists conversations_updated_idx
  on public.conversations (location_id, updated_at desc);

/*
 * Conferência: depois desta migração a distribuição de `updated_at` tem de
 * espelhar a atividade real (a maioria das conversas com data ANTIGA), e não
 * um bloco no instante da aplicação.
 */
do $$
declare recentes int; total int;
begin
  select count(*), count(*) filter (where updated_at >= now() - interval '1 hour')
    into total, recentes from public.conversations;
  raise notice 'conversas: % no total, % com updated_at na última hora', total, recentes;
  if total > 100 and recentes = total then
    raise warning 'TODAS as conversas ficaram com updated_at = agora — o backfill não pegou. A primeira varredura de cada aba vai baixar o banco inteiro.';
  end if;
end $$;
