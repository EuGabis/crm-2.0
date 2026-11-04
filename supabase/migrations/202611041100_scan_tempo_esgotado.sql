-- Varredura de tempo esgotado (2026-11-04).
--
-- Logs do Postgres, 24h: 3.768 consultas canceladas por statement_timeout
-- (8 s do authenticator). As duas maiores fontes, fora a conversas_paradas
-- (corrigida na 202611041000):
--
-- 1) O SINO (3.533 das 3.768). "Conversas não lidas minhas ou de ninguém" pela
--    RLS: são 10.002 conversas abertas, não lidas e SEM DONO, e para quem
--    enxerga pouco delas (Secretaria, Financeiro) a policy roda
--    channel_allowed/conv_with_bot em cada uma até achar 15. Medido por
--    usuário: Jenifer 10,5 s, Stephany 8,4 s, Daniel 5,6 s, Beatriz/Cibelle/
--    Bruna ~4 s — a cada minuto, por aba aberta. Com esta função: 38 ms
--    (Jenifer), mesmas linhas.
--
-- 2) O LIMITE DIÁRIO do número (70). Contagem de saídas do dia por channel_id,
--    sem índice por número e com a RLS por linha. Ao estourar, `count` volta
--    null e o código lia como zero: o envio esperava 8 s e o limite deixava de
--    ser conferido. As rotas passam a contar com a service role; o índice
--    abaixo é o que torna a contagem barata.
--
-- Nenhuma depende de deploy: o código novo cai no caminho antigo se a função
-- não existir. Pode ser aplicada antes ou depois do merge.

create index if not exists messages_canal_saida_idx
  on public.messages (channel_id, created_at desc)
  where direction = 'out';

/*
 * ⚠️ A VISIBILIDADE é a da caixa_usuario (202610071200), que reproduz as duas
 * policies de SELECT de conversations. Ao mudar uma delas, mude as três — a
 * caixa, esta e a policy —, senão o sino avisa o que a pessoa não pode abrir
 * (ou esconde o que ela vê).
 */
create or replace function public.notificacoes_nao_lidas(p_location uuid, p_limite integer default 15)
returns table (
  id uuid,
  contact_id uuid,
  unread_count integer,
  last_message_at timestamptz,
  last_message_preview text,
  assigned_to uuid
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean;
  v_le_todas boolean;
  v_sees_all boolean;
  v_restrito boolean;
  v_chans uuid[];
begin
  -- Checagem de empresa na PRIMEIRA linha (padrão 0049).
  if v_uid is null or p_location is null
     or p_location not in (select private.user_locations()) then
    return;
  end if;

  v_admin := private.is_admin(p_location);

  select coalesce(m.le_todas_conversas, false), coalesce(m.only_assigned, false) = false
    into v_le_todas, v_sees_all
    from public.location_members m
   where m.user_id = v_uid and m.location_id = p_location;

  select coalesce(array_agg(dc.channel_id), '{}')
    into v_chans
    from public.location_members lm
    join public.department_channels dc on dc.department_id = lm.department_id
   where lm.user_id = v_uid and lm.location_id = p_location;
  v_restrito := cardinality(v_chans) > 0;

  return query
    select c.id, c.contact_id, c.unread_count::integer, c.last_message_at,
           c.last_message_preview, c.assigned_to
      from public.conversations c
     where c.location_id = p_location
       and c.unread_count > 0
       and c.closed_at is null
       and c.archived_at is null
       -- O aviso é só do que é MEU ou de ninguém (ehParaMim).
       and (c.assigned_to is null or c.assigned_to = v_uid)
       and (
         (v_admin and v_sees_all)
         or v_le_todas
         or c.assigned_to = v_uid
         or c.closed_by = v_uid
         or (
           v_sees_all
           and c.assigned_to is null
           and (not v_restrito or c.channel_id is null or c.channel_id = any (v_chans))
           and not exists (
             select 1 from public.bot_sessions s
              where s.conversation_id = c.id and s.status in ('ativo', 'aguardando'))
         )
       )
     order by c.last_message_at desc
     limit least(greatest(p_limite, 1), 50);
end;
$function$;

revoke execute on function public.notificacoes_nao_lidas(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.notificacoes_nao_lidas(uuid, integer) to authenticated;
