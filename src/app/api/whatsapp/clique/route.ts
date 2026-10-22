import { createAdminClient } from "@/lib/supabase/admin";
import { soDigitos, TAM_CODIGO } from "@/lib/origem/origem";

/**
 * POST /api/whatsapp/clique — o script do site (`/api/whatsapp/rastreio.js`)
 * registra o clique no botão de WhatsApp: código curto + gclid/UTMs + página.
 *
 * Pública (fora do matcher do proxy, como o resto de `api/whatsapp`): quem chama
 * é o navegador do visitante, sem sessão. A EMPRESA sai do número do link wa.me
 * (`whatsapp_channels.phone_e164`), nunca de um id enviado pelo site.
 * Só INSERE em lead_cliques; não lê nada de volta — um site malicioso no máximo
 * cria cliques que nenhuma mensagem vai reivindicar.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

const corta = (v: unknown, n = 500) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;

export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    // sendBeacon manda text/plain: lê como texto e faz o parse.
    b = JSON.parse(await req.text());
  } catch {
    return new Response("json inválido", { status: 400, headers: CORS });
  }
  const codigo = corta(b.codigo, 20)?.toUpperCase() ?? "";
  if (codigo.length !== TAM_CODIGO) return new Response("código inválido", { status: 400, headers: CORS });
  const tel = soDigitos(corta(b.telefone, 30));
  if (tel.length < 10) return new Response("telefone inválido", { status: 400, headers: CORS });

  const db = createAdminClient();
  const { data: canais } = await db.from("whatsapp_channels").select("location_id, phone_e164");
  // Casa pelos últimos 10 dígitos: o link pode vir com ou sem 55/9.
  const canal = (canais ?? []).find((c: { location_id: string; phone_e164: string | null }) => {
    const d = soDigitos(c.phone_e164);
    return d && d.slice(-10) === tel.slice(-10);
  });
  if (!canal) return new Response("número desconhecido", { status: 404, headers: CORS });

  const { error } = await db.from("lead_cliques").insert({
    location_id: canal.location_id,
    codigo,
    telefone: tel,
    gclid: corta(b.gclid),
    gbraid: corta(b.gbraid),
    wbraid: corta(b.wbraid),
    fbclid: corta(b.fbclid),
    utm_source: corta(b.utm_source),
    utm_medium: corta(b.utm_medium),
    utm_campaign: corta(b.utm_campaign),
    utm_term: corta(b.utm_term),
    utm_content: corta(b.utm_content),
    pagina: corta(b.pagina, 1000),
    referrer: corta(b.referrer, 1000),
  });
  if (error && error.code !== "23505") {
    console.warn("[origem] clique não gravado:", error.message);
    return new Response("erro", { status: 500, headers: CORS });
  }
  return new Response(null, { status: 204, headers: CORS });
}
