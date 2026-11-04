// npm run check:consultas [-- --todos]
//
// Guarda das duas falhas SILENCIOSAS que mais custaram a este CRM (2026-11-04):
//
// 1) LEITURA SEM PAGINAÇÃO de tabela grande. O PostgREST corta em 1000 linhas
//    sem erro e sem aviso (armadilha nº 7 do AGENTS.md). Assinaturas: 2.689,
//    chegavam 1.000. A devolução de Vendas parou porque os leads frescos
//    ficavam depois da linha 1.000.
//
// 2) CONTAGEM SEM CONFERIR O ERRO. `const { count } = await ...` sem `error`:
//    ao estourar o tempo, `count` volta null, `count ?? 0` vira zero e a regra
//    que dependia dele (o limite diário do número) some em silêncio.
//
// Por padrão olha só os arquivos que mudaram em relação à main — o histórico
// antigo seria ruído e a saída seria ignorada no primeiro dia (mesma decisão do
// db:check). `--todos` faz a auditoria completa.
//
// Exceção consciente: comentário `consulta-ok: <motivo>` na linha da consulta
// ou na anterior. O motivo é obrigatório — "cabe em mil" sem número medido é o
// que deixou passar os casos acima.
import { execSync } from "node:child_process";
import { readFileSync, existsSync, globSync } from "node:fs";

/** Tabelas que já passaram (ou estão perto) de 1000 linhas por empresa. */
export const TABELAS_GRANDES = new Set([
  "messages", "conversations", "contacts", "opportunities", "payment_events",
  "payment_subscriptions", "tasks", "bot_desfechos", "bot_sessions",
  "presence_sessions", "status_eventos", "ai_logs", "email_campaign_recipients",
  "automation_runs", "automation_logs", "lead_origens", "lead_cliques",
  "falhas_consulta", "form_submissions",
]);

/** O que torna a leitura limitada ou pontual. */
const LIMITADA = /\.(range|limit|single|maybeSingle)\(|head:\s*true/;
/** Filtro por chave que devolve poucas linhas (um contato, uma conversa...). */
const PONTUAL = /\.(eq|in)\("(id|conversation_id|contact_id|campaign_id|opportunity_id|user_id)"/;

export function analisar(codigo, arquivo) {
  const achados = [];
  const linhas = codigo.split("\n");
  const linhaDe = (i) => codigo.slice(0, i).split("\n").length;
  const excecao = (ln) =>
    /consulta-ok:\s*\S/.test(linhas[ln - 1] ?? "") || /consulta-ok:\s*\S/.test(linhas[ln - 2] ?? "");

  for (const m of codigo.matchAll(/\.from\(\s*"([a-z_]+)"\s*\)/g)) {
    const tabela = m[1];
    if (!TABELAS_GRANDES.has(tabela)) continue;
    // A consulta vai até o fim do comando (`;`) — ou até a próxima, o que vier antes.
    const resto = codigo.slice(m.index + m[0].length, m.index + m[0].length + 900);
    const cmd = resto.split(/;\s*\n|\.from\(/)[0];
    if (!/^\s*\.select\(/.test(cmd)) continue; // insert/update/delete
    if (LIMITADA.test(cmd) || PONTUAL.test(cmd)) continue;
    // Consulta montada numa variável e paginada no comando seguinte
    // (`let q = ...from(); ... await q.range(...)`): o .range() vem logo depois.
    const vizinhanca = codigo.slice(m.index, m.index + 1400);
    if (/\.(range|limit)\(/.test(vizinhanca) && /(let|const)\s+\w+\s*=\s*(\(\)\s*=>\s*)?[\s\S]{0,80}$/.test(codigo.slice(Math.max(0, m.index - 120), m.index))) continue;
    // Paginada por uma função auxiliar que recebe a consulta (todasAsLinhas etc.).
    const antes = codigo.slice(Math.max(0, m.index - 160), m.index);
    if (/todasAsLinhas\(|paginar\w*\(|fetchAll\w*\(/.test(antes)) continue;
    const ln = linhaDe(m.index);
    if (excecao(ln)) continue;
    achados.push({
      arquivo, linha: ln, regra: "sem-paginacao",
      msg: `"${tabela}" lida sem .range()/.limit(): o PostgREST corta em 1000 linhas sem avisar. ` +
        `Pagine (ver todasAsLinhas em lib/leads/distribution.ts) ou marque "consulta-ok: <motivo medido>".`,
    });
  }

  for (const m of codigo.matchAll(/const\s*\{([^}]*)\}\s*=\s*await/g)) {
    const campos = m[1];
    if (!/\bcount\b/.test(campos) || /\berror\b/.test(campos)) continue;
    // Com `data` junto, a falha aparece como lista vazia e o código já trata o
    // total à parte — o perigo é a contagem SOZINHA virar zero.
    if (/\bdata\b/.test(campos)) continue;
    const ln = linhaDe(m.index);
    if (excecao(ln)) continue;
    achados.push({
      arquivo, linha: ln, regra: "count-sem-erro",
      msg: "`count` lido sem `error`: se a consulta estourar o tempo, count vem null e vira zero. " +
        "Desestruture `error` e trate (ou marque \"consulta-ok: <motivo>\").",
    });
  }
  return achados;
}

function arquivosAlvo(todos) {
  if (todos) return globSync("src/**/*.{ts,tsx}");
  let base = "origin/main";
  try {
    execSync(`git rev-parse --verify ${base}`, { stdio: "ignore" });
  } catch {
    base = "HEAD";
  }
  const saida = execSync(`git diff --name-only ${base} -- src`, { encoding: "utf8" });
  return saida.split("\n").filter((f) => /\.(ts|tsx)$/.test(f) && existsSync(f));
}

// Só roda como CLI quando chamado diretamente (o teste importa `analisar`).
if (/(^|[\\/])check-consultas\.mjs$/.test(process.argv[1] ?? "")) {
  const todos = process.argv.includes("--todos");
  const alvo = arquivosAlvo(todos);
  const achados = alvo.flatMap((f) => analisar(readFileSync(f, "utf8"), f.replace(/\\/g, "/")));
  for (const a of achados) console.log(`${a.arquivo}:${a.linha}  [${a.regra}]  ${a.msg}`);
  console.log(`\n${alvo.length} arquivo(s) · ${achados.length} achado(s)${todos ? " (auditoria completa)" : " (só o que mudou)"}`);
  process.exit(achados.length ? 1 : 0);
}
