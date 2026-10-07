-- ============================================================
-- Caixa de entrada dos USUÁRIOS sem a RLS linha a linha.
--
-- Irmã da `caixa_admin` (202610051900). Lá o admin levava 6,2 s por página
-- porque a policy "membros leem" de `conversations` chama, CONVERSA POR
-- CONVERSA, `le_todas_conversas`, `sees_all`, `channel_allowed` (duas
-- subconsultas em location_members + department_channels), `is_admin` e
-- `conv_with_bot`. Para o usuário comum é o mesmo custo — e ele é ainda pior
-- para quem vê pouco (o vendedor com only_assigned), porque o Index Scan
-- atravessa a tabela inteira avaliando a policy em cada linha que descarta.
--
-- Aqui as perguntas "sobre a PESSOA" são respondidas UMA vez, no começo
-- (é admin? lê todas? vê o pool? quais números o setor dela enxerga?), e o
-- filtro por conversa vira comparação de coluna — o índice
-- `conversations_ordem_caixa_idx` faz o resto.
--
-- 🔴 O filtro reproduz as DUAS policies de SELECT de `conversations`, palavra
-- por palavra no sentido:
--   "membros leem" (202609110930):
--     location ∈ minhas
--     e ( assigned_to = eu
--         ou le_todas_conversas
--         ou ( sees_all e channel_allowed
--              e (admin ou não está no bot)
--              e (admin ou sem dono) ) )
--   "quem finalizou le" (202609231300): closed_by = eu
--
-- ⚠️ AO MUDAR UMA DESSAS POLICIES, MUDE ESTA FUNÇÃO JUNTO. Divergindo, a caixa
-- mostra o que a pessoa não pode ver (vazamento) ou esconde o que ela pode — e
-- nenhum dos dois dá erro.
--
-- ⚠️ Guard de empresa na primeira linha (padrão 0049): sem ele, `security
-- definer` = "qualquer autenticado lê as conversas de qualquer empresa".
--
-- Mesmo formato de linha da caixa_admin e do `select *, contact:contacts(...)`.
-- Só leitura. Idempotente. Pode ir antes do merge (nada a chama ainda).
-- ============================================================

create or replace function public.caixa_usuario(
  p_location uuid,
  p_antes timestamptz default null,
  p_limite integer default 1000,
  p_sem_mensagem boolean default false
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean;
  v_le_todas boolean;
  v_sees_all boolean;
  v_restrito boolean;   -- o setor da pessoa tem número vinculado?
  v_chans uuid[];       -- os números que o setor dela enxerga
begin
  if v_uid is null or p_location is null
     or p_location not in (select private.user_locations()) then
    return;
  end if;

  v_admin := private.is_admin(p_location);

  select coalesce(m.le_todas_conversas, false), coalesce(m.only_assigned, false) = false
    into v_le_todas, v_sees_all
    from public.location_members m
   where m.user_id = v_uid and m.location_id = p_location;

  -- Mesma regra de private.channel_allowed: setor sem número (ou pessoa sem
  -- setor) = sem restrição; conversa sem número nunca é restringida.
  select coalesce(array_agg(dc.channel_id), '{}')
    into v_chans
    from public.location_members lm
    join public.department_channels dc on dc.department_id = lm.department_id
   where lm.user_id = v_uid and lm.location_id = p_location;
  v_restrito := cardinality(v_chans) > 0;

  -- ⚠️ Duas consultas e não uma com `case`: a com mensagem precisa da ordem
  -- do índice (last_message_at desc nulls last, id desc) para parar no limit;
  -- as sem mensagem (NULL) ficam no FIM desse índice e vão por id, como na
  -- caixa_admin. O bloco de visibilidade é IDÊNTICO nas duas — mexeu em um,
  -- mexa no outro.
  if p_sem_mensagem then
    return query
    select to_jsonb(c) || jsonb_build_object('contact', (
             select jsonb_build_object('first_name', ct.first_name, 'last_name', ct.last_name,
                                       'phone', ct.phone, 'email', ct.email, 'tags', ct.tags)
               from public.contacts ct where ct.id = c.contact_id))
      from public.conversations c
     where c.location_id = p_location
       and c.last_message_at is null
       and (
         (v_admin and v_sees_all)  -- admin: sees_all + channel_allowed + bot/pool liberados
         or v_le_todas
         or c.assigned_to = v_uid
         or c.closed_by = v_uid
         or (
           v_sees_all
           and c.assigned_to is null
           and (not v_restrito or c.channel_id is null or c.channel_id = any (v_chans))
           -- private.conv_with_bot, inline (bot_sessions tem PK por conversa)
           and not exists (
             select 1 from public.bot_sessions s
              where s.conversation_id = c.id and s.status in ('ativo', 'aguardando'))
         )
       )
     order by c.id desc
     limit least(greatest(p_limite, 1), 5000);
    return;
  end if;

  return query
    select to_jsonb(c) || jsonb_build_object('contact', (
             select jsonb_build_object('first_name', ct.first_name, 'last_name', ct.last_name,
                                       'phone', ct.phone, 'email', ct.email, 'tags', ct.tags)
               from public.contacts ct where ct.id = c.contact_id))
      from public.conversations c
     where c.location_id = p_location
       and c.last_message_at is not null
       and (p_antes is null or c.last_message_at <= p_antes)
       and (
         (v_admin and v_sees_all)  -- admin: sees_all + channel_allowed + bot/pool liberados
         or v_le_todas
         or c.assigned_to = v_uid
         or c.closed_by = v_uid
         or (
           v_sees_all
           and c.assigned_to is null
           and (not v_restrito or c.channel_id is null or c.channel_id = any (v_chans))
           -- private.conv_with_bot, inline (bot_sessions tem PK por conversa)
           and not exists (
             select 1 from public.bot_sessions s
              where s.conversation_id = c.id and s.status in ('ativo', 'aguardando'))
         )
       )
     order by c.last_message_at desc nulls last, c.id desc
     limit least(greatest(p_limite, 1), 1000);
end;
$$;

revoke execute on function public.caixa_usuario(uuid, timestamptz, integer, boolean) from public, anon;
grant execute on function public.caixa_usuario(uuid, timestamptz, integer, boolean) to authenticated;

notify pgrst, 'reload schema';
