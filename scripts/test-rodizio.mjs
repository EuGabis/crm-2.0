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
import { distribuirFilaDoSetor, PRESENCE_MS } from "../src/lib/leads/distribution.ts";

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
  return {
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
    pipelines: [{ id: "p1", location_id: "loc1", name: "Controle de Leads", position: 0 }],
    stages: [{ id: "s1", pipeline_id: "p1", name: "Novo Lead" }],
    opportunities: [],
    ...over,
  };
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

/* 5. Sem sessão de bot nenhuma -> distribui (número sem fluxo). */
{
  const db = fakeDb(cenario({ conversations: [naFila("k1")] }));
  eq("sem sessao de bot -> distribui", await distribuirFilaDoSetor(db, "loc1"), {
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

console.log(`\n${ok} assercoes ok, ${falhas} falha(s)\n`);
process.exit(falhas ? 1 : 0);
