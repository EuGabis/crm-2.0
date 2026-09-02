-- Lito CRM — departamento VENDAS, pronto para o time entrar
--
-- Pedido do Gabriel (02/09/2026): "preparar o CRM para o time de vendas".
-- Escolhas dele: o time são Alberto, Paulo Lopes e Rogério; o número de WhatsApp
-- é NOVO e ainda vai ser cadastrado; o escopo é **departamento + permissões +
-- rodízio** e **painel/relatório**. Funil e bot ficaram de fora.
--
-- ⚠️ **E a instrução que define esta migração: "não vamos mexer em nenhum que já
-- está lá dentro".** Então NADA de departamento, canal, vínculo, pipeline ou
-- membro existente é alterado aqui. Só se ACRESCENTA.
--
-- Isso descartou o caminho que eu ia tomar (renomear "Secretaria Backup" para
-- "Vendas", já que é lá que os três estão e é esse departamento que hoje é dono
-- do funil Comercial). Renomear seria mais simples e é exatamente o que foi
-- proibido — e com razão: aquele departamento também está vinculado ao número
-- "Backup Secretaria", que continua atendendo secretaria.

-- ── O departamento ──────────────────────────────────────────────────────────
--
-- Idempotente por (location_id, name): rodar de novo não duplica.
insert into public.departments (location_id, name, description, permissions,
                                usa_rodizio, rodizio_offline, devolver_apos_min,
                                colaborativo)
select l.id,
       'Vendas',
       'Time comercial. Rodízio ligado; número próprio a vincular quando o novo chip entrar.',
       /*
        * Permissões espelhadas nas de quem já faz esse trabalho hoje
        * ("Secretaria Backup"), com UMA diferença deliberada:
        *
        * ⚠️ `relatorios: true`. Lá está `false`, e sem isso o time não abre
        * Relatórios — que é metade do que foi pedido ("painel e relatório de
        * vendas"). A aba Atendimento e o widget de SLA checam essa permissão no
        * SERVIDOR (`lib/auth/module-access.ts`), então esconder ou mostrar na
        * tela não é o que decide.
        *
        * `pagamentos` fica FALSE: vendas não precisa ver token nem histórico de
        * cobrança da Guru, e o cruzamento de pagamento no detalhe do lead já
        * depende dessa permissão de propósito.
        */
       jsonb_build_object(
         'dashboard',   true,
         'conversas',   true,
         'contatos',    true,
         'leads',       true,
         'calendarios', true,
         'relatorios',  true,
         'automacoes',  true,
         'agentes-ia',  true,
         'midia',       true,
         'assinaturas', true,
         'pagamentos',  false,
         'marketing',   false,
         'whatsapp',    false,
         'sites',       false,
         'ai-studio',   false,
         'reputacao',   false,
         'marketplace', false
       ),
       true,   -- usa_rodizio: distribui automaticamente
       false,  -- rodizio_offline: quem está offline NÃO recebe (reversão da 0083)
       15,     -- devolver_apos_min: mesma régua da meta de SLA (0079)
       /*
        * ⚠️ `colaborativo = false`, igual ao departamento onde os três estão
        * hoje. Ligar isso deixaria cada um ver e assumir a conversa do outro —
        * decisão de operação, não de infraestrutura, e mudá-la sem pedir seria
        * inventar política de time. Fica a um clique no diálogo do departamento.
        */
       false
  from public.locations l
 where not exists (
   select 1 from public.departments d
    where d.location_id = l.id and d.name = 'Vendas'
 );

-- ── O painel do departamento ────────────────────────────────────────────────
--
-- `scope='department'` (0037): o admin monta, o departamento inteiro lê, só admin
-- edita. `is_default` para ser o painel que abre.
insert into public.dashboard_views (location_id, scope, department_id, name, widgets, is_default)
select d.location_id, 'department', d.id, 'Painel de Vendas',
       jsonb_build_array(
         -- Os três primeiros usam pipelineId 'all' e somam os funis VISÍVEIS ao
         -- usuário, então não dependem de configuração nenhuma.
         jsonb_build_object('key', 'taxa-conversao',      'pipelineId', 'all'),
         jsonb_build_object('key', 'status-oportunidade', 'pipelineId', 'all'),
         jsonb_build_object('key', 'valor-oportunidade',  'pipelineId', 'all'),
         /*
          * ⚠️ Estes dois exigem UM funil escolhido — "todos" não existe para
          * eles, porque fase pertence a um funil e somar as de vários não
          * significa nada (ver a repaginada do painel no AGENTS.md). Apontam para
          * o funil Comercial, que é o do time.
          *
          * ⚠️ **Vão aparecer VAZIOS até o passo 2 do plano.** O funil Comercial
          * tem `scope='department'` e pertence a "Secretaria Backup"; por
          * `private.pipeline_visible`, quem está em Vendas não o enxerga. Deixo
          * configurado porque é o estado final correto, e refazer o painel depois
          * seria trabalho repetido.
          */
         jsonb_build_object('key', 'funil',               'pipelineId', p.id::text),
         jsonb_build_object('key', 'distribuicao-fases',  'pipelineId', p.id::text),
         jsonb_build_object('key', 'fonte-leads'),
         -- SLA de atendimento: depende da permissão `relatorios`, ligada acima.
         jsonb_build_object('key', 'atendimento-sla')
       ),
       true
  from public.departments d
  left join public.pipelines p
    on p.location_id = d.location_id and p.name = 'Comercial'
 where d.name = 'Vendas'
   and not exists (
     select 1 from public.dashboard_views v
      where v.department_id = d.id and v.name = 'Painel de Vendas'
   );

/*
 * ⏳ **OS DOIS PASSOS QUE FALTAM, e por que NÃO estão aqui.**
 *
 * As pessoas, o funil e o número estão amarrados no departamento
 * "Secretaria Backup". Mover UM só quebra os outros dois:
 *
 *   - mover os três para Vendas AGORA, com Vendas sem canal vinculado, faz
 *     `private.channel_allowed` cair na regra "departamento sem número = SEM
 *     restrição" — eles passariam a ver TODAS as conversas da empresa, inclusive
 *     as da secretaria. Mais acesso do que têm hoje, e ninguém pediu isso;
 *   - mover o funil Comercial para Vendas agora tira ele de quem está
 *     atendendo (`private.pipeline_visible` é por departamento);
 *   - e o canal novo ainda não existe.
 *
 * Então os três acontecem JUNTOS, quando o chip novo entrar:
 *   1. cadastrar o número em /whatsapp e vinculá-lo ao departamento Vendas;
 *   2. mover Alberto, Paulo Lopes e Rogério para Vendas
 *      (Configurações → Departamentos);
 *   3. apontar o funil Comercial para Vendas (botão "Quem vê", no módulo Leads).
 *
 * Feito isso, os dois cards de funil do painel acendem sozinhos.
 */
