/**
 * Checagens estáticas de uma migração do Lito CRM.
 *
 * Não é lint genérico de SQL: cada regra aqui existe por causa de um problema
 * que ESTE repositório já teve, e o comentário de cada uma diz qual. Regra sem
 * caso real vira ruído, e checagem ruidosa é checagem ignorada.
 *
 * Níveis: "erro" barra a aplicação; "atencao" exige confirmação explícita;
 * "nota" é só informativo.
 */

import { readdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { dividirSql, esqueleto } from "./sql-split.mjs";

const NOVO = /^(\d{12})_[a-z0-9_]+\.sql$/;
const LEGADO = /^(\d{4})_[a-z0-9_]+\.sql$/;

/**
 * Nome do arquivo.
 *
 * ⚠️ **A colisão de número era estrutural, não descuido.** O número saía de um
 * contador COMPARTILHADO que os dois Claudes leem antes de qualquer um
 * escrever: ambos dão `git pull`, ambos veem 0085 como o maior, ambos escolhem
 * 0086. Deu 12 números duplicados no repositório (0014, 0015, 0016, 0019,
 * 0056, 0078, 0079, 0080, 0086, 0087, 0089, 0090).
 *
 * `AAAAMMDDHHMM` acaba com isso na origem: não há contador para ler, e duas
 * máquinas só colidem escrevendo no MESMO minuto — e aí os nomes divergem, o
 * que o teste de duplicata pega.
 *
 * Os arquivos de 4 dígitos continuam válidos: já foram aplicados, e renomear
 * arquivo aplicado só criaria dúvida sobre o que rodou. Ordenam antes dos
 * novos por acaso feliz ("0091" < "2026").
 */
export function checarNome(caminho) {
  const nome = basename(caminho);
  if (NOVO.test(nome)) return [];
  if (LEGADO.test(nome)) {
    return [
      {
        nivel: "atencao",
        regra: "nome",
        msg:
          `"${nome}" usa a numeração antiga de 4 dígitos, que é um contador compartilhado ` +
          `e já produziu 12 colisões entre os dois Claudes. Use AAAAMMDDHHMM_nome.sql.`,
      },
    ];
  }
  return [
    {
      nivel: "erro",
      regra: "nome",
      msg: `"${nome}" fora do padrão. Use AAAAMMDDHHMM_nome_em_minusculas.sql.`,
    },
  ];
}

/** Prefixo numérico do arquivo, seja de 4 ou de 12 dígitos. */
export function prefixo(nome) {
  return basename(nome).match(/^(\d+)_/)?.[1] ?? null;
}

/**
 * Outro arquivo já usa este prefixo?
 *
 * É a rede que impede a 13ª colisão de chegar à `main`. Roda no commit e antes
 * de aplicar, porque o momento em que o número foi escolhido e o momento em que
 * o outro Claude fez push podem estar a minutos de distância.
 */
export function checarDuplicata(caminho, arquivos) {
  const nome = basename(caminho);
  const p = prefixo(nome);
  if (!p) return [];
  const lista =
    arquivos ?? readdirSync(dirname(caminho) || ".").filter((f) => f.endsWith(".sql"));
  const iguais = lista.filter((f) => f !== nome && prefixo(f) === p);
  if (!iguais.length) return [];
  return [
    {
      nivel: "erro",
      regra: "duplicata",
      msg:
        `o prefixo ${p} já é usado por ${iguais.join(", ")}. ` +
        `Renomeie para AAAAMMDDHHMM_${nome.replace(/^\d+_/, "")}.`,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Idempotência
 *
 * ⚠️ **Toda migração deste projeto tem que poder rodar duas vezes.** Não é
 * preciosismo: como não existia registro do que foi aplicado, reaplicar por
 * dúvida é rotina — e foi assim que se descobriu, em 2026-08-17, que a 0036
 * nunca tinha sido aplicada apesar de o AGENTS.md a dar como pronta.
 * ------------------------------------------------------------------ */

const IDEMPOTENCIA = [
  {
    // `create table` sem guarda estoura em 42P07 na segunda vez.
    casa: /^create (unlogged )?table (?!if not exists)/,
    msg: "create table sem `if not exists`",
  },
  {
    casa: /^create (unique )?index (?!if not exists)(?!concurrently)/,
    msg: "create index sem `if not exists`",
  },
  {
    // Aqui NÃO existe `if not exists` no Postgres: o idioma do projeto é
    // `drop policy if exists` na linha de cima.
    casa: /^create policy/,
    msg: "create policy sem o `drop policy if exists` correspondente antes",
    exigeDropAntes: /^drop policy if exists/,
  },
  {
    casa: /^create trigger/,
    msg: "create trigger sem o `drop trigger if exists` correspondente antes",
    exigeDropAntes: /^drop trigger if exists/,
  },
  {
    // `create function` sem `or replace` estoura se a função já existe.
    casa: /^create function/,
    msg: "use `create or replace function`",
  },
  { casa: /^create view/, msg: "use `create or replace view`" },
  {
    casa: /^create schema (?!if not exists)/,
    msg: "create schema sem `if not exists`",
  },
  {
    casa: /^create extension (?!if not exists)/,
    msg: "create extension sem `if not exists`",
  },
  {
    casa: /^alter table .* add column (?!if not exists)/,
    msg: "add column sem `if not exists`",
  },
  {
    casa: /^alter table .* drop column (?!if exists)/,
    msg: "drop column sem `if exists`",
  },
];

/* ------------------------------------------------------------------ *
 * Comandos destrutivos
 *
 * `drop policy/trigger/index/function if exists` NÃO entram aqui: são o
 * próprio idioma da idempotência acima, e sinalizá-los faria o alerta
 * aparecer em quase toda migração — o caminho mais curto para ninguém mais
 * ler o alerta.
 * ------------------------------------------------------------------ */

const DESTRUTIVO = [
  { casa: /^update /, semWhere: true, msg: "update em TODAS as linhas da tabela" },
  { casa: /^delete from /, semWhere: true, msg: "delete de TODAS as linhas da tabela" },
  { casa: /^drop table /, msg: "drop table — apaga dados, não tem desfazer" },
  { casa: /^truncate /, msg: "truncate — apaga dados, não tem desfazer" },
  { casa: /^alter table .* drop column /, msg: "drop column — apaga dados da coluna" },
  { casa: /^drop schema /, msg: "drop schema" },
];

export function checarComandos(sql) {
  const achados = [];
  const comandos = dividirSql(sql).map((c) => ({ ...c, e: esqueleto(c.sql) }));

  comandos.forEach((c, i) => {
    if (!c.e) return;

    for (const r of IDEMPOTENCIA) {
      if (!r.casa.test(c.e)) continue;
      if (r.exigeDropAntes) {
        // Procura o drop em QUALQUER comando anterior, não só no imediatamente
        // acima: as migrações do projeto às vezes agrupam todos os drops no
        // topo antes de recriar as policies.
        const temDrop = comandos.slice(0, i).some((a) => r.exigeDropAntes.test(a.e));
        if (temDrop) continue;
      }
      achados.push({ nivel: "erro", regra: "idempotencia", linha: c.linha, msg: r.msg });
    }

    for (const r of DESTRUTIVO) {
      if (!r.casa.test(c.e)) continue;
      // `where` só conta fora de subconsulta? Basta a presença: um update com
      // where dentro de subconsulta e sem where no topo é raríssimo, e o custo
      // de um falso negativo aqui é menor que o de gritar em toda migração.
      if (r.semWhere && / where /.test(c.e)) continue;
      achados.push({ nivel: "atencao", regra: "destrutivo", linha: c.linha, msg: r.msg });
    }
  });

  achados.push(...checarSegurancaDeFuncao(comandos));
  return { achados, comandos };
}

/* ------------------------------------------------------------------ *
 * Segurança de função — as duas regras que vêm direto da migração 0080
 * ------------------------------------------------------------------ */

/** Nome da função criada por um comando, sem os argumentos. */
function nomeDaFuncao(e) {
  const m = e.match(/^create (?:or replace )?function ([a-z0-9_."]+)\s*\(/);
  return m ? m[1].replace(/"/g, "") : null;
}

function checarSegurancaDeFuncao(comandos) {
  const achados = [];
  const revogadas = new Set();
  const grantadas = new Set();
  for (const c of comandos) {
    let m = c.e.match(/^revoke .*execute.* on function ([a-z0-9_."]+)/);
    if (m && /\b(public|anon)\b/.test(c.e)) revogadas.add(m[1].replace(/"/g, ""));
    m = c.e.match(/^grant .*execute.* on function ([a-z0-9_."]+)/);
    if (m) grantadas.add(m[1].replace(/"/g, ""));
  }

  for (const c of comandos) {
    const nome = nomeDaFuncao(c.e);
    if (!nome) continue;
    const emPublic = nome.startsWith("public.") || !nome.includes(".");
    const temReplace = /^create or replace function/.test(c.e);
    const ehTrigger = /returns trigger/.test(c.e);

    /**
     * ⚠️ **`create function` já concede EXECUTE a PUBLIC.** É o padrão do
     * Postgres, e foi o achado mais grave da migração 0080: SEIS funções
     * `security definer` eram chamáveis SEM LOGIN. Conferido na época como
     * `anon`, `public.contact_conversation(<uuid>, 'whatsapp')` devolvia o id
     * da conversa e o atendente atribuído, de qualquer empresa.
     *
     * ⚠️ Só `grant execute to authenticated` NÃO basta — ele não tira o
     * EXECUTE que o PUBLIC ganhou de graça.
     *
     * A gravidade é calibrada porque o estático não sabe se a função já
     * existia (medido: das 32 criações em `public` neste repositório, 31 usam
     * `or replace`):
     *   - **grant sem revoke** é o bug da 0080 em estado puro: a migração se
     *     preocupou com privilégio, tratou `authenticated` e esqueceu o PUBLIC.
     *     Levantar como erro acerta em cheio — 17 funções do repositório estão
     *     exatamente assim.
     *   - **`create function` sem `or replace`** é função nova por definição,
     *     logo nasce com o EXECUTE do PUBLIC. Erro.
     *   - **`or replace` sem mexer em privilégio** é provável substituição de
     *     função existente, e `create or replace` NÃO reseta grants: os
     *     anteriores continuam valendo. Fica como nota, para não gritar em
     *     toda migração que só ajusta o corpo.
     */
    if (emPublic && !revogadas.has(nome)) {
      const oBugDa0080 = grantadas.has(nome);
      achados.push({
        nivel: oBugDa0080 || !temReplace ? "erro" : "nota",
        regra: "seguranca",
        linha: c.linha,
        msg: oBugDa0080
          ? `${nome} recebe \`grant execute\` mas NUNCA \`revoke ... from public, anon\`. ` +
            `O grant não tira o EXECUTE que o PUBLIC ganhou na criação — a função fica ` +
            `chamável sem login. É o bug exato da 0080. Falta: ` +
            `\`revoke execute on function ${nome}(...) from public, anon;\``
          : !temReplace
            ? `${nome} é função nova em public e nasce com EXECUTE para PUBLIC. Falta ` +
              `\`revoke execute on function ${nome}(...) from public, anon;\` (ver 0080).`
            : `${nome} não mexe em privilégio. Se a função é NOVA, falta o par ` +
              `revoke/grant (ver 0080); se já existia, os grants anteriores seguem valendo.`,
      });
    }

    /**
     * ⚠️ **`security definer` sem checagem de empresa = ler dado de qualquer
     * empresa.** O padrão do projeto (migração 0049) é `private.user_locations()`
     * na PRIMEIRA linha do corpo. A heurística só procura a menção: decidir se
     * é realmente a primeira linha exigiria entender plpgsql, e um alerta que
     * pede conferência humana é melhor que nenhum.
     *
     * ⚠️ **Só vale para `public.*` e não-trigger**, e isto foi calibrado, não
     * chutado: sem o recorte a regra disparava 65 vezes nas 103 migrações, das
     * quais 36 eram funções do schema `private` (que não é exposto na API) e
     * 12 eram `returns trigger` — gatilho roda no contexto de quem escreveu a
     * linha, então não há "empresa do chamador" para conferir. Regra que
     * dispara 65 vezes sendo 48 delas ruído é regra que ninguém lê.
     */
    // ⚠️ A menção é procurada no SQL CRU (`c.sql`), não no esqueleto: o
    // esqueleto troca o corpo entre `$$` por um marcador, e o corpo é
    // exatamente onde `private.user_locations()` fica. Testando o esqueleto, a
    // regra disparava em TODA função definer de `public` — inclusive na
    // `lead_payment_profile`, que é a que deu origem ao padrão.
    if (
      emPublic &&
      !ehTrigger &&
      /security definer/.test(c.e) &&
      !/user_locations|is_admin|sees_all/.test(c.sql.toLowerCase())
    ) {
      achados.push({
        nivel: "atencao",
        regra: "seguranca",
        linha: c.linha,
        msg:
          `${nome} é \`security definer\` e não menciona private.user_locations() / is_admin / ` +
          `sees_all. Confirme que a checagem de empresa é a PRIMEIRA linha do corpo (padrão 0049) ` +
          `— sem ela, definer significa "qualquer autenticado lê o dado de qualquer empresa".`,
      });
    }
  }
  return achados;
}

/** Roda tudo num arquivo. */
export function checarMigracao(caminho, sql, arquivos) {
  const { achados, comandos } = checarComandos(sql);
  return {
    achados: [...checarNome(caminho), ...checarDuplicata(caminho, arquivos), ...achados],
    comandos,
  };
}
