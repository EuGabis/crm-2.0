-- ============================================================
-- O funil "Controle de Leads" — que os dois bots pedem e ninguém criou
--
-- 🔴 Relato do Gabriel (2026-09-08): "na pipeline comercial tem cards com
-- responsável os atendentes da secretaria. A pipe do comercial é somente do
-- Alberto, Paulo, Rogerio e os Admins."
--
-- A causa NÃO é permissão nem visibilidade — a segmentação está correta (o funil
-- Comercial é `scope=department` do "Secretaria Backup", que tem exatamente
-- Alberto, Paulo e Rogério). A causa é que **o bot da Secretaria escreve no
-- funil errado**, e a cadeia foi medida inteira:
--
--   1. o fluxo `triagem-secretaria` (nos números Secretaria Principal e Backup
--      Secretaria) manda criar o card no funil "Controle de Leads", etapa
--      "NOVO LEAD";
--   2. NENHUM dos dois existe (conferido: 0 pipelines com esse nome, 0 etapas
--      "NOVO LEAD" em todo o banco);
--   3. `resolvePipeline` então ADIVINHA, e as duas heurísticas caem no Comercial:
--        · procura funil com etapa contendo "quente" → casa com **"Perdido
--          Quente"** do Comercial (casamento acidental: a dica existia para uma
--          etapa "Lead Quente");
--        · último recurso `pipelines[0]` → Comercial, que é `position = 0`;
--   4. o card nasce em Comercial/Entrada, e depois `assignLeadTo` (rodízio) faz
--      o mesmo caminho e escreve `owner_id` = a atendente da Secretaria.
--
-- Escala medida: **365 cards do bot em Comercial/Entrada**, e 82% dos cards com
-- dono pertencem a gente de fora do time comercial — a Jenifer é dona de 144
-- cards num funil que ela **não pode ver**. Padrão diário desde 25/08.
--
-- ⚠️ **A configuração dos bots estava certa; faltava o objeto.** Os DOIS fluxos
-- nomeiam "Controle de Leads", e o `stageMap` da Triagem Comercial
-- (`{quente: "Qualificado", frio: "PERDIDO"}`) não encaixa no Comercial e encaixa
-- num funil de leads. Ou seja: alguém desenhou um intake compartilhado e nunca o
-- criou. Esta migração cria o que já estava configurado, em vez de reescrever a
-- intenção de quem configurou.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. O funil
-- ------------------------------------------------------------
/*
 * ⚠️ **`scope = 'empresa'`, e não do departamento Secretaria.** Os donos dos
 * cards a mover são da Secretaria E do Financeiro (15 da Cibelle, também do bot,
 * que chegaram a ela por transferência — a cascata que reatribui as
 * oportunidades do contato). Num funil de escopo Secretaria, ela viraria dona de
 * cards invisíveis para ela — exatamente o defeito que esta migração conserta,
 * só do outro lado.
 *
 * É também o que a configuração dos bots pede: um INTAKE, onde qualquer setor
 * deposita o lead triado. Restringir depois é um clique em "Quem vê", no módulo
 * Leads — o caminho inverso (descobrir que alguém não vê os próprios cards) é
 * que não tem aviso.
 *
 * ⚠️ Entra no FIM (`position`), não em primeiro: virar a primeira aba mudaria a
 * tela de todo mundo sem ninguém ter pedido. Reordenar é arrastar.
 */
insert into public.pipelines (location_id, name, scope, position)
select l.id, 'Controle de Leads', 'empresa',
       coalesce((select max(p.position) + 1 from public.pipelines p where p.location_id = l.id), 0)
  from public.locations l
 where not exists (
   select 1 from public.pipelines p
    where p.location_id = l.id and lower(p.name) = 'controle de leads'
 );

-- ------------------------------------------------------------
-- 2. As etapas
-- ------------------------------------------------------------
/*
 * "NOVO LEAD" é a etapa que o `ensure_card` dos dois fluxos nomeia — com ela, o
 * bot para de cair no `stages[0]` por acidente.
 *
 * ⚠️ Os nomes importam além do rótulo: `statusForStageName` DEDUZ o status pelo
 * nome ("GANHO" → won, "PERDID" → lost). "Ganho" e "Perdido" fecham o funil
 * corretamente; um "Fechado" não seria reconhecido e o card ficaria `open` para
 * sempre.
 *
 * E "Qualificado"/"Perdido" são exatamente o que o `stageMap` da Triagem
 * Comercial já espera (`{quente: "Qualificado", frio: "PERDIDO"}`) —
 * `stageByName` casa por `includes`, então "PERDIDO" encontra "Perdido".
 */
-- ⚠️ `stages.location_id` é NOT NULL e não tem default (a RLS multi-tenant
-- depende dela). Omitir custou uma tentativa: `23502`.
insert into public.stages (location_id, pipeline_id, name, position)
select p.location_id, p.id, e.nome, e.pos
  from public.pipelines p
  cross join (values
    ('NOVO LEAD', 0),
    ('Em contato', 1),
    ('Qualificado', 2),
    ('Ganho', 3),
    ('Perdido', 4)
  ) as e(nome, pos)
 where lower(p.name) = 'controle de leads'
   and not exists (
     select 1 from public.stages s
      where s.pipeline_id = p.id and lower(s.name) = lower(e.nome)
   );

-- ------------------------------------------------------------
-- 3. Os cards mal arquivados voltam para o lugar
-- ------------------------------------------------------------
/*
 * ⚠️ **Critério ESTREITO, e cada condição exclui um caso legítimo:**
 *
 *  · `source = 'Bot'` — só o que o BOT criou. Medido: existem 2 cards
 *    `source = 'Conversas'` de gente da Secretaria, criados pelo "Enviar para
 *    pipeline" do inbox, onde a PESSOA escolhe o funil. Mover esses desfaria uma
 *    decisão humana (o princípio da 0090) e eles FICAM no Comercial.
 *
 *  · dono de Secretaria/Financeiro — os 37 cards de Alberto, Rogério e Paulo e
 *    os dos admins ficam no Comercial, que é onde devem estar.
 *
 *  · etapa mapeada explicitamente — nada de adivinhar, que é a origem de todo
 *    este problema. Medido: 293 cards, sendo 291 em "Entrada", 1 em "Em contato"
 *    e 1 em "Perdido Quente".
 *
 * ⚠️ O `status` é preservado pelo mapeamento: Entrada(open) → NOVO LEAD(open),
 * Em contato(open) → Em contato(open), Perdido Quente(lost) → Perdido(lost).
 * Sem isso um card perdido reapareceria como aberto no funil novo.
 *
 * ⚠️ Um contato tem DOIS cards nesta leva, então ele fica com dois no funil novo.
 * O código tolera: `ensureCard`, `syncCard` e `assignLeadTo` todos usam
 * `.limit(1)` ANTES do `.maybeSingle()`, então nenhum estoura com linha repetida.
 */
-- ⚠️ Subconsultas escalares, e não `max(case ... then s.id end)`: **não existe
-- `max(uuid)` no Postgres** (`42883`), e o erro só aparece ao executar. Custou
-- uma tentativa — e assim o mapeamento fica explícito, etapa por etapa.
with destino as (
  select p.id as pipeline_id,
         (select s.id from public.stages s
           where s.pipeline_id = p.id and lower(s.name) = 'novo lead'  limit 1) as novo_lead,
         (select s.id from public.stages s
           where s.pipeline_id = p.id and lower(s.name) = 'em contato' limit 1) as em_contato,
         (select s.id from public.stages s
           where s.pipeline_id = p.id and lower(s.name) = 'perdido'    limit 1) as perdido
    from public.pipelines p
   where lower(p.name) = 'controle de leads'
),
mover as (
  select o.id,
         case
           when lower(s.name) = 'entrada'        then d.novo_lead
           when lower(s.name) = 'em contato'     then d.em_contato
           when lower(s.name) like 'perdido%'    then d.perdido
         end as nova_etapa,
         d.pipeline_id
    from public.opportunities o
    join public.pipelines pc on pc.id = o.pipeline_id and lower(pc.name) = 'comercial'
    join public.stages s on s.id = o.stage_id
    join public.location_members m on m.user_id = o.owner_id
    join public.departments dep on dep.id = m.department_id
    cross join destino d
   where o.source = 'Bot'
     and dep.name in ('Secretaria', 'Financeiro')
)
update public.opportunities o
   set pipeline_id = mv.pipeline_id,
       stage_id    = mv.nova_etapa
  from mover mv
 where o.id = mv.id
   and mv.nova_etapa is not null;
