-- Lito CRM — resumo do atendimento na finalização e na transferência
--
-- Quando o atendente finaliza ou passa a conversa adiante, o que aconteceu ali
-- fica só na cabeça dele. Quem assume depois — ou atende o mesmo cliente quando
-- ele volta a chamar semanas mais tarde — precisa rolar a conversa inteira para
-- descobrir o que já foi tratado. Este resumo é a memória desse repasse.

-- ---------- 1. O resumo é uma NOTA INTERNA marcada ----------
-- ⚠️ Não é tabela nova, e isso é decisão consciente: a nota interna
-- (`messages.internal`) já é onde vivem os comentários da conversa — o botão
-- "Nota" do card, a ação `nota-interna` das automações e o painel Observações da
-- barra lateral. Uma tabela separada faria o resumo escrito aqui NÃO aparecer
-- lá, e o comentário de lá não contar como resumo. A marca abaixo é só o que
-- distingue "nota qualquer" de "resumo de repasse".
alter table public.messages
  add column if not exists handoff_kind text;

comment on column public.messages.handoff_kind is
  'Resumo de repasse do atendimento: finalizacao | transferencia. NULL = nota comum.';

-- Busca do ÚLTIMO resumo de uma conversa. Índice parcial porque a tabela tem
-- centenas de milhares de linhas e só um punhado é resumo.
create index if not exists messages_handoff_idx
  on public.messages (conversation_id, created_at desc)
  where handoff_kind is not null;

-- ---------- 2. Gravar por fora da RLS ----------
-- ⚠️ Espelha `log_conversation_event` (0084) pelo MESMO motivo: ao transferir,
-- a conversa deixa de ser minha no instante seguinte, e o insert direto em
-- `messages` é barrado pela RLS. Sem esta função, o resumo da transferência —
-- justamente o caso em que ele mais importa — se perderia dependendo da ordem
-- das operações.
--
-- A checagem de empresa é a primeira coisa que roda (padrão da 0049). O autor
-- vem de `auth.uid()`, nunca de parâmetro: quem chama não escolhe de quem é a
-- nota.
create or replace function public.save_handoff_summary(
  conv_id uuid,
  p_kind text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_conv record;
  v_id uuid;
begin
  if p_kind not in ('finalizacao', 'transferencia') then
    raise exception 'tipo de resumo invalido: %', p_kind;
  end if;
  if coalesce(btrim(p_body), '') = '' then
    return null; -- resumo vazio não vira nota
  end if;

  select c.id, c.location_id, c.channel into v_conv
  from public.conversations c
  where c.id = conv_id
    and c.location_id in (select private.user_locations());
  if not found then
    return null;
  end if;

  insert into public.messages
    (location_id, conversation_id, direction, type, channel, body, internal,
     handoff_kind, created_by)
  values
    (v_conv.location_id, conv_id, 'out', 'text', v_conv.channel, btrim(p_body), true,
     p_kind, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.save_handoff_summary(uuid, text, text) from public, anon;
grant execute on function public.save_handoff_summary(uuid, text, text) to authenticated;

-- ---------- 3. Ler o último resumo ----------
-- Quem abre a conversa precisa do resumo mais recente, e pode não ter
-- visibilidade das mensagens antigas (atendente que só vê as suas, conversa que
-- já foi de outro setor). A função entrega só ESSA linha, checando a empresa.
create or replace function public.last_handoff_summary(conv_id uuid)
returns table (
  id uuid,
  body text,
  handoff_kind text,
  created_at timestamptz,
  created_by uuid,
  autor text
)
language sql
security definer
stable
set search_path = public, private
as $$
  select m.id, m.body, m.handoff_kind, m.created_at, m.created_by,
         coalesce(p.name, 'Atendente') as autor
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  left join public.profiles p on p.id = m.created_by
  where m.conversation_id = conv_id
    and m.handoff_kind is not null
    and c.location_id in (select private.user_locations())
  order by m.created_at desc
  limit 1;
$$;

revoke execute on function public.last_handoff_summary(uuid) from public, anon;
grant execute on function public.last_handoff_summary(uuid) to authenticated;
