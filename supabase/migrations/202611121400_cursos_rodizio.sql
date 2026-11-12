-- Rodízio por CURSO, por vendedor (2026-11-12).
--
-- Pedido: o vendedor novo de Vendas começa recebendo só leads de Comissário;
-- depois Comissário + Mecânico; depois + Piloto; e por fim todos — sem mudar a
-- regra dos outros vendedores, e voltando à regra normal no fim.
--
-- `cursos_rodizio` NULL (ou vazio) = recebe todos os cursos — é o estado de
-- todo mundo depois desta migração, então nada muda até um admin preencher a
-- lista de alguém em Configurações → Departamentos. Limpar a lista = voltar à
-- regra normal.
--
-- Os valores são os GRUPOS que o bot grava no card ("Comissário", "Mecânico",
-- "Piloto", "Pós de Engenheiros", "Masterclass"); o código reduz o nome
-- completo da formação ao grupo (src/lib/leads/curso-rodizio.ts).
--
-- Escrita: a policy de UPDATE de location_members já é admin-only — nenhuma
-- policy nova. Leitura do rodízio: service role.
--
-- Pode ser aplicada antes ou depois do merge: o código tolera a coluna não
-- existir (trata como "ninguém restrito").

alter table public.location_members
  add column if not exists cursos_rodizio text[];

comment on column public.location_members.cursos_rodizio is
  'Rodízio por curso: NULL/vazio = recebe leads de todos os cursos. Preenchido = só entra no rodízio dos leads destes grupos de curso (ex.: {Comissário,Mecânico}).';

notify pgrst, 'reload schema';
