-- Origem dos leads (pedido de 2026-10-22): de qual anúncio, campanha e página
-- veio cada lead. Hoje o CRM não registra NADA disso (0 contatos com gclid/UTM).
--
-- Dois caminhos de entrada, os dois pelo WhatsApp:
--  1. Anúncio da Meta com botão de WhatsApp (click-to-WhatsApp): a própria Meta
--     manda `referral` (id do anúncio, título, link, ctwa_clid) na 1ª mensagem.
--  2. Página com botão de WhatsApp (Google Ads e outros): o WhatsApp não carrega
--     gclid/UTM. Um script no site grava o CLIQUE (lead_cliques) e põe um código
--     curto na mensagem pronta do botão; o webhook acha o código e liga o lead
--     ao clique.
--
-- lead_origens é o resultado: uma linha por conversa que chegou com origem.
-- Escrita só pela service role (webhook / rota pública do clique); leitura por
-- membros da empresa (padrão membership).

create table if not exists public.lead_cliques (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  codigo      text not null,
  telefone    text,
  gclid       text,
  gbraid      text,
  wbraid      text,
  fbclid      text,
  utm_source  text,
  utm_medium  text,
  utm_campaign text,
  utm_term    text,
  utm_content text,
  pagina      text,
  referrer    text,
  created_at  timestamptz not null default now()
);
create unique index if not exists lead_cliques_codigo_idx on public.lead_cliques (location_id, codigo);
create index if not exists lead_cliques_criado_idx on public.lead_cliques (created_at desc);

create table if not exists public.lead_origens (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references public.locations(id) on delete cascade,
  contact_id      uuid references public.contacts(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  -- 'meta' | 'google' | 'site' (botão sem gclid/UTM de plataforma conhecida)
  plataforma      text not null,
  -- 'anuncio_whatsapp' (Meta CTWA) | 'botao_site'
  via             text not null,
  clique_id       uuid references public.lead_cliques(id) on delete set null,
  -- Meta (referral)
  meta_source_id   text,
  meta_source_type text,
  meta_source_url  text,
  meta_headline    text,
  meta_body        text,
  ctwa_clid        text,
  -- Site / Google
  gclid        text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_term     text,
  utm_content  text,
  pagina       text,
  -- Nomes resolvidos depois pela API do anunciante (Google Ads / Meta).
  campanha     text,
  conjunto     text,
  anuncio      text,
  created_at   timestamptz not null default now()
);
create index if not exists lead_origens_contato_idx on public.lead_origens (contact_id, created_at desc);
create index if not exists lead_origens_conversa_idx on public.lead_origens (conversation_id);
create index if not exists lead_origens_criado_idx on public.lead_origens (location_id, created_at desc);

alter table public.lead_cliques enable row level security;
alter table public.lead_origens enable row level security;
revoke all on public.lead_cliques from anon;
revoke all on public.lead_origens from anon;

drop policy if exists "membros leem cliques" on public.lead_cliques;
create policy "membros leem cliques" on public.lead_cliques
  for select to authenticated
  using (location_id in (select private.user_locations()));

drop policy if exists "membros leem origens" on public.lead_origens;
create policy "membros leem origens" on public.lead_origens
  for select to authenticated
  using (location_id in (select private.user_locations()));
