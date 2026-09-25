import type { FormField } from "@/lib/data/types";

/**
 * Tipos de entrada do formulário embutível e o destino de cada resposta.
 *
 * ⚠️ São DUAS perguntas diferentes, e a tela antiga só tinha uma: o seletor que
 * parecia "tipo" era, na verdade, ONDE o dado é gravado — e todo campo novo
 * nascia gravado em "Empresa". Três perguntas ("Curso de interesse", "Qual
 * horário fica melhor", ...) mapeadas para Empresa sobrescreviam
 * `contacts.company` umas às outras, e só a última sobrevivia.
 *
 * Mora em `lib/` para o editor, o script embutido e a rota de envio usarem a
 * MESMA lista — e para ter teste (o Node não roda JSX).
 */

export const TIPOS: { value: FormField["type"]; label: string }[] = [
  { value: "text", label: "Texto curto" },
  { value: "textarea", label: "Texto longo" },
  { value: "email", label: "E-mail" },
  { value: "tel", label: "Telefone" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "time", label: "Hora" },
  { value: "datetime", label: "Data e hora" },
  { value: "select", label: "Lista (uma opção)" },
  { value: "multi", label: "Múltipla escolha" },
];

/** Tipos que precisam da lista de opções. */
export const COM_OPCOES: FormField["type"][] = ["select", "multi"];

export const DESTINOS: { value: string; label: string }[] = [
  { value: "custom", label: "Campo do contato" },
  { value: "name", label: "Nome" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone/WhatsApp" },
  { value: "company", label: "Empresa" },
];

/**
 * Nome do campo personalizado onde a resposta é gravada, ou null quando o
 * destino é uma coluna do contato (nome, e-mail...).
 *
 * `custom` (sem nome) usa o RÓTULO da pergunta — é o que faz a resposta aparecer
 * no cadastro do contato com o texto que o lead leu. `custom:<nome>` é o formato
 * antigo e continua valendo.
 */
export function campoPersonalizado(f: Pick<FormField, "mapsTo" | "label" | "key">): string | null {
  if (f.mapsTo === "custom") return (f.label || f.key).trim() || f.key;
  if (typeof f.mapsTo === "string" && f.mapsTo.startsWith("custom:")) return f.mapsTo.slice(7);
  return null;
}

const DOIS = (n: string) => n.padStart(2, "0");

/**
 * O valor como fica gravado no contato.
 *
 * ⚠️ Data e hora saem do navegador em ISO ("2026-09-25", "2026-09-25T14:30"),
 * que é como o `<input>` entrega. Gravado assim, o atendente lê "2026-09-25" no
 * cadastro; convertido aqui, lê "25/09/2026". A conversão é por TEXTO, sem
 * `new Date`: `new Date("2026-09-25")` é meia-noite UTC, que no Brasil é o dia
 * ANTERIOR — a mesma armadilha de `lib/periodo.ts`.
 */
export function valorGravado(tipo: FormField["type"], raw: unknown): string {
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean).join(", ");
  const s = (raw ?? "").toString().trim();
  if (!s) return "";
  if (tipo === "date") {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
  }
  if (tipo === "datetime") {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]} ${DOIS(m[4])}:${m[5]}` : s;
  }
  if (tipo === "time") {
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    return m ? `${DOIS(m[1])}:${m[2]}` : s;
  }
  return s;
}

/** Opções de uma lista, uma por linha, sem vazias nem repetidas. */
export function opcoesDoTexto(texto: string): string[] {
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const l of texto.split(/\r?\n/)) {
    const v = l.trim();
    if (!v || vistas.has(v.toLowerCase())) continue;
    vistas.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}
