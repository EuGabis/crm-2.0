/**
 * `fetch` que registra as falhas SILENCIOSAS do banco.
 *
 * Tempo esgotado (57014) e falha de conexão chegam ao código como `error` — e
 * boa parte do código trata `error` como "veio vazio". Em 24h foram 3.768
 * consultas canceladas sem ninguém saber (2026-11-04). Este fetch não muda a
 * resposta: só avisa `registrar_falha_consulta`, e a tela de Saúde mostra.
 *
 * ⚠️ Nada aqui pode quebrar a chamada original: o registro é disparado sem
 * `await`, qualquer erro dele é engolido, e a resposta devolvida é a mesma.
 */

/** Códigos que significam "o banco não respondeu", não "a consulta é inválida". */
const CODIGOS = new Set(["57014", "PGRST000", "PGRST001", "PGRST002", "PGRST003"]);
const RPC_REGISTRO = "rpc/registrar_falha_consulta";
/** Uma tentativa de registro por recurso por minuto, por aba/processo. */
const JANELA_MS = 60_000;
const ultimoRegistro = new Map<string, number>();

/** "rest/v1/conversations?select=..." → "conversations"; ".../rpc/x" → "rpc/x". */
export function recursoDaUrl(url: string): string | null {
  const m = /\/rest\/v1\/([^?#]+)/.exec(url);
  if (!m) return null;
  return decodeURIComponent(m[1]).slice(0, 120);
}

function cabecalho(init: RequestInit | undefined, nome: string): string | null {
  const h = init?.headers;
  if (!h) return null;
  if (h instanceof Headers) return h.get(nome);
  if (Array.isArray(h)) return h.find(([k]) => k.toLowerCase() === nome)?.[1] ?? null;
  const rec = h as Record<string, string>;
  for (const k of Object.keys(rec)) if (k.toLowerCase() === nome) return rec[k];
  return null;
}

export function criarFetchVigiado(opcoes: { location?: () => string | null } = {}): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const res = await fetch(input, init);
    if (res.ok || res.status < 500) return res;
    const recurso = recursoDaUrl(url);
    if (!recurso || recurso === RPC_REGISTRO) return res;

    void (async () => {
      try {
        const corpo = await res.clone().json().catch(() => null);
        const codigo = (corpo?.code as string | undefined) ?? "";
        if (!CODIGOS.has(codigo)) return;
        const agora = Date.now();
        if (agora - (ultimoRegistro.get(recurso) ?? 0) < JANELA_MS) return;
        ultimoRegistro.set(recurso, agora);

        const base = url.slice(0, url.indexOf("/rest/v1/"));
        const apikey = cabecalho(init, "apikey");
        const auth = cabecalho(init, "authorization");
        if (!apikey) return;
        await fetch(`${base}/rest/v1/${RPC_REGISTRO}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey,
            ...(auth ? { Authorization: auth } : {}),
          },
          body: JSON.stringify({
            p_codigo: codigo,
            p_recurso: recurso,
            p_location: opcoes.location?.() ?? null,
          }),
        });
      } catch {
        // registro é best-effort
      }
    })();
    return res;
  };
}
