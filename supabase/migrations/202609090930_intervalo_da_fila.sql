-- ============================================================
-- A fila escoa com INTERVALO, em vez de ser despejada em quem logou primeiro
--
-- 🔴 Relato do Gabriel (2026-09-09): "o Daniel da secretaria não está recebendo
-- os contatos pelo bot… pelo o que vi, a Beatriz logou primeiro que o Daniel e
-- o bot mandou tudo para a fila dela."
--
-- A leitura dele está certa, e o mecanismo é a varredura da fila que entrou em
-- 08/09 (`distribuirFilaDoSetor`). Ela roda a cada minuto e entrega a fila a
-- quem está online — com UMA pessoa online, ela leva tudo:
--
--   · ANTES: ninguém online → o lead ficava na fila do setor, VISÍVEL A TODOS, e
--     quem chegasse primeiro puxava;
--   · DEPOIS: a primeira pessoa que loga absorve o acumulado inteiro (o teto era
--     25 por tique, o que com uma pessoa só é despejo).
--
-- Isto estava anotado no `AGENTS.md` de ontem como pendência — "a fila é
-- distribuída para quem está online, seja quantos forem… não há noção de carga
-- por atendente". Cobrou no dia seguinte.
--
-- ⚠️ **A regra é do Gabriel, literal:** o lead que espera HÁ MAIS TEMPO vai
-- primeiro, UM por vez, e depois aguarda 7 minutos antes do próximo — a pausa é
-- a janela para outro atendente logar e entrar no rodízio. **Só na Secretaria.**
--
-- Idempotente.
-- ============================================================

/*
 * ⚠️ **COLUNA, e não o nome do setor no código.** A tentação era
 * `if (dep.name === 'Secretaria')`. Este repositório já tropeçou em casar por
 * NOME mais de uma vez (foi assim que o bot da secretaria acabou escrevendo no
 * funil Comercial), e renomear o setor apagaria a regra em silêncio. Com
 * coluna, o padrão `0` = sem intervalo preserva o comportamento de todos os
 * outros setores e a Secretaria opta explicitamente.
 */
alter table public.departments
  add column if not exists intervalo_fila_min integer not null default 0,
  -- Quando a varredura entregou o último lead DESTE setor. É a memória sem a
  -- qual o intervalo não existe: sem ela, todo tique acharia que pode entregar.
  add column if not exists ultima_da_fila_em timestamptz;

comment on column public.departments.intervalo_fila_min is
  'Minutos de espera entre um lead e o próximo na varredura da fila. 0 = sem intervalo (entrega tudo o que couber no teto do tique).';

-- Só a Secretaria, como pedido. `where` por nome é aceitável AQUI porque é um
-- retroativo de uma vez — o que não pode é o CÓDIGO decidir por nome.
update public.departments set intervalo_fila_min = 7 where name = 'Secretaria';
