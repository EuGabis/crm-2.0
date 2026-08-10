import { processDueCampaigns } from "@/lib/marketing/engine";

/** Nunca cachear: a rota é o batimento do envio de marketing. */
export const dynamic = "force-dynamic";

/**
 * Batimento do envio de campanhas de e-mail.
 *
 * Chamada a cada minuto pelo `pg_cron` (via `pg_net`) com o cabeçalho
 * `x-automation-secret` (o mesmo segredo máquina-a-máquina do motor de
 * automações). Sem o segredo responde 401 — roda com a service role.
 */
export async function POST(request: Request) {
  const expected = process.env.AUTOMATION_SECRET;
  if (!expected) {
    return Response.json(
      { error: "envio não configurado (AUTOMATION_SECRET ausente)" },
      { status: 503 },
    );
  }

  const secret = request.headers.get("x-automation-secret");
  if (!secret || secret !== expected) {
    return Response.json({ error: "não autorizado" }, { status: 401 });
  }

  try {
    const result = await processDueCampaigns();
    return Response.json(result);
  } catch (error) {
    console.error("[marketing] falha no tick:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "erro inesperado" },
      { status: 500 },
    );
  }
}
