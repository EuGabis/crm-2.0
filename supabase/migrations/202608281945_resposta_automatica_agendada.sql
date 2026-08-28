-- Lito CRM — resposta automática com janela de tempo
--
-- Pedido do Gabriel (2026-08-28): "um bot que quando a pessoa mande uma mensagem
-- responda com apenas UMA mensagem, e a opção de escolher quando esse bot fica
-- ativo e até quando".
--
-- Escolhas dele, ao ser perguntado:
--   - os DOIS tipos de janela: horário recorrente (dia a dia) E período único
--     (recesso, feriado);
--   - responde a TODA mensagem (não uma vez por conversa).
--
-- ⚠️ **A parte "uma mensagem só" já era possível** no editor de bot (0055): um
-- fluxo com um único nó `end` com texto faz exatamente isso. O que NÃO existia,
-- e é o que esta migração traz, é a JANELA — nenhuma tabela do CRM tinha qualquer
-- conceito de "ativo de … até …".

create table if not exists public.auto_respostas (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references public.locations (id) on delete cascade,
  -- NULL = vale para todos os números da empresa. Preenchido = só aquele número.
  channel_id   uuid references public.whatsapp_channels (id) on delete cascade,
  nome         text not null,
  mensagem     text not null,
  ativo        boolean not null default true,

  /*
   * ⚠️ `tipo` separa os dois modos em vez de um registro tentar ser os dois.
   * Uma linha com campos de recorrência E de período preenchidos precisaria de
   * uma regra para decidir qual olhar — e a regra ficaria implícita no código,
   * onde ninguém a encontra. Assim cada linha é uma coisa só, e "qual vale
   * quando as duas coincidem" vira uma regra explícita: PERÍODO ganha, porque
   * "estamos em recesso" é mais específico que "fora do expediente".
   */
  tipo         text not null check (tipo in ('recorrente', 'periodo')),

  -- recorrente: 0=domingo … 6=sábado. Vazio/NULL = todos os dias.
  dias_semana  int[],
  hora_inicio  time,
  hora_fim     time,

  -- periodo: instantes exatos.
  inicio_em    timestamptz,
  fim_em       timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Cada tipo exige os SEUS campos. Sem isto, uma linha 'periodo' sem datas
  -- ficaria eternamente indefinida e ninguém saberia por que o bot não responde.
  constraint auto_respostas_campos_do_tipo check (
    (tipo = 'recorrente' and hora_inicio is not null and hora_fim is not null)
    or (tipo = 'periodo' and inicio_em is not null and fim_em is not null)
  )
);

create index if not exists auto_respostas_location_idx
  on public.auto_respostas (location_id) where ativo;

alter table public.auto_respostas enable row level security;
revoke all on public.auto_respostas from anon;

drop policy if exists "membros leem auto_respostas" on public.auto_respostas;
create policy "membros leem auto_respostas" on public.auto_respostas
  for select to authenticated
  using (location_id in (select private.user_locations()));

-- ⚠️ Criar/editar/excluir é de ADMIN: a mensagem sai para TODO cliente que
-- escrever na janela, e uma janela mal configurada é visível para fora da
-- empresa. Ler continua liberado para o time ver o que está no ar.
drop policy if exists "admin cria auto_respostas" on public.auto_respostas;
create policy "admin cria auto_respostas" on public.auto_respostas
  for insert to authenticated
  with check (
    location_id in (select private.user_locations())
    and private.is_admin(location_id)
  );

drop policy if exists "admin edita auto_respostas" on public.auto_respostas;
create policy "admin edita auto_respostas" on public.auto_respostas
  for update to authenticated
  using (
    location_id in (select private.user_locations())
    and private.is_admin(location_id)
  )
  with check (
    location_id in (select private.user_locations())
    and private.is_admin(location_id)
  );

drop policy if exists "admin exclui auto_respostas" on public.auto_respostas;
create policy "admin exclui auto_respostas" on public.auto_respostas
  for delete to authenticated
  using (
    location_id in (select private.user_locations())
    and private.is_admin(location_id)
  );
