import { verifyUnsubscribe } from "@/lib/marketing/unsubscribe";
import { createAdminClient } from "@/lib/supabase/admin";
import { brand } from "@/lib/config/brand";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

/**
 * Descadastro de campanhas de marketing.
 *
 * GET: clique no rodapé do e-mail → página de confirmação.
 * POST: one-click do Gmail/Outlook (header List-Unsubscribe-Post) → 200.
 *
 * O link é assinado (HMAC via AUTOMATION_SECRET), então não dá para descadastrar
 * terceiros mexendo na URL. Seta `contacts.marketing_opt_out = true` — não afeta
 * e-mails transacionais (que checam só `dnd`).
 */
async function optOut(c: string, s: string, campaign: string | null): Promise<boolean> {
  if (!c || !verifyUnsubscribe(c, s)) return false;
  const db = createAdminClient();
  await db.from("contacts").update({ marketing_opt_out: true }).eq("id", c);
  if (campaign) {
    const { data } = await db
      .from("email_campaigns")
      .select("unsubscribed")
      .eq("id", campaign)
      .maybeSingle();
    if (data) {
      await db
        .from("email_campaigns")
        .update({ unsubscribed: ((data as any).unsubscribed ?? 0) + 1 })
        .eq("id", campaign);
    }
  }
  return true;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const c = url.searchParams.get("c") ?? "";
  const s = url.searchParams.get("s") ?? "";
  const campaign = url.searchParams.get("campaign");

  let ok = false;
  try {
    ok = await optOut(c, s, campaign);
  } catch {
    return htmlPage("Erro", "Não foi possível processar seu descadastro agora. Tente novamente mais tarde.");
  }
  return ok
    ? htmlPage("Descadastrado", "Pronto! Você não vai mais receber nossas campanhas de e-mail.")
    : htmlPage("Link inválido", "Este link de descadastro não é válido.");
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const c = url.searchParams.get("c") ?? "";
  const s = url.searchParams.get("s") ?? "";
  const campaign = url.searchParams.get("campaign");
  try {
    const ok = await optOut(c, s, campaign);
    return new Response(null, { status: ok ? 200 : 400 });
  } catch {
    return new Response(null, { status: 500 });
  }
}

function htmlPage(title: string, message: string): Response {
  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · ${brand.name}</title>
  </head>
  <body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f1f5f9;">
    <div style="max-width:460px;margin:12vh auto;background:#fff;border-radius:16px;padding:40px 32px;text-align:center;box-shadow:0 1px 3px rgba(15,23,42,.08);">
      <div style="width:40px;height:40px;background:#6366f1;border-radius:11px;color:#fff;font-size:20px;font-weight:800;line-height:40px;margin:0 auto 20px;">${brand.shortName[0]}</div>
      <h1 style="margin:0 0 10px;font-size:20px;color:#0f172a;">${title}</h1>
      <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">${message}</p>
      <p style="margin:24px 0 0;color:#94a3b8;font-size:11px;">${brand.name} · ${brand.tagline}</p>
    </div>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
