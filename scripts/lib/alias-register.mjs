/**
 * Liga o resolvedor de `@/` antes de o teste carregar qualquer módulo.
 *
 * Usado como `node --import ./scripts/lib/alias-register.mjs <teste>` — o
 * `--import` roda isto no thread principal antes do módulo de entrada, que é o
 * que garante que o hook já esteja registrado quando o `import` do teste
 * resolver.
 */
import { register } from "node:module";
register("./alias-loader.mjs", import.meta.url);
