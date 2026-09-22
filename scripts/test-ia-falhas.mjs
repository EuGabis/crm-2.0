/**
 * O motivo da falha da OpenAI: a mensagem certa e a decisao de reenfileirar.
 *
 * 🔴 Existe por um defeito REAL, do mesmo dia em que a funcao nasceu. A conta
 * ficou sem saldo e a OpenAI respondeu **429 · credit_balance_exhausted**; a
 * primeira versao perguntava `status === 429` ANTES de olhar o codigo, entao a
 * tela disse *"tente de novo em alguns instantes"* para uma conta sem dinheiro —
 * o conselho exatamente oposto ao certo. O atendente reclica para sempre e
 * ninguem vai ao painel de faturamento.
 *
 * ⚠️ Mensagem de erro que aponta a conduta ERRADA e pior que mensagem generica:
 * a generica ao menos faz a pessoa perguntar. E a mesma licao do #131042 do
 * WhatsApp, cujo "your payment method" fazia pensar no cartao do ALUNO.
 *
 * Roda direto no Node 24 (`npm run test:ia`), sem runner de teste.
 */
import { ErroOpenAI, motivoDaFalhaIA, falhaDeConta } from "../src/lib/ai/openai.ts";

let ok = 0;
let falhas = 0;
function eq(rotulo, obtido, esperado) {
  const bate = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (bate) ok++;
  else {
    falhas++;
    console.error(
      `  FALHOU  ${rotulo}\n    obtido:   ${JSON.stringify(obtido)}\n    esperado: ${JSON.stringify(esperado)}`
    );
    return;
  }
  console.log(`  ok  ${rotulo}`);
}

const erro = (status, code, message = "mensagem da openai") =>
  new ErroOpenAI(message, status, code);

console.log("\nmotivoDaFalhaIA() - conta sem saldo\n");

{
  /*
   * 🔴 [real] O caso do print de 22/09. As tres condicoes juntas sao o teste:
   * diz SEM CREDITO, NAO manda tentar de novo, e carrega o codigo tecnico.
   */
  const m = motivoDaFalhaIA(erro(429, "credit_balance_exhausted"));
  eq("[real] 429+credit_balance_exhausted diz SEM CREDITO", m.includes("SEM CRÉDITO"), true);
  eq("[real] ... e NAO manda tentar de novo", m.toLowerCase().includes("tente de novo em alguns"), false);
  eq("[real] ... e diz onde resolver", m.includes("Billing"), true);
  eq("[real] ... e carrega o codigo tecnico", m.includes("429 · credit_balance_exhausted"), true);

  // Os outros dois nomes que a OpenAI usa para a mesma coisa, conforme o plano.
  eq(
    "429+insufficient_quota tambem e sem credito",
    motivoDaFalhaIA(erro(429, "insufficient_quota")).includes("SEM CRÉDITO"),
    true
  );
  eq(
    "429+billing_hard_limit_reached tambem e sem credito",
    motivoDaFalhaIA(erro(429, "billing_hard_limit_reached")).includes("SEM CRÉDITO"),
    true
  );
  eq("402 sem codigo e sem credito", motivoDaFalhaIA(erro(402, undefined)).includes("SEM CRÉDITO"), true);
}

console.log("\nmotivoDaFalhaIA() - o que NAO pode virar 'sem credito'\n");

{
  /*
   * ⚠️ O lado oposto, que e onde um casamento largo demais faria dano: limite
   * por minuto PASSA sozinho, e mandar o admin recarregar o cartao por causa
   * dele seria mandar gastar dinheiro a toa.
   */
  const m = motivoDaFalhaIA(erro(429, "rate_limit_exceeded"));
  eq("429+rate_limit_exceeded NAO e sem credito", m.includes("SEM CRÉDITO"), false);
  eq("... e manda esperar", m.includes("tente de novo"), true);
  eq("... e diz que e por minuto", m.includes("por minuto"), true);

  eq(
    "401 fala da CHAVE, nao do saldo",
    motivoDaFalhaIA(erro(401, "invalid_api_key")).includes("OPENAI_API_KEY"),
    true
  );
  eq(
    "404 fala do MODELO",
    motivoDaFalhaIA(erro(404, "model_not_found")).includes("OPENAI_MODEL"),
    true
  );
  eq("500 diz que a OpenAI caiu", motivoDaFalhaIA(erro(503, undefined)).includes("fora do ar"), true);

  // Sem a env, o erro nem chega a ser da OpenAI — vem de `apiKey()`.
  eq(
    "OPENAI_API_KEY ausente",
    motivoDaFalhaIA(new Error("OPENAI_API_KEY ausente no servidor")).includes("não está configurada"),
    true
  );

  // Erro desconhecido preserva a mensagem em vez de virar "falhou".
  eq(
    "400 desconhecido preserva a mensagem da OpenAI",
    motivoDaFalhaIA(erro(400, "invalid_request_error", "Audio file is too short")).includes(
      "Audio file is too short"
    ),
    true
  );
}

console.log("\nfalhaDeConta() - reenfileirar ou nao\n");

{
  /*
   * 🔴 Esta funcao decide entre `pendente` (tenta de novo no proximo tique) e
   * `falhou` (definitivo). Errar para o lado do `falhou` PERDE o audio: a fila
   * so olha `pendente`, entao nem recarregando o saldo ele seria transcrito.
   */
  eq("sem credito -> reenfileira", falhaDeConta(erro(429, "credit_balance_exhausted")), true);
  eq("chave recusada -> reenfileira", falhaDeConta(erro(401, "invalid_api_key")), true);
  eq("limite por minuto -> reenfileira", falhaDeConta(erro(429, "rate_limit_exceeded")), true);
  eq("openai fora do ar -> reenfileira", falhaDeConta(erro(500, undefined)), true);
  eq("env ausente -> reenfileira", falhaDeConta(new Error("OPENAI_API_KEY ausente no servidor")), true);

  /*
   * ⚠️ E o lado que NAO pode reenfileirar: arquivo ruim nao melhora tentando de
   * novo, e um `pendente` eterno vira laco infinito — cinco chamadas por minuto
   * para sempre, que e exatamente o que o estado `ignorado` existe para evitar.
   */
  eq("arquivo recusado (400) NAO reenfileira", falhaDeConta(erro(400, "invalid_request_error")), false);
  eq("404 de modelo NAO reenfileira", falhaDeConta(erro(404, "model_not_found")), false);
  eq("erro qualquer NAO reenfileira", falhaDeConta(new Error("deu ruim")), false);
}

console.log(`\n${ok} assercoes ok, ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
