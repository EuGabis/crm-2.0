/**
 * O webhook do WhatsApp pede reenvio quando o banco está fora — e NÃO pede
 * quando o problema é a mensagem.
 *
 * ⚠️ Existe por causa de uma perda de dado silenciosa: o webhook respondia
 * **200 mesmo sem ter gravado**, e para a Meta 200 significa "recebi, não
 * reenvie". Não há fila nossa onde a mensagem ficaria — ela deixava de existir.
 * Bastava uma indisponibilidade de dois minutos (o reinício de uma troca de
 * compute, por exemplo) para perder todas as mensagens da janela.
 *
 * ⚠️ E é justamente o caminho que NUNCA roda em desenvolvimento: em produção ele
 * só aparece quando o banco cai, e aí não há como reproduzir. Sem teste, a
 * correção seria fé.
 *
 * ⚠️ O outro lado é igualmente importante: mensagem que o CRM não sabe tratar
 * tem de continuar respondendo 200. Pedindo reenvio, a Meta reenviaria o mesmo
 * lote para sempre e ainda poderia suspender a inscrição do webhook. Metade das
 * asserções vigia esse lado.
 *
 * Roda direto no Node 24 (`npm run test:webhook`), sem runner de teste.
 */
import { processarLote } from "../src/app/api/whatsapp/webhook/route.ts";

let ok = 0;
let falhas = 0;
function eq(rotulo, obtido, esperado) {
  const bate = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (bate) ok++;
  else {
    falhas++;
    console.error(
      `  ✗ ${rotulo}\n      obtido:   ${JSON.stringify(obtido)}\n      esperado: ${JSON.stringify(esperado)}`
    );
  }
}

/*
 * O log de falha é `console.error` de propósito (o defeito original era
 * `catch {}` sem log nenhum). Aqui ele é capturado para poder ser CONFERIDO —
 * um webhook que decide certo e não registra o motivo repete a investigação do
 * áudio, que custou quinze rodadas por falta de motivo gravado.
 */
const erroReal = console.error;
let logs = [];
function capturar() {
  logs = [];
  console.error = (...a) => logs.push(a.join(" "));
}
function soltar() {
  console.error = erroReal;
}

/**
 * `db` falso no formato do supabase-js: só o encadeamento que o webhook usa.
 *
 * `porTabela` diz o que cada tabela responde — `{ error }` para simular banco
 * fora, `{ data }` para responder normalmente. `vivoDepois` permite o cenário
 * mais interessante: a tabela `messages` falha (mensagem problemática) mas
 * `whatsapp_channels` continua respondendo, que é exatamente o caso em que NÃO
 * se deve pedir reenvio.
 */
function fakeDb(porTabela) {
  const chamadas = [];
  const encadeado = (resposta) => {
    const alvo = {
      select: () => alvo,
      eq: () => alvo,
      limit: () => alvo,
      order: () => alvo,
      maybeSingle: () => Promise.resolve(resposta),
      // Sem `.maybeSingle()`, o await cai direto no thenable.
      then: (res, rej) => Promise.resolve(resposta).then(res, rej),
    };
    return alvo;
  };
  return {
    chamadas,
    from(tabela) {
      chamadas.push(tabela);
      const r = porTabela[tabela];
      if (typeof r === "function") return encadeado(r());
      return encadeado(r ?? { data: null, error: null });
    },
  };
}

const CANAL = {
  id: "canal-1",
  location_id: "loc-1",
  daily_limit: 1000,
  phone_number_id: "1292488653952451",
  bot_flow: null,
};

/** Lote com UMA mensagem de texto, no formato que a Meta manda. */
function loteComMensagem(pnid = "1292488653952451") {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: pnid },
              contacts: [{ profile: { name: "Cliente" } }],
              messages: [{ id: "wamid.TESTE1", from: "5511999999999", type: "text", text: { body: "oi" } }],
            },
          },
        ],
      },
    ],
  };
}

/** Lote com UM evento de status. */
function loteComStatus() {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "1292488653952451" },
              statuses: [{ id: "wamid.TESTE1", status: "delivered" }],
            },
          },
        ],
      },
    ],
  };
}

const ERRO_REDE = { data: null, error: { message: "fetch failed", code: undefined } };

console.log("── Banco fora: TEM de pedir reenvio ──");
{
  // 1. Cai já na busca do canal — era aqui que `if (!channel) continue` pulava a
  //    mensagem e o webhook ainda respondia 200.
  capturar();
  const db = fakeDb({ whatsapp_channels: () => ERRO_REDE });
  const r = await processarLote(db, loteComMensagem());
  soltar();
  eq("busca do canal falha → pede reenvio", r, { indisponivel: true });
  eq("e registra o motivo", logs.some((l) => l.includes("busca do canal") && l.includes("fetch failed")), true);
  /*
   * ⚠️ Erro do PostgREST é objeto SIMPLES, não `Error`. A primeira versão do
   * helper fazia `String(e)` e gravava "[object Object]" — log inútil, que é
   * exatamente o defeito que ele existe para não repetir.
   */
  eq("e NÃO grava [object Object]", logs.some((l) => l.includes("[object Object]")), false);
}
{
  /*
   * 2. O caso pior: o canal é encontrado, mas a checagem de DUPLICATA falha.
   *    Antes, `dup` vinha null, o código concluía que a mensagem era nova, o
   *    insert falhava e o catch engolia com 200. Agora lança, a sonda vê o banco
   *    fora e pede reenvio.
   */
  capturar();
  let vez2 = 0;
  const db = fakeDb({
    // 1ª chamada = busca do canal (ACHA). A 2ª é a SONDA, e ela falha: é isso
    // que caracteriza "banco caiu no meio da gravação".
    whatsapp_channels: () => {
      vez2++;
      return vez2 === 1 ? { data: CANAL, error: null } : ERRO_REDE;
    },
    messages: () => ERRO_REDE,
  });
  const r = await processarLote(db, loteComMensagem());
  soltar();
  eq("duplicata falha e banco morto → pede reenvio", r, { indisponivel: true });
  eq("o canal foi achado antes de cair", vez2 >= 2, true);
  eq(
    "o log diz que é indisponibilidade, não problema da mensagem",
    logs.some((l) => l.includes("banco indisponível")),
    true
  );
}
{
  // 3. Status também pede reenvio quando o banco está fora.
  capturar();
  const db = fakeDb({ whatsapp_channels: () => ERRO_REDE });
  const r = await processarLote(db, loteComStatus());
  soltar();
  eq("status com banco fora → pede reenvio", r, { indisponivel: true });
}

console.log("── Banco vivo: NÃO pode pedir reenvio ──");
{
  /*
   * 4. O lado que protege a Meta de reenviar para sempre: a gravação falha mas o
   *    banco responde → o problema é a MENSAGEM. Reenviar daria o mesmo erro
   *    eternamente, e a Meta pode suspender a inscrição do webhook.
   */
  capturar();
  let vez = 0;
  const db = fakeDb({
    // 1ª chamada = busca do canal (ok). Depois é a sonda, que responde.
    whatsapp_channels: () => {
      vez++;
      return vez === 1 ? { data: CANAL, error: null } : { data: [], error: null };
    },
    messages: () => ({ data: null, error: { message: "invalid input syntax" } }),
  });
  const r = await processarLote(db, loteComMensagem());
  soltar();
  eq("gravação falha com banco vivo → NÃO pede reenvio", r, { indisponivel: false });
  eq(
    "e o log diz que o problema é na mensagem",
    logs.some((l) => l.includes("problema na mensagem")),
    true
  );
  eq("a sonda foi consultada", vez >= 2, true);
}
{
  /*
   * 5. Número que não é deste CRM: sem erro e sem linha. NÃO pode pedir reenvio —
   *    seria laço infinito, a Meta reenviando para sempre um número que nunca
   *    vai ser nosso. É a distinção que o `error` descartado apagava.
   */
  capturar();
  const db = fakeDb({ whatsapp_channels: () => ({ data: null, error: null }) });
  const r = await processarLote(db, loteComMensagem("999999999999"));
  soltar();
  eq("número não cadastrado → NÃO pede reenvio", r, { indisponivel: false });
  eq("e não registra falha (não é falha)", logs.length, 0);
  eq("nem tenta gravar mensagem", db.chamadas.includes("messages"), false);
}
{
  // 6. Mensagem sem `id`: o webhook sai antes de tocar no banco. 200.
  capturar();
  const db = fakeDb({ whatsapp_channels: () => ({ data: CANAL, error: null }) });
  const lote = loteComMensagem();
  delete lote.entry[0].changes[0].value.messages[0].id;
  const r = await processarLote(db, lote);
  soltar();
  eq("mensagem sem id → NÃO pede reenvio", r, { indisponivel: false });
}
{
  // 7. Duplicata encontrada (reenvio da Meta chegando de novo): sai limpo, 200.
  //    É o caminho que o 503 passa a exercitar de propósito.
  capturar();
  let vez = 0;
  const db = fakeDb({
    whatsapp_channels: () => ({ data: CANAL, error: null }),
    messages: () => {
      vez++;
      return { data: { id: "msg-ja-existe" }, error: null };
    },
  });
  const r = await processarLote(db, loteComMensagem());
  soltar();
  eq("mensagem repetida → NÃO pede reenvio", r, { indisponivel: false });
  eq("a checagem de duplicata rodou", vez, 1);
  eq("e nada mais foi tentado depois dela", db.chamadas.filter((t) => t === "messages").length, 1);
}

console.log("── Bordas ──");
{
  const db = fakeDb({});
  eq("lote vazio → 200", await processarLote(db, {}), { indisponivel: false });
  eq("entry vazio → 200", await processarLote(db, { entry: [] }), { indisponivel: false });
  eq(
    "change sem phone_number_id → 200 e nem consulta o banco",
    await processarLote(fakeDb({}), { entry: [{ changes: [{ value: {} }] }] }),
    { indisponivel: false }
  );
}
{
  /*
   * 8. Uma vez indisponível, PARA de insistir num banco morto — não fica
   *    martelando o resto do lote com uma consulta por mensagem.
   */
  capturar();
  const db = fakeDb({ whatsapp_channels: () => ERRO_REDE });
  const lote = loteComMensagem();
  lote.entry[0].changes.push(loteComMensagem().entry[0].changes[0]);
  lote.entry.push(loteComMensagem().entry[0]);
  const r = await processarLote(db, lote);
  soltar();
  eq("lote de 3 mudanças com banco fora → pede reenvio", r, { indisponivel: true });
  eq("e consulta o banco UMA vez só", db.chamadas.length, 1);
}

console.log(`\n${ok} asserção(ões) ok · ${falhas} falha(s)`);
process.exit(falhas > 0 ? 1 : 0);
