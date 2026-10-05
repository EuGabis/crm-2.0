-- ============================================================
-- Caixa de entrada do ADMIN sem a RLS linha a linha.
--
-- Medido em 2026-10-05, como o admin real: a primeira página da caixa (mil
-- conversas mais recentes, com o contato) levava 6,2 s — 64 mil blocos lidos,
-- a RLS de `conversations` (sees_all, channel_allowed, conv_with_bot…) rodando
-- conversa por conversa. Com o limite de 8 s do papel `authenticated`, no pico
-- a página estourava e a caixa do admin não carregava.
--
-- Para o admin a RLS não muda o resultado: ele vê todas as conversas da
-- empresa (o filtro removeu só as sem mensagem). Esta função confere "é admin
-- desta empresa?" UMA vez, na primeira linha (padrão 0049), e devolve a página
-- direto pelo índice `conversations_ordem_caixa_idx`.
--
-- ⚠️ Quem não é admin recebe CONJUNTO VAZIO, e o app cai no caminho de sempre
-- (consulta comum, com a RLS). Os vendedores não passam por aqui.
-- ⚠️ Ao mexer na função, mantenha o guard no topo: sem ele, `security definer`
-- significa "qualquer autenticado lê as conversas de qualquer empresa".
--
-- O formato de cada linha é o MESMO do `select *, contact:contacts(...)` da
-- caixa: as colunas da conversa + `contact` como objeto.
--
-- Só leitura. Idempotente.
-- ============================================================

create or replace function public.caixa_admin(
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
begin
  if p_location is null or not private.is_admin(p_location) then
    return;
  end if;

  if p_sem_mensagem then
    return query
      select to_jsonb(c) || jsonb_build_object('contact', (
               select jsonb_build_object('first_name', ct.first_name, 'last_name', ct.last_name,
                                         'phone', ct.phone, 'email', ct.email, 'tags', ct.tags)
                 from public.contacts ct where ct.id = c.contact_id))
        from public.conversations c
       where c.location_id = p_location
         and c.last_message_at is null
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
     order by c.last_message_at desc nulls last, c.id desc
     limit least(greatest(p_limite, 1), 1000);
end;
$$;

revoke execute on function public.caixa_admin(uuid, timestamptz, integer, boolean) from public, anon;
grant execute on function public.caixa_admin(uuid, timestamptz, integer, boolean) to authenticated;

notify pgrst, 'reload schema';
