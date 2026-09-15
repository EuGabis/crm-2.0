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
import {
  preservarContato,
  mesclarMensagens,
  cursorDeConversas,
} from "../src/lib/data/repos/db/conversations.ts";
import { ordemAncorada } from "../src/lib/inbox/ordem-ancorada.ts";

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

/* ================================================================== *
 * O cursor da varredura de CONVERSAS
 * ==================================================================
 *
 * 🔴 Relato de 2026-09-15: "a tela de conversas nao atualiza as vezes; fica com
 * a tela aberta e atualiza manualmente, e ai sim aparece".
 *
 * `resyncConversations` fazia `select()` sem `range` e sem `order` — a armadilha
 * no 7 do AGENTS.md pela TERCEIRA vez: o PostgREST corta em 1000 sem erro, e sem
 * `order` QUAIS mil voltam e indefinido. Sao 4.049 conversas neste banco. Agora
 * ela pergunta "o que mudou desde X", e este cursor e o X.
 *
 * ⚠️ Um erro aqui NAO da erro nenhum: varre demais (caro) ou pula conversa (a
 * lista congela). E o tipo de regra que so aparece como reclamacao dias depois.
 */
{
  eq("store vazia nao tem cursor", cursorDeConversas([]), null);
  eq(
    "o cursor e a conversa alterada mais RECENTE",
    cursorDeConversas([
      { id: "a", updatedAt: "2026-09-15T10:00:00Z" },
      { id: "b", updatedAt: "2026-09-15T12:00:00Z" },
      { id: "c", updatedAt: "2026-09-15T11:00:00Z" },
    ]),
    "2026-09-15T12:00:00Z",
  );
  /*
   * ⚠️ UMA conversa sem carimbo derruba o cursor inteiro, e isso e deliberado:
   * enquanto a migracao 202609151100 nao estiver aplicada o campo chega
   * `undefined`, e um cursor "pela metade" pularia justamente as conversas sem
   * carimbo — em silencio. Sem cursor, a varredura cai na lista inteira
   * (paginada), que e mais cara e esta CERTA.
   */
  eq(
    "conversa sem carimbo derruba o cursor",
    cursorDeConversas([{ id: "a", updatedAt: "2026-09-15T10:00:00Z" }, { id: "b" }]),
    null,
  );
  eq("nenhuma tem carimbo (migracao nao aplicada)", cursorDeConversas([{ id: "a" }]), null);
  // Texto ISO compara cronologicamente — e o que permite o `>` sem virar Date.
  eq(
    "compara como texto ISO",
    cursorDeConversas([
      { id: "a", updatedAt: "2026-09-09T23:59:59Z" },
      { id: "b", updatedAt: "2026-09-10T00:00:00Z" },
    ]),
    "2026-09-10T00:00:00Z",
  );
}


console.log("\nordemAncorada() - a lista nao pula sob o dedo de quem rola\n");

// Atalho: a lista real e de conversas, mas a funcao so olha `id`.
const L = (...ids) => ids.map((id) => ({ id }));
const IDS = (lista) => lista.map((c) => c.id);

{
  // Sem foto (usuario no topo) a ordem e a que a store mandou — reordenar ali
  // e o comportamento certo, e nao ha nada sob o dedo de ninguem.
  eq("sem foto, nada muda", IDS(ordemAncorada(L("a", "b", "c"), null)), ["a", "b", "c"]);
  eq("foto vazia nao congela", IDS(ordemAncorada(L("a", "b"), [])), ["a", "b"]);
}

{
  /*
   * A REGRESSAO, com o caso do relato: a lista esta em a,b,c,d; o vendedor
   * rolou ate `d` e respondeu. A store devolve `d` no topo. Congelada, a
   * posicao nao muda — e e isso que o poupa de "descer tudo de novo".
   */
  const foto = ["a", "b", "c", "d"];
  eq(
    "responder nao move a conversa de lugar",
    IDS(ordemAncorada(L("d", "a", "b", "c"), foto)),
    ["a", "b", "c", "d"],
  );
  eq(
    "mensagem de OUTRO cliente tambem nao empurra",
    IDS(ordemAncorada(L("b", "a", "c", "d"), foto)),
    ["a", "b", "c", "d"],
  );
}

{
  // ⚠️ Conversa nova entra no FIM: no topo ela empurraria a lista inteira para
  // baixo, que e exatamente o efeito que a funcao existe para evitar.
  eq(
    "conversa nova entra no fim, nao no topo",
    IDS(ordemAncorada(L("nova", "a", "b"), ["a", "b"])),
    ["a", "b", "nova"],
  );
  eq(
    "duas novas mantem a ordem que a store deu",
    IDS(ordemAncorada(L("n2", "n1", "a"), ["a"])),
    ["a", "n2", "n1"],
  );
}

{
  // A foto e so a ORDEM. Quem foi finalizado, arquivado ou saiu do filtro some,
  // em vez de ficar preso na tela por causa do congelamento.
  eq(
    "conversa que saiu do filtro some",
    IDS(ordemAncorada(L("a", "c"), ["a", "b", "c"])),
    ["a", "c"],
  );
  eq("lista vazia continua vazia", IDS(ordemAncorada([], ["a", "b"])), []);
}

{
  // O objeto devolvido e o da LISTA, nunca o da foto: e o que mantem previa,
  // nao lidas e etiqueta chegando ao vivo com a ordem parada.
  const lista = [{ id: "a", previa: "nova" }];
  eq(
    "o conteudo vem da lista, so a ordem vem da foto",
    ordemAncorada(lista, ["a"])[0].previa,
    "nova",
  );
}

console.log(`\n${ok} assercoes ok, ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
