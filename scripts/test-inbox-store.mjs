/**
 * O Realtime nao pode apagar o contato da conversa.
 *
 * ⚠️ O payload do `postgres_changes` e a LINHA CRUA da tabela — sem o join do
 * contato. O manipulador de UPDATE SUBSTITUIA a entrada da store por ele, entao
 * toda conversa que se mexesse perdia nome, telefone e etiquetas.
 *
 * Causa unica de tres sintomas que pareciam separados (2026-09-09): a lista
 * mostrando o literal "Contato", a etiqueta sumindo da linha, e o filtro por
 * etiqueta nao achando nada. O F5 "consertava" porque o load() traz o join —
 * ate o Realtime apagar de novo.
 *
 * Roda direto no Node 24 (`npm run test:inbox`), sem runner de teste.
 */
import { preservarContato, mesclarMensagens } from "../src/lib/data/repos/db/conversations.ts";

let ok = 0;
let falhas = 0;
function eq(rotulo, obtido, esperado) {
  const bate = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (bate) ok++;
  else {
    falhas++;
    console.error(
      `  x ${rotulo}\n      obtido:   ${JSON.stringify(obtido)}\n      esperado: ${JSON.stringify(esperado)}`,
    );
  }
}

const comContato = {
  id: "c1",
  lastMessageAt: "2026-09-09T10:00:00Z",
  unreadCount: 0,
  contactFirstName: "Vitoria",
  contactLastName: "Souza",
  contactPhone: "+5535845398 46",
  contactEmail: "v@x.com",
  contactTags: ["INTERESSADO PP"],
};
// O que o Realtime entrega: a linha crua, sem NENHUM campo de contato.
const doRealtime = {
  id: "c1",
  lastMessageAt: "2026-09-09T11:30:00Z",
  unreadCount: 3,
  contactFirstName: undefined,
  contactLastName: undefined,
  contactPhone: undefined,
  contactEmail: undefined,
  contactTags: undefined,
};

console.log("\npreservarContato() - o Realtime nao apaga o contato\n");

{
  const r = preservarContato(doRealtime, comContato);
  eq("o nome sobrevive ao update", r.contactFirstName, "Vitoria");
  eq("o sobrenome sobrevive", r.contactLastName, "Souza");
  eq("o telefone sobrevive", r.contactPhone, "+5535845398 46");
  eq("as ETIQUETAS sobrevivem", r.contactTags, ["INTERESSADO PP"]);
  // ...e o que o Realtime REALMENTE traz precisa vencer:
  eq("a mensagem nova vence", r.lastMessageAt, "2026-09-09T11:30:00Z");
  eq("o contador de nao lidas vence", r.unreadCount, 3);
}

/* Quando o payload TEM o contato (veio de uma leitura com join), ele vence. */
{
  const novo = { ...doRealtime, contactFirstName: "Vitoria Maria", contactTags: ["PAGO"] };
  const r = preservarContato(novo, comContato);
  eq("nome novo vence o antigo", r.contactFirstName, "Vitoria Maria");
  eq("etiqueta nova vence a antiga", r.contactTags, ["PAGO"]);
}

/* ⚠️ String VAZIA e um nome legitimo (contato sem sobrenome). Com `||` no lugar
   de `??`, o sobrenome antigo voltaria e a lista mostraria um nome que nao
   existe mais. */
{
  const novo = { ...doRealtime, contactFirstName: "Ana", contactLastName: "" };
  const r = preservarContato(novo, comContato);
  eq("sobrenome vazio NAO volta para o antigo", r.contactLastName, "");
}

/* Lista vazia de etiquetas e uma resposta valida: o contato foi desmarcado. */
{
  const novo = { ...doRealtime, contactTags: [] };
  eq("etiquetas zeradas nao voltam", preservarContato(novo, comContato).contactTags, []);
}

/* Sem versao anterior (conversa nova) nao ha o que preservar — quem completa e
   o `completarContato`, buscando o join. */
eq("sem anterior devolve o novo intacto", preservarContato(doRealtime, undefined), doRealtime);

/* A funcao irma continua valendo (regressao do "abre, carrega e some"). */
{
  const recentes = [{ id: "m2" }];
  const existentes = [{ id: "m1" }, { id: "m2" }];
  eq("mesclarMensagens nao duplica", mesclarMensagens(recentes, existentes), [{ id: "m2" }, { id: "m1" }]);
}

console.log(`\n${ok} assercoes ok, ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
