#!/usr/bin/env node
/**
 * Guarda estática das migrações — roda SEM banco.
 *
 * ⚠️ Funcionar offline não é conveniência, é requisito: hoje o `.env.local`
 * não tem `DATABASE_URL` e o certificado CA não está em `scripts/`, então o
 * caminho real de aplicação é colar no SQL Editor. Uma guarda que exigisse
 * conexão simplesmente não rodaria — e é a checagem que não roda que deixou 12
 * números colidirem.
 *
 * Uso:
 *   node scripts/check-migrations.mjs                 # só o que mudou vs HEAD
 *   node scripts/check-migrations.mjs --todos         # auditoria do repositório
 *   node scripts/check-migrations.mjs <arquivo.sql>   # um arquivo
 *
 * Sai com código 1 se houver "erro" — é o que permite usar em hook/CI.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { checarMigracao } from "./lib/migration-checks.mjs";

const DIR = "supabase/migrations";
const args = process.argv.slice(2);
const todos = args.includes("--todos");
const alvosDados = args.filter((a) => !a.startsWith("--"));

const noRepo = readdirSync(DIR).filter((f) => f.endsWith(".sql"));

/**
 * Arquivos a checar.
 *
 * O padrão é só o que MUDOU, e isso é deliberado: as 103 migrações antigas
 * acumulam 54 achados de idempotência que são história, já aplicada e sem
 * desfazer. Checar tudo por padrão faria a saída ser ignorada no primeiro dia.
 * `--todos` existe para quando a pergunta é justamente a auditoria.
 */
function alvos() {
  if (alvosDados.length) return alvosDados;
  if (todos) return noRepo.map((f) => `${DIR}/${f}`);
  try {
    const mudados = execFileSync("git", ["diff", "--name-only", "HEAD", "--", DIR], {
      encoding: "utf8",
    });
    const novos = execFileSync("git", ["ls-files", "--others", "--exclude-standard", DIR], {
      encoding: "utf8",
    });
    return [...new Set(`${mudados}\n${novos}`.split("\n"))]
      .map((s) => s.trim())
      .filter((s) => s.endsWith(".sql") && existsSync(s));
  } catch {
    // Sem git (ou fora de repositório) não dá para saber o que é novo. Checar
    // tudo é a escolha segura: pior sair ruidoso do que sair calado.
    return noRepo.map((f) => `${DIR}/${f}`);
  }
}

const CORES = {
  erro: "\x1b[31m",
  atencao: "\x1b[33m",
  nota: "\x1b[36m",
  fim: "\x1b[0m",
};
const ROTULO = { erro: "ERRO   ", atencao: "ATENCAO", nota: "nota   " };

const lista = alvos();
if (!lista.length) {
  console.log("Nenhuma migração nova ou alterada. Nada a checar.");
  process.exit(0);
}

let erros = 0;
let atencoes = 0;
const resumo = {};

for (const caminho of lista) {
  const sql = readFileSync(caminho, "utf8");
  const { achados, comandos } = checarMigracao(caminho, sql, noRepo);
  const relevantes = todos ? achados.filter((a) => a.nivel !== "nota") : achados;

  if (relevantes.length) {
    console.log(`\n${basename(caminho)}  (${comandos.length} comandos)`);
    for (const a of relevantes) {
      const onde = a.linha ? `linha ${a.linha}` : a.regra;
      console.log(
        `  ${CORES[a.nivel]}${ROTULO[a.nivel]}${CORES.fim} ${onde.padEnd(10)} ${a.msg}`
      );
      resumo[a.regra] = (resumo[a.regra] ?? 0) + 1;
    }
  }
  erros += achados.filter((a) => a.nivel === "erro").length;
  atencoes += achados.filter((a) => a.nivel === "atencao").length;
}

console.log(
  `\n${lista.length} arquivo(s) checado(s) · ${erros} erro(s) · ${atencoes} atenção(ões)`
);
if (Object.keys(resumo).length) {
  console.log("por regra: " + Object.entries(resumo).map(([k, v]) => `${k}=${v}`).join("  "));
}

if (erros) {
  console.log(
    `\n${CORES.erro}Não aplique com erro pendente.${CORES.fim} Cada regra existe por causa de um ` +
      `problema que este repositório já teve — o comentário dela em scripts/lib/migration-checks.mjs diz qual.`
  );
  process.exit(1);
}
console.log("ok — nenhum erro bloqueante.");
