/**
 * Divide um script SQL do Postgres em comandos.
 *
 * ⚠️ **`sql.split(";")` quebraria metade deste repositório.** 50 das migrações
 * do Lito CRM têm corpo de função entre `$$` (e tags `$function$`, `$p$`), onde
 * ponto e vírgula é código, não fim de comando. Sem tratar isso, a checagem
 * leria pedaços de função como comandos soltos e o ensaio contaria linhas
 * erradas.
 *
 * O que precisa ser respeitado, tudo já presente nas migrações do projeto:
 *   - `--` até o fim da linha;
 *   - `/* *​/`, que no Postgres ANINHA (diferente de C);
 *   - `'texto'` com `''` como escape, e `E'texto'` com barra invertida;
 *   - `"identificador"` com `""` como escape;
 *   - `$$ ... $$` e `$tag$ ... $tag$`, onde nada dentro é interpretado.
 *
 * Devolve um comando por item, com a linha onde começa — a linha é o que
 * permite a checagem apontar "linha 34" em vez de "em algum lugar do arquivo".
 */

/** Um `$` inicia dollar-quote se o que vem depois é `$` ou `identificador$`. */
function lerTagDollar(sql, i) {
  if (sql[i] !== "$") return null;
  let j = i + 1;
  while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
  if (sql[j] !== "$") return null;
  // Tag não pode começar por dígito (`$1$` é parâmetro, não delimitador).
  const tag = sql.slice(i, j + 1);
  if (/^\$\d/.test(tag)) return null;
  return tag;
}

export function dividirSql(sql) {
  const comandos = [];
  let inicio = 0;
  let linha = 1;
  let linhaInicio = 1;
  let i = 0;

  const empurrar = (fim) => {
    const texto = sql.slice(inicio, fim);
    if (texto.trim()) comandos.push({ sql: texto.trim(), linha: linhaInicio });
  };

  while (i < sql.length) {
    const c = sql[i];

    if (c === "\n") {
      linha++;
      i++;
      continue;
    }

    // -- comentário de linha
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }

    // /* comentário de bloco, ANINHÁVEL */
    if (c === "/" && sql[i + 1] === "*") {
      let nivel = 1;
      i += 2;
      while (i < sql.length && nivel > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          nivel++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          nivel--;
          i += 2;
        } else {
          if (sql[i] === "\n") linha++;
          i++;
        }
      }
      continue;
    }

    // $$ ... $$ / $tag$ ... $tag$
    const tag = lerTagDollar(sql, i);
    if (tag) {
      i += tag.length;
      const fim = sql.indexOf(tag, i);
      const ate = fim === -1 ? sql.length : fim + tag.length;
      for (let k = i; k < ate; k++) if (sql[k] === "\n") linha++;
      i = ate;
      continue;
    }

    // 'texto' — `''` escapa; em E'...' a barra invertida também
    if (c === "'") {
      const comEscape = i > 0 && /[eE]/.test(sql[i - 1]) && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? " ");
      i++;
      while (i < sql.length) {
        if (sql[i] === "\n") linha++;
        if (comEscape && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // "identificador" — `""` escapa
    if (c === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === "\n") linha++;
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (c === ";") {
      empurrar(i);
      i++;
      inicio = i;
      // A próxima linha só é conhecida depois de pular o espaço em branco —
      // senão todo comando "começa" na linha do ponto e vírgula anterior.
      while (inicio < sql.length && /\s/.test(sql[inicio])) {
        if (sql[inicio] === "\n") linha++;
        inicio++;
      }
      i = inicio;
      linhaInicio = linha;
      continue;
    }

    i++;
  }

  empurrar(sql.length);
  return comandos;
}

/**
 * Texto do comando sem comentários nem literais, em minúsculas.
 *
 * ⚠️ É isto que as checagens leem, e não o SQL cru. Sem apagar os literais,
 * a palavra "delete" DENTRO de um comentário ou de uma string (ex.: uma
 * policy chamada 'admin deleta conversa') dispararia o alerta de comando
 * destrutivo — e um alerta que grita no arquivo errado é um alerta que passa a
 * ser ignorado.
 *
 * Os literais são trocados por `''`/`$$$$` (e não removidos) para as checagens
 * ainda enxergarem que ali HAVIA um literal.
 */
export function esqueleto(comando) {
  let out = "";
  let i = 0;
  while (i < comando.length) {
    const c = comando[i];
    if (c === "-" && comando[i + 1] === "-") {
      while (i < comando.length && comando[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (c === "/" && comando[i + 1] === "*") {
      let nivel = 1;
      i += 2;
      while (i < comando.length && nivel > 0) {
        if (comando[i] === "/" && comando[i + 1] === "*") (nivel++, (i += 2));
        else if (comando[i] === "*" && comando[i + 1] === "/") (nivel--, (i += 2));
        else i++;
      }
      out += " ";
      continue;
    }
    const tag = lerTagDollar(comando, i);
    if (tag) {
      const fim = comando.indexOf(tag, i + tag.length);
      i = fim === -1 ? comando.length : fim + tag.length;
      out += "$$$$";
      continue;
    }
    if (c === "'") {
      i++;
      while (i < comando.length) {
        if (comando[i] === "'") {
          if (comando[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += "''";
      continue;
    }
    out += c;
    i++;
  }
  // Espaço em branco normalizado: as checagens casam "create   table" e
  // "create\n  table" com o mesmo padrão.
  return out.replace(/\s+/g, " ").trim().toLowerCase();
}
