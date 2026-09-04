/**
 * Resolvedor do alias `@/` para os testes que rodam no Node puro.
 *
 * ⚠️ Os testes deste repo rodam direto no Node 24 (que executa TypeScript
 * nativamente), sem runner e sem bundler — e é isso que os torna baratos de
 * escrever e rápidos de rodar. O preço é que o `@/*` do `tsconfig.json` não
 * existe para o Node: ele é invenção do TypeScript e do bundler.
 *
 * Sem este resolvedor, só dá para testar módulo que não importa nada por alias —
 * o que exclui quase todo o `src/`. Foi o que impediu de testar o webhook do
 * WhatsApp, cujo caminho de erro significa mensagem de cliente perdida.
 *
 * ⚠️ Ele não substitui o `tsconfig.json`: quem manda no build continua sendo o
 * `paths` de lá. Se aquele alias mudar, este arquivo tem de acompanhar — é a
 * duplicação assumida aqui, e é pequena (uma linha) porque o alternativo seria
 * ler e interpretar o tsconfig em tempo de execução.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

/** Raiz do projeto (este arquivo mora em scripts/lib/). */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/*
 * O especificador vem SEM extensão (`@/lib/whatsapp/client`), porque no
 * TypeScript ela é implícita. O Node exige o caminho exato, então as candidatas
 * são testadas na mesma ordem que o resolvedor de módulos do TS usa.
 */
const CANDIDATAS = [".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx"];

function resolverAlias(especificador) {
  const relativo = especificador.slice(2); // tira "@/"
  const base = path.join(RAIZ, "src", relativo);
  if (existsSync(base) && path.extname(base)) return pathToFileURL(base).href;
  for (const ext of CANDIDATAS) {
    const tentativa = base + ext;
    if (existsSync(tentativa)) return pathToFileURL(tentativa).href;
  }
  return null;
}

/**
 * ⚠️ O alias não era o único problema: no TypeScript o import RELATIVO também
 * dispensa extensão (`./templates`), e o Node exige o caminho exato. Um módulo
 * resolvido pelo alias importa os vizinhos assim, então sem isto o resolvedor
 * atravessava a primeira porta e batia na segunda.
 */
function resolverRelativo(especificador, parentURL) {
  if (!parentURL || !/^\.\.?\//.test(especificador)) return null;
  const base = path.resolve(path.dirname(fileURLToPath(parentURL)), especificador);
  if (existsSync(base) && path.extname(base)) return null; // o Node resolve sozinho
  for (const ext of CANDIDATAS) {
    const tentativa = base + ext;
    if (existsSync(tentativa)) return pathToFileURL(tentativa).href;
  }
  return null;
}

export function resolve(especificador, contexto, proximo) {
  if (especificador.startsWith("@/")) {
    const url = resolverAlias(especificador);
    // Não achou? Deixa o Node errar com a mensagem dele, que é mais útil do que
    // uma nossa: ela diz quem importou.
    if (url) return proximo(url, contexto);
  }
  const relativo = resolverRelativo(especificador, contexto.parentURL);
  if (relativo) return proximo(relativo, contexto);
  return proximo(especificador, contexto);
}
