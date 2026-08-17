-- Lito CRM — Bot conversacional (fluxo tipo triagem que roda dentro do sistema)
--
-- Guarda o ESTADO da conversa no fluxo: em que nó está, esperando resposta, e as
-- variáveis já coletadas (name, curso, conhece_lito, objetivo...). O motor
-- (src/lib/bot/*) avança quando o cliente responde, disparado pelo webhook.

create table if not exists public.bot_sessions (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  flow_key text not null,
  node_id text,                       -- nó atual (o "ask" em que está parado)
  status text not null default 'ativo'
    check (status in ('ativo', 'aguardando', 'concluido')),
  vars jsonb not null default '{}'::jsonb,  -- respostas coletadas
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bot_sessions_location_idx on public.bot_sessions (location_id);

alter table public.bot_sessions enable row level security;
revoke all on public.bot_sessions from anon;

-- Escrita é sempre via service role (webhook). Membros só leem (debug/telas).
drop policy if exists "membros leem bot_sessions" on public.bot_sessions;
create policy "membros leem bot_sessions" on public.bot_sessions
  for select to authenticated
  using (location_id in (select private.user_locations()));

-- Qual fluxo de bot cada número roda ao receber a 1ª mensagem (null = sem bot).
alter table public.whatsapp_channels
  add column if not exists bot_flow text;
