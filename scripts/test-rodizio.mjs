/**
 * O rodízio não deixa lead preso na fila do setor.
 *
 * ⚠️ Existe por causa de duas falhas MEDIDAS em 2026-09-08, que juntas
 * deixavam o lead parado indefinidamente:
 *
 *  1) NADA esvaziava a fila (`awaiting_distribution`). O lead entrava nela
 *     quando ninguém estava online — o que está certo — e só saía pelo botão do
 *     admin. Medido: 12 leads presos, 3 há 115 horas, com atendente ONLINE.
 *  2) `devolverInativas` era um NO-OP: chamava `sla_conversations`, que tem
 *     guarda de empresa e devolve ZERO LINHAS, SEM ERRO, para a service role.
 *
 * ⚠️ E este é um caminho que quase não se observa rodando o app: ele depende de
 * quem está online AGORA, do estado da sessão do bot e da hora do dia. As regras
 * (não distribuir triagem em curso, não atribuir a offline, teto por tique,
 * contagem por setor) são invisíveis em revisão de código — e a que mais importa,
 * "não roubar a conversa do bot no meio da triagem", tem consequência grave
 * (`assignLeadTo` põe `bot_paused = true`) e nenhum sintoma imediato.
 *
 * Roda direto no Node 24 (`npm run test:rodizio`), sem runner de teste.
 */
import {
  distribuirFilaDoSetor,
  devolvivel,
  cotaPorAtendente,
  escolherPorCarga,
  limiteDoTique,
  podeTrocarDonoDoCard,
  distributeDepartment,
  inicioDoDiaSP,
  plantaoAtivo,
  elegiveisOrdered,
  PRESENCE_MS,
} from "../src/lib/leads/distribution.ts";

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

/* ------------------------------------------------------------------ *
 * Banco falso
 *
 * Imita só o que o código usa do supabase-js: o builder é preguiçoso e resolve
 * no `await`, então cada chamada devolve o mesmo objeto e o `then` entrega o
 * resultado.
 * ------------------------------------------------------------------ */
function fakeDb(estado) {
  const escritas = [];

  function resolver(f) {
    if (f.patch) {
      escritas.push({ tabela: f.tabela, patch: f.patch, filtros: f.filtros });
      /*
       * ⚠️ O update é APLICADO ao estado, não só registrado. Sem isso o
       * `rr_cursor` que `distributeOne` grava em `departments` nunca avançava e
       * o rodízio parecia despejar tudo na primeira pessoa — um falso alarme
       * que custou uma rodada aqui. É também o que torna as asserções de
       * alternância verdadeiras em vez de decorativas.
       */
      for (const l of estado[f.tabela] ?? []) {
        if (Object.entries(f.filtros).every(([c, v]) => l[c] === v)) Object.assign(l, f.patch);
      }
      return { data: null, error: null };
    }
    let linhas = (estado[f.tabela] ?? []).slice();
    for (const [c, v] of Object.entries(f.filtros)) linhas = linhas.filter((l) => l[c] === v);
    for (const c of f.nulos) linhas = linhas.filter((l) => (l[c] ?? null) === null);
    for (const c of f.naoNulos) linhas = linhas.filter((l) => (l[c] ?? null) !== null);
    for (const [c, v] of Object.entries(f.arrays)) linhas = linhas.filter((l) => v.includes(l[c]));
    // É o `.gte("last_seen_at", ...)` de `onlineOrdered` que decide quem está
    // online — o coração da regra que este teste existe para vigiar.
    for (const [c, v] of f.gte) linhas = linhas.filter((l) => (l[c] ?? "") >= v);
    for (const [c, v] of f.lte) linhas = linhas.filter((l) => (l[c] ?? "") <= v);
    for (const [c, v] of f.gt) linhas = linhas.filter((l) => (l[c] ?? "") > v);
    if (f.limite !== null) linhas = linhas.slice(0, f.limite);
    if (f.single) return { data: linhas[0] ?? null, error: null };
    return { data: linhas, error: null };
  }

  const from = (tabela) => {
    const f = {
      tabela,
      filtros: {},
      arrays: {},
      nulos: [],
      naoNulos: [],
      gte: [],
      lte: [],
      gt: [],
      limite: null,
      single: false,
      patch: null,
    };
    const api = {
      select: () => api,
      order: () => api,
      limit: (n) => ((f.limite = n), api),
      maybeSingle: () => ((f.single = true), api),
      single: () => ((f.single = true), api),
      eq: (c, v) => ((f.filtros[c] = v), api),
      is: (c, v) => (v === null ? f.nulos.push(c) : null, api),
      not: (c) => (f.naoNulos.push(c), api),
      in: (c, v) => ((f.arrays[c] = v), api),
      gte: (c, v) => (f.gte.push([c, v]), api),
      // `plantaoAtivo` recorta a janela com lte(inicio) + gt(fim).
      lte: (c, v) => (f.lte.push([c, v]), api),
      gt: (c, v) => (f.gt.push([c, v]), api),
      update: (patch) => ((f.patch = patch), api),
      then: (res) => Promise.resolve(resolver(f)).then(res),
    };
    return api;
  };

  return {
    from,
    escritas,
    atribuicoes: () =>
      escritas.filter((e) => e.tabela === "conversations" && "assigned_to" in e.patch),
  };
}

const AGORA = Date.now();
const vistoHa = (min) => new Date(AGORA - min * 60 * 1000).toISOString();
const online = vistoHa(1);
const offline = vistoHa(60);

/** Cenário base: 1 setor com rodízio, 1 número, 2 atendentes online. */
function cenario(over = {}) {
  const base = {
    departments: [
      {
        id: "dep1",
        location_id: "loc1",
        usa_rodizio: true,
        rodizio_offline: false,
        lead_pool: [],
        rr_cursor: 0,
      },
    ],
    department_channels: [{ department_id: "dep1", channel_id: "ch1", created_at: "1" }],
    location_members: [
      { location_id: "loc1", user_id: "ana", department_id: "dep1", last_seen_at: online },
      { location_id: "loc1", user_id: "bia", department_id: "dep1", last_seen_at: online },
    ],
    conversations: [],
    bot_sessions: [],
    messages: [],
    pipelines: [{ id: "p1", location_id: "loc1", name: "Controle de Leads", position: 0 }],
    stages: [{ id: "s1", pipeline_id: "p1", name: "Novo Lead" }],
    opportunities: [],
    ...over,
  };
  /*
   * Por padrao toda conversa da fila JA passou pelo bot com a triagem concluida
   * — que e o caso normal: e o no `distribute`, no FIM da triagem, que poe o
   * lead na fila. Quem quiser testar o contrario passa `bot_sessions` explicito.
   */
  if (!over.bot_sessions) {
    base.bot_sessions = base.conversations.map((c) => ({
      conversation_id: c.id,
      status: "concluido",
    }));
  }
  return base;
}

const naFila = (id, extra = {}) => ({
  id,
  contact_id: `c-${id}`,
  location_id: "loc1",
  channel_id: "ch1",
  awaiting_distribution: true,
  assigned_to: null,
  closed_at: null,
  archived_at: null,
  bot_paused: false,
  last_message_at: "2026-09-08T10:00:00Z",
  ...extra,
});

console.log("\nRodizio - a fila do setor tem saida\n");

/* 1. O caso do relato: lead na fila, gente online -> distribui. */
{
  const db = fakeDb(cenario({ conversations: [naFila("k1"), naFila("k2")] }));
  const r = await distribuirFilaDoSetor(db, "loc1");
  eq("fila com 2 e equipe online -> distribui as 2", r, { distribuidas: 2, naFila: 0 });
  eq(
    "cada uma ganhou dono, bot pausado e saiu da fila",
    db
      .atribuicoes()
      .map((e) => [e.patch.assigned_to, e.patch.bot_paused, e.patch.awaiting_distribution]),
    [
      ["ana", true, false],
      ["bia", true, false],
    ],
  );
  eq(
    "o motivo explica de onde veio (o fio dizia 'motivo nao informado')",
    db.atribuicoes()[0].patch.assign_reason,
    "varredura da fila do setor",
  );
}

/* 2. Ninguém online -> NÃO atribui. É a decisão de 28/08. */
{
  const st = cenario({ conversations: [naFila("k1")] });
  st.location_members.forEach((m) => (m.last_seen_at = offline));
  const db = fakeDb(st);
  eq("ninguem online -> fica na fila", await distribuirFilaDoSetor(db, "loc1"), {
    distribuidas: 0,
    naFila: 1,
  });
  eq("e NAO atribui a quem esta offline", db.atribuicoes().length, 0);
}

/* 3. O filtro mais importante: triagem em curso não é distribuída.
 *    `assignLeadTo` põe bot_paused=true — distribuir aqui CALA o bot e entrega
 *    ao atendente uma conversa sem nome, sem e-mail e sem assunto. Era o estado
 *    real dos 3 leads presos há 115h. */
{
  const db = fakeDb(
    cenario({
      conversations: [naFila("triando"), naFila("pronta")],
      bot_sessions: [
        { conversation_id: "triando", status: "aguardando" },
        { conversation_id: "pronta", status: "concluido" },
      ],
    }),
  );
  const r = await distribuirFilaDoSetor(db, "loc1");
  eq("triagem 'aguardando' fica; 'concluido' vai", r, { distribuidas: 1, naFila: 1 });
  eq(
    "quem foi distribuida e a de triagem CONCLUIDA",
    db.atribuicoes().map((e) => e.filtros.id),
    ["pronta"],
  );
}

/* 4. Sessão 'ativo' também fica: o bot está caminhando pelos nós agora. */
{
  const db = fakeDb(
    cenario({
      conversations: [naFila("k1")],
      bot_sessions: [{ conversation_id: "k1", status: "ativo" }],
    }),
  );
  eq("sessao 'ativo' nao e roubada do bot", await distribuirFilaDoSetor(db, "loc1"), {
    distribuidas: 0,
    naFila: 1,
  });
}

/* 5. 🔴 NUNCA passou pelo bot -> NAO distribui (regra do Gabriel).
 *    Sem sessao E sem mensagem automatizada = conversa aberta pelo CRM, contato
 *    de antes da integracao ou abordagem nossa. Nao e lead de fila, e distribuir
 *    poria na caixa de alguem uma conversa sem contexto nenhum. */
{
  const db = fakeDb(cenario({ conversations: [naFila("k1")], bot_sessions: [] }));
  eq("nunca passou pelo bot -> NAO distribui", await distribuirFilaDoSetor(db, "loc1"), {
    distribuidas: 0,
    naFila: 1,
  });
  eq("e nao atribui a ninguem", db.atribuicoes().length, 0);
}

/* 5b. Sessao APAGADA (conversa finalizada reabriu e o webhook zerou), mas o bot
 *     falou: a mensagem automatizada e a prova duravel -> distribui. */
{
  const db = fakeDb(
    cenario({
      conversations: [naFila("k1")],
      bot_sessions: [],
      messages: [{ conversation_id: "k1", direction: "out", automated: true }],
    }),
  );
  eq("sessao apagada mas o bot falou -> distribui", await distribuirFilaDoSetor(db, "loc1"), {
    distribuidas: 1,
    naFila: 0,
  });
}

/* 6. Setor sem rodízio (0081) é decisão explícita — a varredura não atropela. */
{
  const st = cenario({ conversations: [naFila("k1")] });
  st.departments[0].usa_rodizio = false;
  const db = fakeDb(st);
  eq("setor sem rodizio -> nao mexe", await distribuirFilaDoSetor(db, "loc1"), {
    distribuidas: 0,
    naFila: 0,
  });
  eq("e nao atribui nada", db.atribuicoes().length, 0);
}

/* 7. Setor sem número vinculado: não há como saber que a conversa é dele. */
{
  const db = fakeDb(cenario({ conversations: [naFila("k1")], department_channels: [] }));
  eq("setor sem numero -> nao mexe", await distribuirFilaDoSetor(db, "loc1"), {
    distribuidas: 0,
    naFila: 0,
  });
}

/* 8. Conversa finalizada/arquivada não volta pela varredura. */
{
  const db = fakeDb(
    cenario({
      conversations: [
        naFila("fechada", { closed_at: "2026-09-08T09:00:00Z" }),
        naFila("arquivada", { archived_at: "2026-09-08T09:00:00Z" }),
      ],
    }),
  );
  eq("finalizada e arquivada ficam fora", await distribuirFilaDoSetor(db, "loc1"), {
    distribuidas: 0,
    naFila: 0,
  });
}

/* 9. Conversa que JÁ tem dono não é tocada — isso é assunto da devolução por
 *    espera, e os dois conjuntos precisam ser disjuntos para não brigarem. */
{
  const db = fakeDb(cenario({ conversations: [naFila("k1", { assigned_to: "ana" })] }));
  eq("conversa com dono fica para a devolucao", await distribuirFilaDoSetor(db, "loc1"), {
    distribuidas: 0,
    naFila: 0,
  });
}

/* 10. Teto por tique: fila grande escoa aos poucos, não despeja de uma vez. */
{
  const muitas = Array.from({ length: 40 }, (_, i) => naFila(`k${i}`));
  const db = fakeDb(cenario({ conversations: muitas }));
  const r = await distribuirFilaDoSetor(db, "loc1");
  eq("40 na fila -> no maximo 25 num tique", r.distribuidas, 25);
}

/* 11. Rodízio de verdade: alterna entre os online, não despeja no primeiro. */
{
  const db = fakeDb(
    cenario({ conversations: [naFila("k1"), naFila("k2"), naFila("k3"), naFila("k4")] }),
  );
  await distribuirFilaDoSetor(db, "loc1");
  eq(
    "alterna ana/bia (rodizio, nao despejo)",
    db.atribuicoes().map((e) => e.patch.assigned_to),
    ["ana", "bia", "ana", "bia"],
  );
}

/* 12. Só os ONLINE entram no rodízio. */
{
  const st = cenario({ conversations: [naFila("k1"), naFila("k2")] });
  st.location_members[0].last_seen_at = offline; // ana saiu
  const db = fakeDb(st);
  await distribuirFilaDoSetor(db, "loc1");
  eq(
    "com ana offline, tudo vai para bia",
    db.atribuicoes().map((e) => e.patch.assigned_to),
    ["bia", "bia"],
  );
}

/* 13. Dois setores com fila: a contagem é POR SETOR.
 *     Vigia o defeito que eu mesmo escrevi na primeira versão — usar o
 *     acumulador global para calcular o resto da fila do segundo setor. */
{
  const db = fakeDb(
    cenario({
      departments: [
        {
          id: "dep1",
          location_id: "loc1",
          usa_rodizio: true,
          rodizio_offline: false,
          lead_pool: [],
          rr_cursor: 0,
        },
        {
          id: "dep2",
          location_id: "loc1",
          usa_rodizio: true,
          rodizio_offline: false,
          lead_pool: [],
          rr_cursor: 0,
        },
      ],
      department_channels: [
        { department_id: "dep1", channel_id: "ch1", created_at: "1" },
        { department_id: "dep2", channel_id: "ch2", created_at: "1" },
      ],
      location_members: [
        { location_id: "loc1", user_id: "ana", department_id: "dep1", last_seen_at: online },
        { location_id: "loc1", user_id: "ceu", department_id: "dep2", last_seen_at: offline },
      ],
      conversations: [
        naFila("a1"),
        naFila("b1", { channel_id: "ch2" }),
        naFila("b2", { channel_id: "ch2" }),
      ],
    }),
  );
  eq("setor 1 online distribui 1; setor 2 offline deixa 2", await distribuirFilaDoSetor(db, "loc1"), {
    distribuidas: 1,
    naFila: 2,
  });
}

/* 14. A janela de presença é a acordada com o Gabriel (15 min). */
{
  eq("janela de presenca = 15 min", PRESENCE_MS, 15 * 60 * 1000);
  const st = cenario({ conversations: [naFila("k1")] });
  // 13 min: o Daniel aparecia OFFLINE assim, com a equipe trabalhando.
  st.location_members.forEach((m) => (m.last_seen_at = vistoHa(13)));
  const db = fakeDb(st);
  eq("visto ha 13 min agora conta como online", await distribuirFilaDoSetor(db, "loc1"), {
    distribuidas: 1,
    naFila: 0,
  });
}

/* 15. Mas 20 min é offline de verdade — a janela não é "tem o CRM aberto hoje". */
{
  const st = cenario({ conversations: [naFila("k1")] });
  st.location_members.forEach((m) => (m.last_seen_at = vistoHa(20)));
  const db = fakeDb(st);
  eq("visto ha 20 min continua offline", await distribuirFilaDoSetor(db, "loc1"), {
    distribuidas: 0,
    naFila: 1,
  });
}

/* 16. Empresa sem fila nenhuma não escreve nada. */
{
  const db = fakeDb(cenario());
  eq("sem fila -> nada a fazer", await distribuirFilaDoSetor(db, "loc1"), {
    distribuidas: 0,
    naFila: 0,
  });
  eq("e nenhuma escrita", db.escritas.length, 0);
}

/* ------------------------------------------------------------------ *
 * devolvivel() - as quatro regras da devolucao por espera
 *
 * Cada caso abaixo escreve como REGRESSAO um defeito que aconteceu em producao
 * em 2026-09-08, entre 13:08 e 13:19: 150 eventos, 13 conversas, 1 ciclo/minuto.
 * ------------------------------------------------------------------ */
console.log("\ndevolvivel() - o que o rodizio pode retomar\n");

const CANAIS = ["ch1"];
const linha = (over = {}) => ({
  conversation_id: "c1",
  contact_id: "ct1",
  assigned_to: "ana",
  assigned_by: null, // null = o SISTEMA atribuiu
  channel_id: "ch1",
  devolvida_em: null,
  ultima_do_cliente: "2026-09-08T13:00:00Z",
  espera_util_min: 30,
  passou_pelo_bot: true,
  ja_respondida: false,
  // Carimbo novo (202609101830): minutos UTEIS com o responsavel atual.
  minutos_com_atendente: 60,
  ...over,
});

eq("sistema atribuiu e ninguem respondeu -> devolve", devolvivel(linha(), CANAIS), true);

/* -1) A JANELA DO ATENDENTE — o defeito medido em 10/09.

   Fio real: o lead esperou 3h na fila (ninguem online), foi entregue a Beatriz
   as 10:35 e devolvido as 10:36. Ela teve UM MINUTO. A espera do CLIENTE ja era
   156 min antes de ela existir na historia, e era so essa conta que a devolucao
   olhava. */
eq(
  "[real] recebeu ha 1 min, cliente esperando 156 -> NAO devolve",
  devolvivel(linha({ espera_util_min: 156, minutos_com_atendente: 1 }), CANAIS, 15),
  false,
);
eq(
  "recebeu ha 14 min com limite 15 -> ainda e dele",
  devolvivel(linha({ espera_util_min: 200, minutos_com_atendente: 14 }), CANAIS, 15),
  false,
);
eq(
  "recebeu ha 15 min (no limite) -> devolve",
  devolvivel(linha({ espera_util_min: 200, minutos_com_atendente: 15 }), CANAIS, 15),
  true,
);
eq(
  "limite de 20 (comercial): 19 min com o atendente -> ainda e dele",
  devolvivel(linha({ espera_util_min: 300, minutos_com_atendente: 19 }), CANAIS, 20),
  false,
);
/* ⚠️ Sem o carimbo (migracao nao aplicada) NAO bloqueia: bloquear aqui
   desligaria a devolucao inteira na janela entre o deploy e a migracao. */
eq(
  "sem carimbo -> nao bloqueia (comportamento de hoje)",
  devolvivel(linha({ minutos_com_atendente: null }), CANAIS, 15),
  true,
);
eq(
  "sem o limite informado -> nao confere a janela aqui (a SQL ja filtrou)",
  devolvivel(linha({ minutos_com_atendente: 1 }), CANAIS),
  true,
);
/* PostgREST devolve numeric como STRING. */
eq(
  "carimbo como string funciona",
  devolvivel(linha({ espera_util_min: 200, minutos_com_atendente: "3" }), CANAIS, 15),
  false,
);

/* 0) PRIMEIRA RESPOSTA (regra do Gabriel, 09/09): o lead que ninguem respondeu
   circula; o que o atendente JA respondeu e dele e nao volta ao rodizio.

   ⚠️ E a regra que substituiu o desligamento do comercial: em vez de tirar a
   devolucao de um setor inteiro, recorta o que ela nunca deveria ter tocado.
   Sem isto, o vendedor mandava a proposta, o cliente respondia tres dias
   depois e a conversa era ARRANCADA dele no meio da negociacao. */
eq(
  "[regra] vendedor ja respondeu -> NAO devolve, e dele",
  devolvivel(linha({ ja_respondida: true }), CANAIS),
  false,
);
/* O caso do dia a dia, e o que mais doia: proposta enviada, cliente responde
   dias depois, vendedor em outro atendimento. A espera cresce e a conversa
   continua sendo dele — responder UMA vez encerra a devolucao para sempre. */
eq(
  "ja respondeu e o cliente voltou a escrever ha 5h -> continua sendo dele",
  devolvivel(linha({ ja_respondida: true, espera_util_min: 300 }), CANAIS),
  false,
);
eq(
  "ninguem respondeu -> devolve (o caso que o rodizio existe para resolver)",
  devolvivel(linha({ ja_respondida: false }), CANAIS),
  true,
);
/* ⚠️ Codigo no ar ANTES da migracao: a coluna ainda nao existe e chega
   undefined. Tem de cair no comportamento de hoje, nao travar a devolucao. */
eq(
  "coluna ausente (migracao nao aplicada) -> devolve como antes",
  devolvivel(linha({ ja_respondida: undefined }), CANAIS),
  true,
);
eq(
  "coluna nula -> devolve como antes",
  devolvivel(linha({ ja_respondida: null }), CANAIS),
  true,
);

// 1) LACO: devolvida agora e o cliente nao escreveu depois -> nao devolve de novo.
eq(
  "ja devolvida e cliente nao escreveu depois -> NAO (era o laco)",
  devolvivel(linha({ devolvida_em: "2026-09-08T13:05:00Z" }), CANAIS),
  false,
);
eq(
  "cliente escreveu DEPOIS da devolucao -> devolve outra vez",
  devolvivel(
    linha({ devolvida_em: "2026-09-08T13:05:00Z", ultima_do_cliente: "2026-09-08T13:40:00Z" }),
    CANAIS,
  ),
  true,
);
eq(
  "devolucao e mensagem no MESMO instante -> NAO (sem brecha para o laco)",
  devolvivel(
    linha({ devolvida_em: "2026-09-08T13:00:00Z", ultima_do_cliente: "2026-09-08T13:00:00Z" }),
    CANAIS,
  ),
  false,
);
eq(
  "devolvida antes e sem data do cliente -> NAO (lado seguro)",
  devolvivel(linha({ devolvida_em: "2026-09-08T13:05:00Z", ultima_do_cliente: null }), CANAIS),
  false,
);

// 2) DECISAO HUMANA NAO SE DESFAZ: transferida a mao para o Paulo Lopes (outro
//    setor, outro numero) e arrancada dele pelo rodizio.
eq(
  "atribuida por uma PESSOA -> NAO (transferencia nao se desfaz)",
  devolvivel(linha({ assigned_by: "jenifer" }), CANAIS),
  false,
);
eq(
  "atribuida pelo SISTEMA -> devolve",
  devolvivel(linha({ assigned_by: null }), CANAIS),
  true,
);

// 5) NUNCA passou pelo bot -> nao entra no rodizio (regra do Gabriel).
eq(
  "nao passou pelo bot -> NAO devolve",
  devolvivel(linha({ passou_pelo_bot: false }), CANAIS),
  false,
);
eq(
  "passou_pelo_bot nulo -> NAO devolve (na duvida, nao mexer)",
  devolvivel(linha({ passou_pelo_bot: null }), CANAIS),
  false,
);

// 3) Sem dono e assunto da FILA, nao da devolucao.
eq("sem dono -> NAO (e fila)", devolvivel(linha({ assigned_to: null }), CANAIS), false);

// 4) Conversa de outro numero nao e deste rodizio.
eq("canal de outro setor -> NAO", devolvivel(linha({ channel_id: "ch9" }), CANAIS), false);
eq("conversa sem canal -> NAO", devolvivel(linha({ channel_id: null }), CANAIS), false);

// 5) TETO: passado um dia util (660 min) e backlog, nao roteamento. Sem isto,
//    religar a devolucao despejaria 19 conversas abandonadas (a mais velha de
//    21/08) na caixa de quem esta online.
eq("espera de 300 min -> devolve", devolvivel(linha({ espera_util_min: 300 }), CANAIS), true);
eq("espera de 660 min (no teto) -> devolve", devolvivel(linha({ espera_util_min: 660 }), CANAIS), true);
eq("espera de 661 min -> NAO (backlog)", devolvivel(linha({ espera_util_min: 661 }), CANAIS), false);
eq(
  "espera de 7868 min, caso real de 21/08 -> NAO",
  devolvivel(linha({ espera_util_min: 7868 }), CANAIS),
  false,
);
eq(
  "numero vindo como STRING do PostgREST ainda respeita o teto",
  devolvivel(linha({ espera_util_min: "7868" }), CANAIS),
  false,
);

/* ------------------------------------------------------------------ *
 * limiteDoTique() - o RITMO da fila (regra do Gabriel, 09/09)
 *
 * "o lead que estiver esperando mais tempo passa pra ele. Aguarda 7 minutos,
 * se ninguem logar, passa mais 1 para quem estiver online. So na secretaria."
 *
 * Nasceu porque a varredura despejava a fila inteira em quem logou primeiro: a
 * Beatriz entrou antes do Daniel e levou o acumulado da noite.
 * ------------------------------------------------------------------ */
console.log("\nlimiteDoTique() - o ritmo da fila\n");

const T = new Date("2026-09-09T12:00:00Z").getTime();
const haMin = (m) => new Date(T - m * 60 * 1000).toISOString();

// Setor SEM intervalo: nada muda para os outros setores.
eq("sem intervalo -> teto normal do tique", limiteDoTique({}, T), 25);
eq("intervalo 0 -> teto normal", limiteDoTique({ intervalo_fila_min: 0 }, T), 25);
eq("intervalo nulo -> teto normal", limiteDoTique({ intervalo_fila_min: null }, T), 25);

// Secretaria: 7 minutos, UMA por vez.
eq(
  "com intervalo e nunca entregou -> libera 1",
  limiteDoTique({ intervalo_fila_min: 7, ultima_da_fila_em: null }, T),
  1,
);
eq(
  "entregou ha 1 min -> ESPERA (era o despejo)",
  limiteDoTique({ intervalo_fila_min: 7, ultima_da_fila_em: haMin(1) }, T),
  0,
);
eq(
  "entregou ha 6 min -> ainda espera",
  limiteDoTique({ intervalo_fila_min: 7, ultima_da_fila_em: haMin(6) }, T),
  0,
);
eq(
  "entregou ha exatamente 7 min -> libera 1",
  limiteDoTique({ intervalo_fila_min: 7, ultima_da_fila_em: haMin(7) }, T),
  1,
);
eq(
  "entregou ha 30 min -> libera 1 (nao acumula credito)",
  limiteDoTique({ intervalo_fila_min: 7, ultima_da_fila_em: haMin(30) }, T),
  1,
);

// PostgREST devolve numero como string.
eq(
  "intervalo vindo como STRING funciona",
  limiteDoTique({ intervalo_fila_min: "7", ultima_da_fila_em: haMin(1) }, T),
  0,
);

// Carimbo corrompido nao pode travar a fila para sempre.
eq(
  "data invalida -> libera (o lado seguro e entregar)",
  limiteDoTique({ intervalo_fila_min: 7, ultima_da_fila_em: "nao-e-data" }, T),
  1,
);

/* A varredura inteira, com o ritmo: entrega UMA e deixa o resto na fila. */
{
  const st = cenario({
    conversations: [naFila("k1"), naFila("k2"), naFila("k3"), naFila("k4")],
  });
  st.departments[0].intervalo_fila_min = 7;
  st.departments[0].ultima_da_fila_em = null;
  const db = fakeDb(st);
  const r = await distribuirFilaDoSetor(db, "loc1");
  eq("setor com ritmo -> entrega 1 e deixa 3 na fila", r, { distribuidas: 1, naFila: 3 });
  eq("e carimba a entrega para o proximo tique esperar",
     typeof st.departments[0].ultima_da_fila_em, "string");
}

/* Segundo tique logo em seguida: nao entrega nada, e a fila continua contada. */
{
  const st = cenario({ conversations: [naFila("k1"), naFila("k2")] });
  st.departments[0].intervalo_fila_min = 7;
  st.departments[0].ultima_da_fila_em = new Date(Date.now() - 60 * 1000).toISOString();
  const db = fakeDb(st);
  eq("dentro do intervalo -> 0 entregues, fila inteira contada",
     await distribuirFilaDoSetor(db, "loc1"), { distribuidas: 0, naFila: 2 });
  eq("e nao atribui nada", db.atribuicoes().length, 0);
}

/* Ninguem online NAO pode reiniciar o relogio da espera. */
{
  const st = cenario({ conversations: [naFila("k1")] });
  st.departments[0].intervalo_fila_min = 7;
  st.departments[0].ultima_da_fila_em = null;
  st.location_members.forEach((m) => (m.last_seen_at = offline));
  const db = fakeDb(st);
  await distribuirFilaDoSetor(db, "loc1");
  eq("sem ninguem online, o carimbo NAO e gravado",
     st.departments[0].ultima_da_fila_em, null);
}

/* Setor SEM intervalo continua esvaziando a fila como antes. */
{
  const db = fakeDb(cenario({ conversations: [naFila("k1"), naFila("k2"), naFila("k3")] }));
  eq("setor sem ritmo -> distribui tudo (comportamento inalterado)",
     await distribuirFilaDoSetor(db, "loc1"), { distribuidas: 3, naFila: 0 });
}

/* ------------------------------------------------------------------ *
 * escolherPorCarga() - "dividir igual: 30 pro Paulo, 30 pro Alberto
 * quando logar e mais 30 pro Rogerio quando logar" (Gabriel, 10/09)
 *
 * O caso real: 90 leads na fila, o Paulo loga primeiro e leva TODOS. O
 * cursor girava — mas girava sobre uma lista de uma pessoa, e rodizio
 * entre um so e despejo.
 * ------------------------------------------------------------------ */
console.log("");
console.log("escolherPorCarga() - cota por atendente");
console.log("");

const POOL = ["paulo", "alberto", "rogerio"];
const cargasDe = (p, a, r) => new Map([["paulo", p], ["alberto", a], ["rogerio", r]]);

/* A conta que a regra do Gabriel virou. */
eq("90 na fila / 3 no pool -> cota 30", cotaPorAtendente([0, 0, 0], 90, 3), 30);
eq("paulo ja com 30, 60 na fila -> cota segue 30", cotaPorAtendente([30, 0, 0], 60, 3), 30);
eq("dois atendidos, 30 na fila -> cota segue 30", cotaPorAtendente([30, 30, 0], 30, 3), 30);

/* ⚠️ TETO e nao piso. Com 10/10/10 e 1 lead novo, o piso daria 10 e ninguem
   estaria abaixo da propria cota — o lead ficaria parado com tres vendedores
   livres. Foi por isso que a formula usa Math.ceil. */
eq("dia a dia: 10/10/10 e 1 lead -> cota 11 (teto)", cotaPorAtendente([10, 10, 10], 1, 3), 11);

/* O CASO DO RELATO, passo a passo. */
eq(
  "[real] so o paulo online, todos zerados -> paulo recebe",
  escolherPorCarga(["paulo"], cargasDe(0, 0, 0), POOL, 90, 0),
  "paulo",
);
eq(
  "[real] paulo ja com 30 e sozinho -> NINGUEM recebe, a fila segura",
  escolherPorCarga(["paulo"], cargasDe(30, 0, 0), POOL, 60, 0),
  null,
);
eq(
  "[real] paulo com 29 -> ainda cabe um",
  escolherPorCarga(["paulo"], cargasDe(29, 0, 0), POOL, 61, 0),
  "paulo",
);
eq(
  "[real] alberto loga zerado -> os proximos vao pra ele, nao pro paulo",
  escolherPorCarga(["paulo", "alberto"], cargasDe(30, 0, 0), POOL, 60, 0),
  "alberto",
);
eq(
  "[real] alberto tambem chega em 30 -> segura de novo (faltam os 30 do rogerio)",
  escolherPorCarga(["paulo", "alberto"], cargasDe(30, 30, 0), POOL, 30, 0),
  null,
);
eq(
  "[real] rogerio loga -> leva os que sobraram",
  escolherPorCarga(["paulo", "alberto", "rogerio"], cargasDe(30, 30, 0), POOL, 30, 0),
  "rogerio",
);

/* Menor carga ganha, seja qual for a ordem do pool. */
eq(
  "escolhe o MENOS carregado",
  escolherPorCarga(POOL, cargasDe(8, 2, 5), POOL, 1, 0),
  "alberto",
);

/* ⚠️ Empate desempata pelo CURSOR. Sem isso, com todos zerados o primeiro do
   pool receberia sempre — o rodizio deixaria de girar no caso mais comum. */
eq("empate com cursor 0 -> paulo", escolherPorCarga(POOL, cargasDe(0, 0, 0), POOL, 3, 0), "paulo");
eq("empate com cursor 1 -> alberto", escolherPorCarga(POOL, cargasDe(0, 0, 0), POOL, 3, 1), "alberto");
eq("empate com cursor 2 -> rogerio", escolherPorCarga(POOL, cargasDe(0, 0, 0), POOL, 3, 2), "rogerio");
eq("cursor da volta", escolherPorCarga(POOL, cargasDe(0, 0, 0), POOL, 3, 3), "paulo");
eq(
  "cursor aponta pra quem NAO esta disponivel -> vai pro proximo empatado",
  escolherPorCarga(["alberto", "rogerio"], cargasDe(0, 0, 0), POOL, 3, 0),
  "alberto",
);

/* ⚠️ A soma inclui quem esta OFFLINE, e e isso que faz a divisao funcionar.
   Contando so os online, 90/1 daria 90 — o despejo de hoje. */
eq(
  "a cota conta o pool INTEIRO, nao so os online",
  cotaPorAtendente([0, 0, 0], 90, 3) === 30 && cotaPorAtendente([0], 90, 1) === 90,
  true,
);

/* Bordas: sem ninguem disponivel, sem pool, carga ausente no mapa. */
eq("ninguem disponivel -> null", escolherPorCarga([], cargasDe(0, 0, 0), POOL, 5, 0), null);
eq("pool vazio -> null", escolherPorCarga(["paulo"], new Map(), [], 5, 0), null);
eq(
  "carga que nao esta no mapa conta como zero",
  escolherPorCarga(["paulo"], new Map(), POOL, 5, 0),
  "paulo",
);
eq("pool de tamanho 0 -> cota 0", cotaPorAtendente([], 10, 0), 0);
/* ------------------------------------------------------------------
   O PROPRIETARIO do card nao segue quem esta conversando (202609111030)

   Regra do Gabriel: o comercial fechou a venda, o aluno foi para a Secretaria
   falar de documentos, e o "proprietario" virou quem estava atendendo. A frase
   dele e a regra inteira: "o proprietario e o comercial Rogerio, mas esse
   contato pode estar conversando com outro".

   Funcao pura e exportada SO para ter teste: a regra tem duas linhas, e o
   estrago dela nao da erro nenhum — aparece semanas depois como o nome errado
   no card de uma venda fechada, que e o pior tipo de defeito para revisar.
   ------------------------------------------------------------------ */
console.log("");
console.log("proprietario do card - nao segue a conversa");

eq("card SEM dono -> a primeira atribuicao grava", podeTrocarDonoDoCard(null, undefined), true);
eq("card SEM dono (string vazia) -> grava", podeTrocarDonoDoCard("", undefined), true);
eq("card SEM dono, com devolucao -> grava", podeTrocarDonoDoCard(null, "paulo"), true);

/* O caso do relato, escrito como regressao: o card e do Rogerio (vendeu) e a
   conversa foi distribuida ao Daniel (Secretaria). Antes isto era um update
   cego, e o Rogerio perdia a venda no instante do primeiro atendimento. */
eq(
  "[real] card do Rogerio + rodizio entregando ao Daniel -> NAO troca",
  podeTrocarDonoDoCard("rogerio", undefined),
  false,
);

/* A excecao, e so ela: a devolucao tira de quem nao respondeu. Deixar o card no
   nome dessa pessoa gravaria como proprietario justamente quem nao atendeu. */
eq("devolucao de quem esta com o card -> troca", podeTrocarDonoDoCard("paulo", "paulo"), true);
eq(
  "devolucao, mas o card e de OUTRA pessoa -> NAO troca",
  podeTrocarDonoDoCard("rogerio", "paulo"),
  false,
);

/* Vigia o lado oposto: `donoAnterior` vazio/nulo nao pode virar curinga. Sem o
   `!!donoAnterior`, todo card com dono voltaria a ser sobrescrito — o defeito
   original de volta por uma comparacao frouxa. */
eq("donoAnterior nulo nao autoriza troca", podeTrocarDonoDoCard("rogerio", null), false);
eq("donoAnterior vazio nao autoriza troca", podeTrocarDonoDoCard("rogerio", ""), false);
eq(
  "dono e anterior ambos ausentes -> grava (card livre)",
  podeTrocarDonoDoCard(undefined, undefined),
  true,
);

/* ------------------------------------------------------------------
   O BOTAO "Distribuir agora" do Relatorio (distributeDepartment)

   🔴 Relato de 2026-09-11: "o Alberto recebeu todos os leads ao logar hoje" —
   um dia depois de eu ter "resolvido" o mesmo sintoma com o Paulo.

   A correcao de 10/09 (escolherPorCarga) entrou em `distributeOne`, que e o
   caminho do BOT e o da VARREDURA. Este botao nao passa por la: fazia
   `list[(cursor + i) % list.length]` direto, e com uma pessoa online o modulo
   devolve sempre a mesma pessoa. Sao TRES caminhos que atribuem, e eu tinha
   coberto dois.
   ------------------------------------------------------------------ */
console.log("");
console.log("botao Distribuir agora - a cota vale aqui tambem");

const filaDe = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `q${i}`, contact_id: `c${i}` }));

{
  // Uma pessoa online, 6 na fila, pool de 2 -> cota 3. Antes: ana levava as 6.
  const st = cenario({});
  st.departments[0].dividir_igualmente = true;
  st.location_members[1].last_seen_at = offline;
  const db = fakeDb(st);
  const r = await distributeDepartment(db, "loc1", "dep1", filaDe(6), 1, null, ["ch1"]);
  eq("[real] 1 online, 6 na fila, pool 2 -> a cota segura metade", r, {
    atribuidas: 3,
    retidas: 3,
  });
  eq("e as 3 foram todas para quem esta online", new Set(db.atribuicoes().map((e) => e.patch.assigned_to)), new Set(["ana"]));
}

{
  // O motivo nao pode dizer BOT: foi um clique de administrador. Era o padrao
  // "atribuida pelo bot (origem nao informada)", e foi o que me obrigou a
  // deduzir qual caminho despejou os leads.
  const st = cenario({});
  st.departments[0].dividir_igualmente = true;
  const db = fakeDb(st);
  await distributeDepartment(db, "loc1", "dep1", filaDe(2), 1, null, ["ch1"]);
  eq(
    "o motivo diz que veio do relatorio, nao do bot",
    db.atribuicoes()[0].patch.assign_reason,
    "distribuição pelo relatório (rodízio)",
  );
}

{
  // Setor SEM dividir_igualmente (a Secretaria) nao muda de comportamento.
  const st = cenario({});
  st.departments[0].dividir_igualmente = false;
  const db = fakeDb(st);
  const r = await distributeDepartment(db, "loc1", "dep1", filaDe(4), 1, null, ["ch1"]);
  eq("sem cota no setor -> entrega tudo, como antes", r, { atribuidas: 4, retidas: 0 });
}

{
  // "Ausente" pediu para nao receber lead novo. O botao usava `onlineOrdered`,
  // que olha so a presenca, e entregava a ele assim mesmo.
  const st = cenario({});
  st.departments[0].dividir_igualmente = true;
  st.location_members[1].disponibilidade = "ausente";
  const db = fakeDb(st);
  await distributeDepartment(db, "loc1", "dep1", filaDe(4), 1, null, ["ch1"]);
  eq(
    "quem esta AUSENTE nao recebe pelo botao",
    db.atribuicoes().every((e) => e.patch.assigned_to !== "bia"),
    true,
  );
}

{
  // Escolher a pessoa no seletor e decisao deliberada: passa por cima da cota.
  const st = cenario({});
  st.departments[0].dividir_igualmente = true;
  const db = fakeDb(st);
  const r = await distributeDepartment(db, "loc1", "dep1", filaDe(6), 1, "bia", ["ch1"]);
  eq("alvo escolhido pelo admin ignora a cota", r, { atribuidas: 6, retidas: 0 });
}

/* ------------------------------------------------------------------
   A METRICA da cota: leads recebidos NO DIA, nao conversas abertas

   🔴 "o Rogerio recebeu muitos e o Paulo foi o unico que nao recebeu" —
   o Paulo tinha 67 conversas ABERTAS do incidente da fila (medido em 10/09, e a
   migracao que iria rebalancea-las nao tinha sido aplicada). A cota olhava esse
   acumulado, via o Paulo muito acima da media e nunca o escolhia, enquanto os
   outros dois "alcancavam" o numero dele absorvendo a fila.
   ------------------------------------------------------------------ */
console.log("");
console.log("cota por leads do DIA, nao por acervo aberto");

const POOL3 = ["paulo", "alberto", "rogerio"];
const doDia = (p, a, r) => new Map([["paulo", p], ["alberto", a], ["rogerio", r]]);

eq(
  "[real] o acervo do Paulo (67) contra o dia dos outros -> ele NUNCA entra",
  escolherPorCarga(POOL3, doDia(67, 10, 15), POOL3, 10, 0),
  "alberto",
);
eq(
  "[real] medindo o DIA (todos zerados menos os que ja receberam) -> vai pro Paulo",
  escolherPorCarga(POOL3, doDia(0, 20, 15), POOL3, 10, 0),
  "paulo",
);
eq(
  "quem ja recebeu a cota do dia nao recebe mais",
  escolherPorCarga(["alberto"], doDia(0, 20, 15), POOL3, 10, 0),
  null,
);
eq(
  "manha com 90 na fila e todos zerados -> a cota e 30, a regra original",
  cotaPorAtendente([0, 0, 0], 90, 3),
  30,
);

/* ⚠️ A Vercel roda em UTC: as 21h de Brasilia o servidor ja esta no dia
   seguinte, e um corte por hora local jogaria fora as atribuicoes da noite —
   justamente as do turno que gerou esta queixa. */
eq(
  "21h de Brasilia (00h UTC do dia seguinte) ainda e o dia de ontem em SP",
  inicioDoDiaSP(new Date("2026-09-11T00:30:00Z")),
  "2026-09-10T00:00:00-03:00",
);
eq(
  "meio-dia UTC cai no mesmo dia",
  inicioDoDiaSP(new Date("2026-09-11T12:00:00Z")),
  "2026-09-11T00:00:00-03:00",
);

/* ------------------------------------------------------------------
   A REGRA, dita pelo Gabriel em 2026-09-11:

     "Caiu 100 leads: 33,33% para o Paulo, 33,33% para o Alberto, 33,33% para o
      Rogerio. Os leads do time de vendas tem que ser divididos de maneira
      igualitaria entre os 3."

   🔴 O que quebrava isso NAO era quem escolhe — era o TOTAL que a conta divide.
   Os chamadores passavam a fila INICIAL e incrementavam o mapa de cargas, entao
   `soma(cargas) + fila` crescia 1 por entrega e a cota subia junto. Com 100 na
   fila e um vendedor online, a cota nunca alcancava ele: levava os 100.
   ------------------------------------------------------------------ */
console.log("");
console.log("100 leads divididos entre 3 - a regra do Gabriel");

function timeDeVendas(onlineDe) {
  const st = cenario({});
  st.departments[0].dividir_igualmente = true;
  st.location_members = ["paulo", "alberto", "rogerio"].map((u) => ({
    location_id: "loc1",
    user_id: u,
    department_id: "dep1",
    last_seen_at: onlineDe.includes(u) ? online : offline,
  }));
  return st;
}
const contarPorPessoa = (db) => {
  const c = {};
  for (const e of db.atribuicoes()) c[e.patch.assigned_to] = (c[e.patch.assigned_to] ?? 0) + 1;
  return c;
};

{
  // Os tres online: 100 leads saem 34/33/33 — a divisao inteira de 100 por 3.
  const db = fakeDb(timeDeVendas(["paulo", "alberto", "rogerio"]));
  const r = await distributeDepartment(db, "loc1", "dep1", filaDe(100), 1, null, ["ch1"]);
  const por = contarPorPessoa(db);
  const qtds = Object.values(por).sort((a, b) => b - a);
  eq("[regra] 100 leads e 3 online -> 34/33/33", qtds, [34, 33, 33]);
  eq("[regra] os 100 sairam", r.atribuidas, 100);
  eq("[regra] ninguem ficou de fora do rateio", Object.keys(por).length, 3);
}

{
  /* 🔴 O caso dos dois incidentes: UM vendedor logado de manhã.
     Ele leva a fatia DELE (34) e as outras 66 esperam os donos — em vez de
     "o Alberto recebeu todos os leads ao logar hoje". */
  const db = fakeDb(timeDeVendas(["alberto"]));
  const r = await distributeDepartment(db, "loc1", "dep1", filaDe(100), 1, null, ["ch1"]);
  eq("[real] so o Alberto online -> ele leva 34, e 66 esperam", r, {
    atribuidas: 34,
    retidas: 66,
  });
  eq("[real] e todas as 34 foram para ele", contarPorPessoa(db), { alberto: 34 });
}

{
  // Dois online: cada um pega a sua fatia; a do ausente do dia continua guardada.
  const db = fakeDb(timeDeVendas(["alberto", "rogerio"]));
  const r = await distributeDepartment(db, "loc1", "dep1", filaDe(99), 1, null, ["ch1"]);
  eq("2 de 3 online, 99 na fila -> 33 cada, 33 guardados", r, {
    atribuidas: 66,
    retidas: 33,
  });
  eq("e os dois receberam igual", Object.values(contarPorPessoa(db)).sort(), [33, 33]);
}

{
  /* Quem JA recebeu a fatia do dia nao recebe de novo — e a recíproca, que é o
     relato do Paulo: quem esta zerado no dia recebe primeiro, mesmo tendo um
     acervo antigo enorme. A carga aqui e "recebidos hoje", nao conversas abertas. */
  const st = timeDeVendas(["paulo", "alberto", "rogerio"]);
  st.conversations = [];
  const db = fakeDb(st);
  // Simula 20 ja entregues hoje ao Alberto, mexendo no mapa que a funcao le do
  // banco nao da — entao vai pelo caminho puro, que e onde a regra mora.
  eq(
    "[real] Paulo zerado no dia entra na frente de quem ja recebeu 20",
    escolherPorCarga(POOL3, doDia(0, 20, 20), POOL3, 60, 0),
    "paulo",
  );
}

/* ==================================================================
 * Regra de distribuição do time de vendas (2026-09-11):
 * Offline ≠ Ausente · SLA que só corre online · Plantão
 * ==================================================================
 *
 * 🔴 Cada asserção aqui trava uma frase do pedido. As duas que mais importam:
 *
 *  - **"Offline NÃO significa indisponível"** — e o defeito que existia é o
 *    oposto do intuitivo: ligar `rodizio_offline` fazia o setor perder junto o
 *    respeito ao botão "Ausente", porque o código usava o `pool` CRU.
 *  - **"o SLA não começa enquanto o vendedor estiver offline"** — sem isso, o
 *    lead cai em Pendentes e é tomado 20 minutos depois, com ele dormindo.
 */
console.log("\nOffline != Ausente, e o plantao\n");

/** Setor com a regra de vendas ligada (offline recebe + divide igual). */
function vendasRegraNova(statusPorPessoa) {
  const st = cenario({});
  st.departments[0].dividir_igualmente = true;
  st.departments[0].rodizio_offline = true; // offline PARTICIPA
  st.departments[0].sla_so_online = true;
  st.location_members = Object.entries(statusPorPessoa).map(([u, estado]) => ({
    location_id: "loc1",
    user_id: u,
    department_id: "dep1",
    last_seen_at: estado === "offline" ? offline : online,
    disponibilidade: estado === "ausente" ? "ausente" : "online",
  }));
  return st;
}

/*
 * Põe conversas na fila JÁ com a sessão do bot concluída.
 *
 * ⚠️ Não é detalhe de teste: sem a sessão elas são retidas por "não passou pelo
 * bot" (regra do Gabriel), e o cenário mediria outra coisa sem dizer isso. O
 * `cenario()` faz esse pareamento sozinho quando as conversas vão nele; aqui
 * elas entram depois, então a sessão precisa ir junto.
 */
function comFila(st, convs) {
  st.conversations = convs;
  st.bot_sessions = convs.map((c) => ({ conversation_id: c.id, status: "concluido" }));
  return st;
}

{
  // Offline continua elegível; ausente sai. É a tabela do pedido, em uma linha.
  const st = vendasRegraNova({ paulo: "online", alberto: "offline", rogerio: "ausente" });
  const db = fakeDb(st);
  eq(
    "[regra] elegiveis = online + offline, SEM o ausente",
    await elegiveisOrdered(db, "loc1", ["paulo", "alberto", "rogerio"]),
    ["paulo", "alberto"],
  );
}

{
  /* O exemplo literal do pedido: "Se Alberto estiver offline -> Lead -> Alberto
     -> Pendentes". Com 2 leads e os dois elegíveis, um vai para cada. */
  const st = vendasRegraNova({ paulo: "online", alberto: "offline" });
  comFila(st, [naFila("k1"), naFila("k2")]);
  const db = fakeDb(st);
  const r = await distribuirFilaDoSetor(db, "loc1");
  const por = contarPorPessoa(db);
  eq("[regra] offline RECEBE: os 2 saem", r.distribuidas, 2);
  eq("[regra] um para cada, o offline inclusive", Object.keys(por).sort(), ["alberto", "paulo"]);
  const doAlberto = db.atribuicoes().find((e) => e.patch.assigned_to === "alberto");
  eq(
    "[regra] o lead do offline vai para PENDENTES (assigned_offline)",
    doAlberto.patch.assigned_offline,
    true,
  );
  const doPaulo = db.atribuicoes().find((e) => e.patch.assigned_to === "paulo");
  eq("[regra] o do online nao e pendente", doPaulo.patch.assigned_offline, false);
}

{
  /* 🔴 O defeito que existia: com `rodizio_offline` ligado, o AUSENTE recebia.
     "Se Alberto estiver Ausente -> Lead -> Rogério". */
  const st = vendasRegraNova({ alberto: "ausente", rogerio: "offline" });
  comFila(st, [naFila("k1"), naFila("k2"), naFila("k3")]);
  const db = fakeDb(st);
  await distribuirFilaDoSetor(db, "loc1");
  const por = contarPorPessoa(db);
  eq("[regra] o AUSENTE nao recebe nada", por.alberto ?? 0, 0);
  eq("[regra] tudo foi para quem nao esta ausente (offline inclusive)", por.rogerio, 3);
}

{
  // Todos ausentes: ninguém recebe, e o lead FICA NA FILA (não some, não cai
  // em quem declarou indisponibilidade).
  const st = vendasRegraNova({ paulo: "ausente", alberto: "ausente" });
  comFila(st, [naFila("k1")]);
  const db = fakeDb(st);
  const r = await distribuirFilaDoSetor(db, "loc1");
  eq("[regra] todos ausentes -> ninguem recebe", r.distribuidas, 0);
  eq("[regra] e o lead continua na fila, visivel", r.naFila, 1);
}

/* ---------------- Plantão ---------------- */

const plantaoDe = (user, extra = {}) => ({
  id: "pl1",
  location_id: "loc1",
  department_id: "dep1",
  user_id: user,
  inicio: new Date(AGORA - 3600 * 1000).toISOString(),
  fim: new Date(AGORA + 3600 * 1000).toISOString(),
  se_ausente: "normal",
  cancelado_em: null,
  ...extra,
});

{
  const db = fakeDb(cenario({ plantoes: [plantaoDe("rogerio")] }));
  eq("[plantao] o vigente e encontrado", (await plantaoAtivo(db, "dep1"))?.user_id, "rogerio");
}

{
  // Janela passada não vale — e o teste existe porque um plantão que não expira
  // sozinho concentraria os leads para sempre.
  const db = fakeDb(
    cenario({
      plantoes: [
        plantaoDe("rogerio", {
          inicio: new Date(AGORA - 7200 * 1000).toISOString(),
          fim: new Date(AGORA - 3600 * 1000).toISOString(),
        }),
      ],
    }),
  );
  eq("[plantao] terminado nao vale mais", await plantaoAtivo(db, "dep1"), null);
  const dbC = fakeDb(cenario({ plantoes: [plantaoDe("rogerio", { cancelado_em: "2026-09-11" })] }));
  eq("[plantao] cancelado nao vale", await plantaoAtivo(dbC, "dep1"), null);
}

{
  /* 100% dos leads para o plantonista, e a distribuição normal suspensa. */
  const st = vendasRegraNova({ paulo: "online", alberto: "online", rogerio: "online" });
  st.plantoes = [plantaoDe("rogerio")];
  comFila(st, [naFila("k1"), naFila("k2"), naFila("k3")]);
  const db = fakeDb(st);
  await distribuirFilaDoSetor(db, "loc1");
  const por = contarPorPessoa(db);
  eq("[plantao] 100% dos leads vao para o plantonista", por, { rogerio: 3 });
  eq("[plantao] o motivo aparece no fio", db.atribuicoes()[0].patch.assign_reason, "plantão");
  eq(
    "[plantao] a conversa fica marcada, para a cota ignorar depois",
    db.atribuicoes()[0].patch.plantao_id,
    "pl1",
  );
  /* ⚠️ item 9: "os leads do plantão não devem alterar o equilíbrio da
     distribuição normal" — por isso o cursor do setor NÃO avança. */
  eq("[plantao] o cursor do rodizio nao avanca", st.departments[0].rr_cursor, 0);
}

{
  // Plantonista OFFLINE recebe igual, e vai para Pendentes (item 7).
  const st = vendasRegraNova({ paulo: "online", rogerio: "offline" });
  st.plantoes = [plantaoDe("rogerio")];
  comFila(st, [naFila("k1")]);
  const db = fakeDb(st);
  await distribuirFilaDoSetor(db, "loc1");
  const at = db.atribuicoes()[0];
  eq("[plantao] offline recebe do mesmo jeito", at.patch.assigned_to, "rogerio");
  eq("[plantao] e o lead fica em Pendentes", at.patch.assigned_offline, true);
}

{
  // Plantonista AUSENTE + contingência "normal" -> cai no rodízio normal.
  const st = vendasRegraNova({ paulo: "online", rogerio: "ausente" });
  st.plantoes = [plantaoDe("rogerio")];
  comFila(st, [naFila("k1")]);
  const db = fakeDb(st);
  await distribuirFilaDoSetor(db, "loc1");
  eq(
    "[plantao] ausente + contingencia normal -> vai para outro",
    db.atribuicoes()[0].patch.assigned_to,
    "paulo",
  );
  eq("[plantao] e nao fica marcado como plantao", db.atribuicoes()[0].patch.plantao_id ?? null, null);
}

{
  // Plantonista AUSENTE + contingência "fila" -> o lead ESPERA, e não vai para
  // outro vendedor. É a outra opção que o pedido manda deixar configurável.
  const st = vendasRegraNova({ paulo: "online", rogerio: "ausente" });
  st.plantoes = [plantaoDe("rogerio", { se_ausente: "fila" })];
  comFila(st, [naFila("k1")]);
  const db = fakeDb(st);
  const r = await distribuirFilaDoSetor(db, "loc1");
  eq("[plantao] ausente + contingencia fila -> ninguem recebe", r.distribuidas, 0);
  eq("[plantao] o lead continua na fila", r.naFila, 1);
}

{
  /* ⚠️ Plantonista fora do pool do setor NÃO recebe: ele nem enxergaria a
     conversa (a RLS é por número/departamento), e some da fila sem ninguém
     atender. Cai na distribuição normal. */
  const st = vendasRegraNova({ paulo: "online" });
  st.plantoes = [plantaoDe("dequem_nao_e_do_setor")];
  comFila(st, [naFila("k1")]);
  const db = fakeDb(st);
  await distribuirFilaDoSetor(db, "loc1");
  eq(
    "[plantao] plantonista fora do pool -> distribuicao normal",
    db.atribuicoes()[0].patch.assigned_to,
    "paulo",
  );
}

/* ---------------- SLA que só corre com o vendedor online ---------------- */

const parada = (extra = {}) => ({
  conversation_id: "x1",
  contact_id: "c1",
  assigned_to: "paulo",
  assigned_by: null,
  channel_id: "ch1",
  devolvida_em: null,
  ultima_do_cliente: "2026-09-11T12:00:00Z",
  espera_util_min: 60,
  passou_pelo_bot: true,
  ja_respondida: false,
  minutos_com_atendente: 60,
  dono_online: true,
  minutos_de_sla: 60,
  ...extra,
});

{
  eq("[sla] dono online e prazo estourado -> devolve", devolvivel(parada(), ["ch1"], 20, true), true);
  /* 🔴 A metade que faltava do "offline recebe": com o vendedor offline o prazo
     está PARADO. Sem esta linha, o lead cairia em Pendentes e seria tomado 20
     minutos depois, com ele dormindo — e "continua pertencendo a ele" viraria
     mentira. */
  eq(
    "[sla] dono OFFLINE -> o prazo nao corre, nao devolve",
    devolvivel(parada({ dono_online: false }), ["ch1"], 20, true),
    false,
  );
  /* O lead caiu de madrugada e o vendedor chegou há 5 minutos: o prazo conta a
     partir da chegada dele, não da atribuição. */
  eq(
    "[sla] voltou ha 5 min -> ainda tem tempo",
    devolvivel(parada({ minutos_com_atendente: 300, minutos_de_sla: 5 }), ["ch1"], 20, true),
    false,
  );
  eq(
    "[sla] voltou ha 25 min sem responder -> devolve",
    devolvivel(parada({ minutos_com_atendente: 300, minutos_de_sla: 25 }), ["ch1"], 20, true),
    true,
  );
  /* ⚠️ Setor SEM a regra (a Secretaria) não muda de comportamento: o estado do
     dono é ignorado. Ligar isso em todo mundo repetiria a fila alta de 28/08. */
  eq(
    "[sla] setor sem a regra ignora o estado do dono",
    devolvivel(parada({ dono_online: false }), ["ch1"], 20, false),
    true,
  );
  /* ⚠️ Campo ausente (migração ainda não aplicada) NÃO pode travar a devolução
     inteira — o código vai ao ar antes do SQL. */
  eq(
    "[sla] sem os campos novos, vale a regra de hoje",
    devolvivel({ ...parada(), dono_online: undefined, minutos_de_sla: undefined }, ["ch1"], 20, true),
    true,
  );
}

console.log(`\n${ok} assercoes ok, ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
