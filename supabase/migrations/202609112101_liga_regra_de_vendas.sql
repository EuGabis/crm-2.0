-- ============================================================
-- Liga a regra nova NO SETOR DE VENDAS (Paulo, Alberto e Rogério).
--
-- ⚠️ **Arquivo separado, e aplicado SÓ DEPOIS do merge.** Neste projeto o código
-- chega à produção ANTES da migração (deploy automático no merge, migração
-- manual). A 202609112100 é aditiva e pode ir antes; esta MUDA comportamento, e
-- aplicada cedo faria o rodízio distribuir para quem está offline enquanto o
-- código no ar ainda não sabe segurar o SLA — ou seja, lead caindo em Pendentes
-- e sendo devolvido 20 minutos depois, com o vendedor dormindo.
--
-- Foi exatamente assim que o envio quebrou em 01/09 e a aba de leads em 03/09.
-- ============================================================

/*
 * Vendas: o setor do pedido. Igualdade EXATA no nome, nunca `ilike '%vendas%'` —
 * "Secretaria Backup" já foi o setor do time comercial, e casar por trecho já
 * confundiu setor neste repositório mais de uma vez.
 */
update public.departments
   set rodizio_offline = true,   -- offline PARTICIPA e o lead vai para Pendentes
       sla_so_online   = true    -- o prazo de 20 min só corre com ele online
 where name = 'Vendas';

/*
 * ⚠️ Confira as LINHAS AFETADAS: deve ser 1. Zero significa que o setor não se
 * chama exatamente "Vendas" neste banco, e aí NADA foi ligado — seguro, mas não
 * é o que esta migração pretende. A consulta abaixo mostra o estado final.
 *
 * ⚠️ E confira que só Vendas mudou: na Secretaria o offline receber é o defeito
 * medido em 28/08 ("a fila de espera dos alunos ficou muito alta").
 */
do $$
declare r record;
begin
  for r in
    select name, usa_rodizio, rodizio_offline, sla_so_online,
           dividir_igualmente, devolver_apos_min
      from public.departments order by name
  loop
    raise notice 'setor % · rodizio=% · offline_recebe=% · sla_so_online=% · igual=% · devolve_apos=%',
      r.name, r.usa_rodizio, r.rodizio_offline, r.sla_so_online,
      r.dividir_igualmente, r.devolver_apos_min;
  end loop;
end $$;
