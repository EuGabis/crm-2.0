-- Lito CRM — editar e apagar mensagem, com histórico
--
-- Pedido do Gabriel (02/09/2026): "editar e apagar a mensagem para mim e todos,
-- igual no WhatsApp". Escolhas dele: apagar **marca** (não some), editar vale
-- também para mensagem enviada **com histórico**, e pode o **autor e o admin**,
-- com **log de quem mexeu**.
--
-- ⚠️ **"Apagar para todos" NÃO EXISTE na Cloud API.** Conferido na referência
-- oficial de `/messages`: o endpoint só ENVIA. Não há edit, delete, revoke nem
-- unsend — só reação, indicador de digitação e recibo de leitura. O celular do
-- cliente guarda a mensagem original de qualquer forma, e nada que o CRM faça
-- muda isso. Tudo aqui vale só do lado de cá.
--
-- ⚠️ **A 0040 tornou `UPDATE` em `messages` ADMIN-ONLY.** Por isso a edição não
-- pode ser um `update` do cliente: o autor seria barrado pela RLS, e — a
-- armadilha nº 1 deste projeto — UPDATE recusado pela RLS **não devolve erro**,
-- então a tela diria "editada" com o texto antigo no banco. As duas operações
-- viram função `security definer`, mesmo padrão de `save_handoff_summary` (0087)
-- e `set_message_reaction` (202608271735).

alter table public.messages
  add column if not exists edited_at   timestamptz,
  add column if not exists edited_by   uuid references auth.users (id) on delete set null,
  add column if not exists deleted_at  timestamptz,
  add column if not exists deleted_by  uuid references auth.users (id) on delete set null,
  /*
   * ⚠️ Histórico em JSONB e não em tabela nova. É lista pequena e limitada, lida
   * SEMPRE junto da mensagem; tabela própria só acrescentaria join, RLS e mais
   * uma migração. Mesmo raciocínio de `messages.reactions`.
   *
   * Cada entrada: { at, by, body, acao: 'editada' | 'apagada' }. `body` é o
   * texto que ESTAVA ali antes da ação — é o log que o Gabriel pediu.
   */
  add column if not exists edit_history jsonb not null default '[]'::jsonb;

comment on column public.messages.edit_history is
  'Versões anteriores: [{at, by, body, acao}]. Preenchido por editar_mensagem/apagar_mensagem.';

-- Índice parcial: as telas filtram "não apagada" o tempo todo, e apagada é raro.
create index if not exists messages_nao_apagadas_idx
  on public.messages (conversation_id, created_at) where deleted_at is null;

/*
 * Recalcula a prévia da conversa a partir da última mensagem VISÍVEL.
 *
 * ⚠️ Sem isto, apagar a última mensagem deixaria o texto apagado brilhando na
 * lista de conversas — o lugar onde ele mais aparece. E a lista é o que a pessoa
 * olha primeiro, então "apaguei e continua lá" seria a leitura óbvia.
 */
create or replace function private.recalcular_previa(p_conv uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_body text;
  v_type text;
  v_name text;
begin
  select m.body, m.type, m.media_name into v_body, v_type, v_name
    from public.messages m
   where m.conversation_id = p_conv
     and m.deleted_at is null
     and not m.internal
   order by m.created_at desc
   limit 1;

  update public.conversations
     set last_message_preview = case
           when v_type is null then ''
           when v_type = 'text' then coalesce(v_body, '')
           when v_type = 'image' then '📷 Imagem'
           when v_type = 'video' then '🎥 Vídeo'
           when v_type = 'audio' then '🎤 Áudio'
           else '📎 ' || coalesce(nullif(v_name, ''), 'Arquivo')
         end
   where id = p_conv;
end;
$$;

-- ── Editar ──────────────────────────────────────────────────────────────────
create or replace function public.editar_mensagem(p_id uuid, p_body text)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_loc  uuid;
  v_conv uuid;
  v_dir  text;
  v_type text;
  v_body text;
  v_autor uuid;
  v_del  timestamptz;
begin
  select c.location_id, m.conversation_id, m.direction, m.type, m.body,
         m.created_by, m.deleted_at
    into v_loc, v_conv, v_dir, v_type, v_body, v_autor, v_del
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.id = p_id;
  if v_loc is null then return false; end if;

  -- Checagem de empresa na PRIMEIRA linha (padrão 0049).
  if v_loc not in (select private.user_locations()) then return false; end if;

  /*
   * ⚠️ **Mensagem de ENTRADA nunca é editável, nem por admin.** Editar o que o
   * cliente escreveu é pôr palavra na boca dele: o fio passaria a citar algo que
   * ele nunca disse, e o resumo do atendimento, a Lita e o próximo atendente
   * leem justamente esse fio. É a única regra aqui que não é configurável.
   */
  if v_dir <> 'out' then return false; end if;
  -- Só texto: editar legenda de mídia ou duração de áudio não faz sentido.
  if v_type <> 'text' then return false; end if;
  -- Apagada não volta a ser editada (a ordem inversa é permitida).
  if v_del is not null then return false; end if;
  if coalesce(btrim(p_body), '') = '' then return false; end if;

  -- Autor OU admin. O admin entra a pedido do Gabriel; o log abaixo é o que
  -- torna isso auditável.
  if not (v_autor = v_uid or private.is_admin(v_loc)) then return false; end if;

  -- Nada a fazer se o texto não mudou: evita entrada de histórico vazia.
  if v_body = p_body then return true; end if;

  update public.messages
     set body = p_body,
         edited_at = now(),
         edited_by = v_uid,
         -- Empilha a versão ANTERIOR. Quem editou está em `by`.
         edit_history = edit_history || jsonb_build_object(
           'at',   now(),
           'by',   v_uid,
           'body', coalesce(v_body, ''),
           'acao', 'editada'
         )
   where id = p_id;

  perform private.recalcular_previa(v_conv);
  return true;
end;
$$;

-- ── Apagar (marca, não remove) ──────────────────────────────────────────────
create or replace function public.apagar_mensagem(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_loc  uuid;
  v_conv uuid;
  v_body text;
  v_autor uuid;
  v_del  timestamptz;
begin
  select c.location_id, m.conversation_id, m.body, m.created_by, m.deleted_at
    into v_loc, v_conv, v_body, v_autor, v_del
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.id = p_id;
  if v_loc is null then return false; end if;
  if v_loc not in (select private.user_locations()) then return false; end if;
  if v_del is not null then return true; end if;  -- já apagada: idempotente

  if not (v_autor = v_uid or private.is_admin(v_loc)) then return false; end if;

  /*
   * ⚠️ **O texto SAI de `body` e vai para o histórico.** Marcar sem esvaziar o
   * corpo não seria apagar de verdade: a busca global do inbox procura no CORPO
   * das mensagens, e a prévia da conversa é o corpo — o texto continuaria
   * aparecendo nos dois lugares onde ele mais incomoda.
   *
   * ⚠️ E ele é GUARDADO, não destruído. O Gabriel pediu log de quem mexeu, e
   * mensagem apagada é justamente a que gera disputa depois ("eu não disse
   * isso"). Fica fora da tela e fora da busca, disponível no banco para quem
   * precisar auditar. **A tela não mostra o texto apagado para ninguém** —
   * inclusive admin —, e isso é decisão de produto, não limitação.
   */
  update public.messages
     set body = '',
         deleted_at = now(),
         deleted_by = v_uid,
         edit_history = edit_history || jsonb_build_object(
           'at',   now(),
           'by',   v_uid,
           'body', coalesce(v_body, ''),
           'acao', 'apagada'
         )
   where id = p_id;

  perform private.recalcular_previa(v_conv);
  return true;
end;
$$;

-- ── Privilégios ─────────────────────────────────────────────────────────────
--
-- ⚠️ O par obrigatório: `create function` já concede EXECUTE a PUBLIC, e
-- `create or replace` NÃO reseta grants. Só o `grant to authenticated` deixaria
-- `anon` com acesso — o bug da 0080 em estado puro.
revoke execute on function public.editar_mensagem(uuid, text) from public, anon;
revoke execute on function public.apagar_mensagem(uuid) from public, anon;
grant  execute on function public.editar_mensagem(uuid, text) to authenticated;
grant  execute on function public.apagar_mensagem(uuid) to authenticated;

-- `private.recalcular_previa` só é chamada de dentro das duas acima, então não
-- recebe grant nenhum (schema `private` não é exposto na API).
