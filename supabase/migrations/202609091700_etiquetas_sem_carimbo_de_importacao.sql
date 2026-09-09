-- ============================================================
-- O catálogo de etiquetas absorveu o CARIMBO DA IMPORTAÇÃO — tirar de lá
--
-- Relato do Gabriel (2026-09-09), com print da caixa de entrada e da tela de
-- Contatos: *"não é pra aparecer de onde ela veio importada, apenas a etiqueta
-- que é marcada"*. Na coluna Tags, linha após linha, só
-- `lito-avioes-e-musicas_export...` — e na linha da conversa ele ocupava as
-- duas vagas disponíveis, empurrando a etiqueta que o vendedor marcou para o
-- "+2".
--
-- 🔴 **A causa é uma decisão MINHA na 202609091600.** Aquela migração termina
-- absorvendo para o catálogo toda etiqueta já em uso nos contatos, com este
-- raciocínio, que continua certo: etiqueta que veio da importação seguiria
-- gravada e funcionando em lista inteligente, mas sumiria de vista — ninguém
-- conseguiria marcá-la de novo nem filtrar por ela.
--
-- ⚠️ O que faltou é a distinção entre as DUAS coisas que moram em
-- `contacts.tags`: a etiqueta que a equipe marca (a categoria do lead) e o
-- CARIMBO DE PROCEDÊNCIA que o CSV do CRM antigo trouxe numa coluna de tags.
-- O carimbo está em quase toda a base — ou seja, ele não separa nada, que é
-- justamente o que se espera de uma etiqueta. Absorvido, ele virou item de um
-- catálogo curado e passou a aparecer em toda tela que mostra etiqueta.
--
-- ⚠️ **NÃO mexe em `contacts.tags`.** O carimbo continua gravado no contato, e
-- as listas inteligentes, as campanhas e a exportação seguem enxergando-o —
-- inclusive quem usa "veio da importação" como recorte. O que muda é ele deixar
-- de ser oferecido para marcar e deixar de ser desenhado; quem esconde na tela é
-- `etiquetasVisiveis` (`db/tags.ts`), que passa a mostrar só o que está aqui.
-- Apagar do array seria irreversível e levaria junto a única marca de qual lote
-- de importação trouxe cada contato.
--
-- ⚠️ Se a 202609091600 for reexecutada, o passo de absorção **traz o carimbo de
-- volta** (ele continua nos contatos). Ela não foi reescrita porque já está
-- aplicada — o padrão deste repositório —, então reaplicar aquela pede reaplicar
-- esta. As duas são idempotentes.
-- ============================================================

/*
 * O critério é o NOME, e é o único honesto aqui: `position = 900` marcaria todas
 * as absorvidas (entre elas "formulário mma", que é etiqueta de verdade, gerada
 * pelo formulário do site), e a data de criação não distingue nada — a
 * absorção gravou tudo no mesmo instante.
 *
 * `ilike` cobre as variações de sufixo que o export gerou (o print mostra pelo
 * menos duas, mais um "+2" na linha), sem precisar listar uma a uma.
 */
delete from public.contact_tags
 where name ilike 'lito-avioes-e-musicas%';

/*
 * ⚠️ Conferência para o Gabriel decidir o que sobrou: as etiquetas absorvidas
 * (position 900) com quantos contatos usam cada uma. Etiqueta em UM contato
 * costuma ser erro de digitação da época do texto livre; etiqueta em milhares é
 * carimbo, não categoria.
 *
 *   select t.name, t.position,
 *          (select count(*) from public.contacts c where t.name = any (c.tags)) as contatos
 *     from public.contact_tags t
 *    where t.position >= 900
 *    order by contatos desc, t.name;
 *
 * Excluir pelo catálogo (Configurações → Etiquetas) não desmarca ninguém — é o
 * que a 202609091600 já decidiu e continua valendo.
 */
