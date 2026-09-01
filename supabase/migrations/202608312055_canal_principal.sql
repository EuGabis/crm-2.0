-- Lito CRM — número PRINCIPAL por empresa
--
-- Descoberto investigando o áudio recusado (2026-08-31): as conversas estavam
-- saindo pelos números "Backup Comercial" e "Backup Secretaria", embora exista
-- um número principal de Secretaria cadastrado.
--
-- ⚠️ **A causa é um critério arbitrário, não um bug de digitação.**
-- `conversationActions.open()` escolhia, entre os canais do departamento, o
-- **ativo mais antigo** (`order by created_at asc limit 1`). Não existia nenhuma
-- noção de "qual é o número principal" — então bastava o backup ter sido
-- cadastrado primeiro para toda conversa nova nascer nele. E número de backup é,
-- por definição, o que só deveria entrar quando o principal não serve.
--
-- Isso é errado independente do problema do áudio: o cliente passa a ver um
-- número que não é o divulgado, responde nele, e a conversa fica presa lá.
--
-- ⚠️ NÃO muda conversa existente. `conversations.channel_id` de conversa que
-- veio de mensagem do cliente é o número que ELE procurou — reescrever isso
-- faria a resposta sair por um número diferente do que ele conhece, que é
-- exatamente o defeito que esta migração corrige.

alter table public.whatsapp_channels
  add column if not exists principal boolean not null default false;

comment on column public.whatsapp_channels.principal is
  'Número preferido da empresa ao ABRIR conversa nova. Não afeta conversa que já existe.';

/*
 * ⚠️ Um principal por empresa, garantido pelo BANCO e não pela tela.
 * Índice único PARCIAL: só as linhas com `principal` competem entre si, então
 * continua sendo possível ter vários canais comuns. Sem isto, dois cliques
 * simultâneos em "tornar principal" deixariam dois — e aí `open()` voltaria a
 * desempatar por data, que é o defeito de origem.
 */
create unique index if not exists whatsapp_channels_um_principal
  on public.whatsapp_channels (location_id) where principal;

/*
 * Promove um canal a principal, rebaixando o anterior NA MESMA TRANSAÇÃO.
 *
 * ⚠️ Em duas chamadas do cliente (`update ... set principal=false` e depois
 * `update ... set principal=true`) uma falha no meio deixa a empresa SEM
 * principal, e o índice único acima faria a segunda escrita estourar se a ordem
 * se invertesse. Aqui é atômico.
 */
create or replace function public.definir_canal_principal(p_channel uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_location uuid;
begin
  select location_id into v_location
    from public.whatsapp_channels where id = p_channel;
  if v_location is null then
    raise exception 'canal não encontrado';
  end if;

  -- Checagem de empresa na PRIMEIRA LINHA (padrão da 0049): `security definer`
  -- sem isto significa "qualquer autenticado mexe no canal de qualquer empresa".
  if v_location not in (select private.user_locations()) then
    raise exception 'sem acesso a esta empresa';
  end if;
  -- Definir o número que fala com o cliente é decisão de administrador.
  if not private.is_admin(v_location) then
    raise exception 'apenas administradores';
  end if;

  update public.whatsapp_channels
     set principal = false
   where location_id = v_location and principal and id <> p_channel;

  update public.whatsapp_channels
     set principal = true
   where id = p_channel;
end;
$$;

-- ⚠️ O par obrigatório: `create function` já concede EXECUTE a PUBLIC, e só o
-- `grant to authenticated` NÃO tira isso (é o bug da 0080 em estado puro).
revoke execute on function public.definir_canal_principal(uuid) from public, anon;
grant execute on function public.definir_canal_principal(uuid) to authenticated;
