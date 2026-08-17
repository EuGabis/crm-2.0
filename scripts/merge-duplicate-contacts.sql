-- ============================================================================
-- Lito CRM — Mesclar contatos duplicados (mesmo número)  [rodar UMA vez]
--
-- PRÉ-REQUISITO: aplicar antes a migração 0047_phone_dedup.sql (cria a função
-- private.phone_key). Este script NÃO é uma migração — é uma limpeza pontual.
--
-- O que faz: agrupa contatos pelo número canônico (phone_key). Em cada grupo,
-- mantém o MAIS ANTIGO ("keeper") e, para cada duplicado:
--   1. mescla as CONVERSAS por canal (move as mensagens p/ a conversa do keeper
--      e apaga a conversa duplicada; se o keeper não tiver naquele canal, só
--      reatribui a conversa);
--   2. reatribui TODAS as outras tabelas que apontam pro contato (oportunidades,
--      tarefas, compromissos, etc.) para o keeper — se houver linha equivalente
--      (conflito de unicidade), descarta a do duplicado;
--   3. apaga o contato duplicado.
--
-- ⚠️ ALTERA DADOS. Rode o PASSO 1 (dry run) primeiro e confira. Faça um backup/
--    snapshot no Supabase (Database → Backups) antes do PASSO 3 se quiser garantir.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PASSO 1 — DRY RUN: veja os grupos de duplicados que SERÃO mesclados
-- ----------------------------------------------------------------------------
select
  private.phone_key(phone)                                   as chave,
  location_id,
  count(*)                                                   as qtd,
  array_agg(first_name || ' ' || last_name order by created_at) as contatos,
  array_agg(phone order by created_at)                       as telefones
from public.contacts
where private.phone_key(phone) <> ''
group by location_id, private.phone_key(phone)
having count(*) > 1
order by qtd desc;

-- ----------------------------------------------------------------------------
-- PASSO 2 — cria a função de merge (idempotente; não altera nada ao criar)
-- ----------------------------------------------------------------------------
create or replace function private.merge_duplicate_contacts()
returns table(loc uuid, keeper uuid, merged int)
language plpgsql
as $$
declare
  grp        record;
  dup        uuid;
  keeper_id  uuid;
  conv       record;
  keeper_conv uuid;
  tbl        text;
  cnt        int;
begin
  for grp in
    select c.location_id as loc,
           array_agg(c.id order by c.created_at asc) as ids
    from public.contacts c
    where private.phone_key(c.phone) <> ''
    group by c.location_id, private.phone_key(c.phone)
    having count(*) > 1
  loop
    keeper_id := grp.ids[1];
    cnt := 0;

    foreach dup in array grp.ids[2:array_length(grp.ids, 1)] loop
      -- 1) conversas: mescla por canal
      for conv in select id, channel from public.conversations where contact_id = dup loop
        select id into keeper_conv
          from public.conversations
          where contact_id = keeper_id and channel = conv.channel
          order by created_at asc
          limit 1;
        if keeper_conv is not null then
          update public.messages set conversation_id = keeper_conv where conversation_id = conv.id;
          delete from public.conversations where id = conv.id;
        else
          update public.conversations set contact_id = keeper_id where id = conv.id;
        end if;
        keeper_conv := null;
      end loop;

      -- 2) demais tabelas com contact_id (menos conversations)
      for tbl in
        select c.table_name
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public'
          and c.column_name = 'contact_id'
          and t.table_type = 'BASE TABLE'
          and c.table_name <> 'conversations'
      loop
        begin
          execute format('update public.%I set contact_id = $1 where contact_id = $2', tbl)
            using keeper_id, dup;
        exception when unique_violation then
          execute format('delete from public.%I where contact_id = $1', tbl) using dup;
        end;
      end loop;

      -- 3) apaga o contato duplicado
      delete from public.contacts where id = dup;
      cnt := cnt + 1;
    end loop;

    loc := grp.loc; keeper := keeper_id; merged := cnt;
    return next;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- PASSO 3 — EXECUTA o merge (descomente e rode só depois de conferir o PASSO 1)
-- ----------------------------------------------------------------------------
-- select * from private.merge_duplicate_contacts();
