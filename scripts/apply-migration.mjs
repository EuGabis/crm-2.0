#!/usr/bin/env node
/**
 * Aplica uma migração no Supabase com guarda.
 *
 * A versão anterior deste arquivo fazia `begin; query(sql); commit;` e mais
 * nada: sem checagem, sem saber se já tinha rodado, sem dizer quantas linhas ia
 * mexer e sem registrar o que aplicou. Com DOIS Claudes e o Gabriel escrevendo
 * no MESMO banco, isso é o que produziu 12 números de migração colididos e o
 * episódio da 0036 — dada como aplicada no AGENTS.md por dias, sem estar.
 *
 * A ordem é: checar → ver se já rodou → ENSAIAR e mostrar as linhas → pedir
 * confirmação → aplicar → registrar.
 *
 * ⚠️ **Sem conexão, o trabalho não é perdido.** Como hoje falta `DATABASE_URL`
 * no `.env.local` e o CA em `scripts/supabase-ca.crt`, o caminho real é colar
 * no SQL Editor. Nesse caso o script faz a parte estática e GERA um bloco para
 * colar que já inclui o registro — senão o registro nunca existiria justamente
 * no caminho que todo mundo usa.
 *
 * Uso:
 *   node scripts/apply-migration.mjs supabase/migrations/AAAAMMDDHHMM_nome.sql
 *   ... --so-checar     só a guarda estática
 *   ... --reaplicar     permite rodar de novo algo já registrado
 *   ... --forcar        aplica mesmo com erro da guarda (registra que foi forçado)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline/promises";
import { checarMigracao } from "./lib/migration-checks.mjs";
import { esqueleto } from "./lib/sql-split.mjs";

const DIR = "supabase/migrations";
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const soChecar = args.includes("--so-checar");
const reaplicar = args.includes("--reaplicar");
const forcar = args.includes("--forcar");

const C = { r: "\x1b[31m", y: "\x1b[33m", g: "\x1b[32m", d: "\x1b[2m", z: "\x1b[0m" };

if (!file) {
  console.error("Informe o arquivo SQL. Ex.: node scripts/apply-migration.mjs " + DIR + "/x.sql");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");
const nome = basename(file);
const hash = createHash("sha256").update(sql).digest("hex").slice(0, 16);

/** Quem está aplicando — é o que distingue os dois Claudes no registro. */
function quem() {
  if (process.env.LITO_AGENTE) return process.env.LITO_AGENTE;
  try {
    return execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim() || "desconhecido";
  } catch {
    return "desconhecido";
  }
}

/* ---------------------------- 1. guarda estática ---------------------------- */

const { achados, comandos } = checarMigracao(file, sql, readdirSync(DIR).filter((f) => f.endsWith(".sql")));
const erros = achados.filter((a) => a.nivel === "erro");
const atencoes = achados.filter((a) => a.nivel === "atencao");

console.log(`\n${nome}  ·  ${comandos.length} comandos  ·  hash ${hash}`);
if (achados.length) {
  console.log("");
  for (const a of achados) {
    const cor = a.nivel === "erro" ? C.r : a.nivel === "atencao" ? C.y : C.d;
    const rot = a.nivel === "erro" ? "ERRO   " : a.nivel === "atencao" ? "ATENCAO" : "nota   ";
    console.log(`  ${cor}${rot}${C.z} ${(a.linha ? "linha " + a.linha : a.regra).padEnd(10)} ${a.msg}`);
  }
}

if (erros.length && !forcar) {
  console.error(
    `\n${C.r}Bloqueado: ${erros.length} erro(s) da guarda.${C.z} Corrija, ou use --forcar se souber ` +
      `por que a regra não se aplica aqui (o registro guarda que foi forçado).`
  );
  process.exit(1);
}
if (soChecar) {
  console.log(`\n${C.g}Guarda estática ok.${C.z} (--so-checar: não toquei no banco)`);
  process.exit(0);
}

/* ---------------------------- 2. conexão (opcional) ---------------------------- */

const DDL_REGISTRO = `create schema if not exists private;
create table if not exists private.migrations_aplicadas (
  arquivo     text primary key,
  hash        text not null,
  aplicada_em timestamptz not null default now(),
  por         text,
  comandos    int,
  forcada     boolean not null default false
);
-- RLS ligada e NENHUMA policy: no schema private, é assim que se diz "ninguém
-- acessa pela API". Mesmo desenho de private.automation_config.
alter table private.migrations_aplicadas enable row level security;`;

function insertRegistro(por, forcada) {
  const esc = (s) => String(s).replace(/'/g, "''");
  return `insert into private.migrations_aplicadas (arquivo, hash, por, comandos, forcada)
values ('${esc(nome)}', '${esc(hash)}', '${esc(por)}', ${comandos.length}, ${forcada})
on conflict (arquivo) do update
   set hash = excluded.hash, aplicada_em = now(), por = excluded.por,
       comandos = excluded.comandos, forcada = excluded.forcada;`;
}

function lerConexao() {
  let env = "";
  try {
    env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    return { erro: "não achei o .env.local" };
  }
  const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (!url) return { erro: "o .env.local não tem DATABASE_URL" };
  let ca;
  try {
    // TLS sempre verificado. Nunca desabilitar — é dado de cliente no fio.
    ca = readFileSync(new URL("./supabase-ca.crt", import.meta.url), "utf8");
  } catch {
    return { erro: "falta scripts/supabase-ca.crt (Dashboard → Settings → Database → SSL)" };
  }
  return { url, ca };
}

const conexao = lerConexao();

/* ------- 2b. sem conexão: gera o bloco para colar, COM o registro ------- */

if (conexao.erro) {
  const saida = ".migracao-para-colar.sql";
  const bloco = `-- ============================================================
-- ${nome}
-- Gerado por scripts/apply-migration.mjs em ${new Date().toISOString()}
-- Guarda estática: ${erros.length} erro(s), ${atencoes.length} atenção(ões)${forcar ? "  [FORÇADO]" : ""}
--
-- Cole ESTE bloco no SQL Editor do Supabase, não o arquivo original: o
-- \`insert\` do fim é o que faz o outro Claude saber que isto já rodou.
-- ============================================================
begin;

${DDL_REGISTRO}

-- ---------- migração ----------
${sql.trim()}

-- ---------- registro ----------
${insertRegistro(quem() + " (sql-editor)", forcar)}

commit;
`;
  writeFileSync(saida, bloco, "utf8");
  console.log(`\n${C.y}Sem conexão direta:${C.z} ${conexao.erro}.`);
  console.log(`Gerei ${C.g}${saida}${C.z} — cole no SQL Editor. Já vem com o registro no fim.`);
  console.log(
    `\n${C.d}Para ganhar o ensaio com contagem de linhas e a confirmação, ponha DATABASE_URL no\n` +
      `.env.local e o CA em scripts/supabase-ca.crt. Sem isso, a guarda é só a estática.${C.z}`
  );
  if (atencoes.length) {
    console.log(
      `\n${C.y}Antes de colar, leia as ${atencoes.length} atenção(ões) acima${C.z} — ` +
        `comando destrutivo aqui não tem ensaio para te mostrar o tamanho do estrago.`
    );
  }
  process.exit(0);
}

/* ---------------------------- 3. com conexão ---------------------------- */

const pg = await import("pg");
const client = new pg.default.Client({
  connectionString: conexao.url,
  ssl: { ca: conexao.ca, rejectUnauthorized: true },
});

async function perguntar(texto) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const r = (await rl.question(texto)).trim();
  rl.close();
  return r;
}

try {
  await client.connect();
  await client.query(DDL_REGISTRO);

  // --- já rodou? ---
  const { rows } = await client.query(
    "select hash, aplicada_em, por from private.migrations_aplicadas where arquivo = $1",
    [nome]
  );
  if (rows.length && !reaplicar) {
    const r = rows[0];
    const mudou = r.hash !== hash;
    console.log(
      `\n${mudou ? C.r : C.y}Já registrada${C.z}: aplicada em ` +
        `${new Date(r.aplicada_em).toLocaleString("pt-BR")} por ${r.por}.`
    );
    if (mudou) {
      // Isto é pior que "já rodou": o arquivo mudou DEPOIS de aplicado, então o
      // banco e o repositório discordam e ninguém sabe qual está certo.
      console.error(
        `${C.r}⚠️ O arquivo MUDOU desde então${C.z} (registrado ${r.hash}, atual ${hash}). ` +
          `O banco não tem o que está no arquivo. Decida qual vale antes de seguir.`
      );
    }
    console.error(`\nUse --reaplicar se é isso mesmo que você quer.`);
    process.exit(1);
  }

  // --- ensaio: roda de verdade e desfaz ---
  console.log(`\n${C.d}-- ensaio (transação revertida no fim) --${C.z}`);
  const linhas = [];
  await client.query("begin");
  try {
    for (const c of comandos) {
      const res = await client.query(c.sql);
      const n = res.rowCount ?? 0;
      linhas.push({ linha: c.linha, n, e: esqueleto(c.sql).slice(0, 62) });
    }
  } finally {
    // SEMPRE desfaz: o ensaio não pode deixar rastro nem quando dá erro no meio.
    await client.query("rollback");
  }

  const mexeram = linhas.filter((l) => l.n > 0);
  if (mexeram.length) {
    for (const l of mexeram) {
      console.log(`  ${String(l.n).padStart(8)} linha(s)  ${C.d}L${l.linha}${C.z}  ${l.e}`);
    }
  } else {
    console.log(`  ${C.d}nenhum comando devolveu linhas afetadas (só DDL, provavelmente)${C.z}`);
  }
  const totalLinhas = mexeram.reduce((s, l) => s + l.n, 0);

  // --- confirmação ---
  const destrutivos = atencoes.filter((a) => a.regra === "destrutivo");
  if (destrutivos.length) {
    console.log(
      `\n${C.r}Esta migração tem ${destrutivos.length} comando(s) destrutivo(s)` +
        `${totalLinhas ? ` e o ensaio mexeu em ${totalLinhas.toLocaleString("pt-BR")} linha(s)` : ""}.${C.z}`
    );
  }
  const resposta = await perguntar(
    `\nAplicar de verdade? digite ${C.g}aplicar${C.z} (qualquer outra coisa cancela): `
  );
  if (resposta !== "aplicar") {
    console.log("Cancelado. Nada foi alterado.");
    process.exit(0);
  }

  // --- aplica e registra, na MESMA transação ---
  // Registro fora da transação poderia dizer "aplicada" com a migração
  // revertida, ou o contrário. Junto, ou os dois acontecem ou nenhum.
  await client.query("begin");
  await client.query(sql);
  await client.query(insertRegistro(quem(), forcar));
  await client.query("commit");
  console.log(`\n${C.g}OK: aplicada e registrada${C.z} como "${nome}" (hash ${hash}, por ${quem()}).`);
} catch (err) {
  try {
    await client.query("rollback");
  } catch {}
  console.error(`\n${C.r}ERRO:${C.z} ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
