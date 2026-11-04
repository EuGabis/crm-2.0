-- Relatório de conversas do supervisor: por PERÍODO, sem teto escondido
-- (2026-11-04).
--
-- `sector_conversations()` terminava em `limit 500`: para o admin são 26.986
-- conversas, e o relatório mostrava as 500 de atividade mais recente como se
-- fossem todas — o filtro de período da tela (que roda no navegador) não tinha
-- como achar o que nunca chegou.
--
-- Esta versão recebe o período (dia em São Paulo, pela data de INÍCIO da
-- conversa — o mesmo campo que o filtro da tela usa) e devolve TUDO do
-- intervalo. O cliente pagina com .range() (o PostgREST corta em 1000) e a
-- ordem desempata por id para as páginas não repetirem nem pularem linha.
--
-- ⚠️ A versão sem parâmetros CONTINUA existindo: o código no ar a chama até o
-- merge. Remover em migração separada, depois.

create or replace function public.sector_conversations(p_de date, p_ate date)
returns table (
  id uuid, contact_id uuid, contact_first text, contact_last text, contact_phone text,
  contact_email text, assigned_to uuid, channel text, channel_id uuid, inbound boolean,
  closed_at timestamptz, archived_at timestamptz, last_message_at timestamptz,
  last_message_preview text, created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'private'
as $function$
  with me as (
    select lm.location_id, lm.department_id, lm.role,
           coalesce(d.colaborativo, false) as colaborativo
      from public.location_members lm
      left join public.departments d on d.id = lm.department_id
     where lm.user_id = (select auth.uid())
     limit 1
  )
  select c.id, c.contact_id, ct.first_name, ct.last_name, ct.phone, ct.email,
         c.assigned_to, c.channel, c.channel_id,
         exists (
           select 1 from public.messages m
            where m.conversation_id = c.id and m.direction = 'in'
         ) as inbound,
         c.closed_at, c.archived_at, c.last_message_at, c.last_message_preview, c.created_at
    from me
    join public.conversations c on c.location_id = me.location_id
    left join public.contacts ct on ct.id = c.contact_id
   where (me.role = 'admin'
          or (me.colaborativo and exists (
                select 1 from public.department_channels dc
                 where dc.department_id = me.department_id and dc.channel_id = c.channel_id)))
     -- Dia em São Paulo, não no relógio do servidor (UTC).
     and c.created_at >= (p_de::timestamp at time zone 'America/Sao_Paulo')
     and c.created_at <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
   order by c.last_message_at desc nulls last, c.id desc;
$function$;

revoke execute on function public.sector_conversations(date, date) from public, anon, authenticated;
grant execute on function public.sector_conversations(date, date) to authenticated;
