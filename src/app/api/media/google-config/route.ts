import { NextResponse } from "next/server";

/**
 * Configuração pública do Google Picker (client id + chave de API).
 *
 * Por que uma rota em vez de ler `process.env.NEXT_PUBLIC_*` no componente:
 * variável `NEXT_PUBLIC_` é **embutida no bundle na hora do build**. Definir na
 * Vercel sem refazer o deploy não muda nada, e a tela continua dizendo "falta
 * configurar" — foi exatamente o que aconteceu em produção. Lida aqui, no
 * servidor, a variável passa a valer na requisição seguinte, sem rebuild.
 *
 * Não é segredo: client id e chave de API do Picker são visíveis no navegador
 * por definição (a chave é restringida por referrer HTTP no console do Google,
 * e o client id, pelas origens JavaScript autorizadas). Ainda assim a rota fica
 * atrás do proxy de sessão, como todo o resto de `/api/media`.
 *
 * Precedência do client id — a primeira preenchida ganha:
 *   1. NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID  (o que o .env.local já usa)
 *   2. GOOGLE_PICKER_CLIENT_ID             (quando o Picker precisa de um
 *                                           client PRÓPRIO, separado do Ads)
 *   3. GOOGLE_OAUTH_CLIENT_ID              (o mesmo do Google Ads/Drive OAuth)
 * ⚠️ O client usado precisa ter a ORIGEM JavaScript do CRM cadastrada. O do
 * Google Ads costuma ter só URIs de redirecionamento — por isso o `source` vai
 * na resposta e o client id aparece na tela: "origem não cadastrada" com o
 * client errado é indistinguível de "origem não cadastrada" com o certo.
 */
export async function GET() {
  const clientId =
    process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID?.trim() ||
    process.env.GOOGLE_PICKER_CLIENT_ID?.trim() ||
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ||
    "";
  const apiKey =
    process.env.NEXT_PUBLIC_GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    "";

  const clientIdSource = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID?.trim()
    ? "NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID"
    : process.env.GOOGLE_PICKER_CLIENT_ID?.trim()
      ? "GOOGLE_PICKER_CLIENT_ID"
      : process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
        ? "GOOGLE_OAUTH_CLIENT_ID"
        : null;
  const apiKeySource = process.env.NEXT_PUBLIC_GOOGLE_API_KEY?.trim()
    ? "NEXT_PUBLIC_GOOGLE_API_KEY"
    : process.env.GOOGLE_API_KEY?.trim()
      ? "GOOGLE_API_KEY"
      : null;

  return NextResponse.json(
    { clientId, apiKey, clientIdSource, apiKeySource },
    // Sem cache: trocar a variável na Vercel tem que valer na hora.
    { headers: { "cache-control": "no-store" } },
  );
}
