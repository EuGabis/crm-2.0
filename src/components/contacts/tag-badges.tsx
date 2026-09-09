"use client";

import { Badge } from "@/components/ui/badge";
import { etiquetasVisiveis, useContactTags } from "@/lib/data/repos/db/tags";

/**
 * As etiquetas de um contato, como selo.
 *
 * 🔴 Existe para não haver duas respostas para "o que é etiqueta". A lista de
 * Contatos e o detalhe do contato desenhavam `contact.tags` cru, e o print do
 * Gabriel (2026-09-09) mostra a coluna Tags inteira tomada por
 * `lito-avioes-e-musicas_export` — o carimbo que veio no CSV do CRM antigo, em
 * quase toda a base. Quem lê a tela não distingue o carimbo da etiqueta que a
 * equipe marcou, e era justamente a etiqueta marcada que não aparecia.
 *
 * ⚠️ **Um componente para os dois lugares**, pelo mesmo motivo do `TagPicker`:
 * em cópias separadas, a regra de "o que aparece" divergiria na primeira
 * mudança e uma tela mostraria o que a outra esconde.
 *
 * ⚠️ **Não apaga nada.** O carimbo continua gravado em `contacts.tags` e as
 * listas inteligentes, as campanhas e a exportação seguem enxergando-o — o que
 * muda é o que a TELA mostra. Apagar do array seria irreversível e levaria junto
 * a única marca de qual lote de importação trouxe cada contato.
 */
export function TagBadges({ tags, className }: { tags?: string[] | null; className?: string }) {
  const { tags: catalogo, loaded } = useContactTags();
  const etiquetas = etiquetasVisiveis(tags, catalogo, loaded);
  if (etiquetas.length === 0) return null;
  return (
    <div className={className ?? "flex flex-wrap gap-1"}>
      {etiquetas.map((t) => (
        <Badge key={t} variant="secondary" className="text-[10px]">
          {t}
        </Badge>
      ))}
    </div>
  );
}
