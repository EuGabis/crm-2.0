import { createClient } from "@/lib/supabase/server";
import { providerConfig, redirectUri } from "@/lib/integrations/media-oauth";

export const dynamic = "force-dynamic";

/**
 * O que ainda falta configurar para Drive/Canva funcionarem, do ponto de vista
 * do SERVIDOR. Existe porque os dois erros de estreia — `redirect_uri_mismatch`
 * no Google e "Canva não configurado" — só se resolvem sabendo (a) qual URI
 * cadastrar no provedor e (b) qual env está faltando. Nada disso é adivinhável
 * pela tela.
 *
 * Devolve presença/ausência do SECRET (booleano, nunca o valor) e o
 * `client_id`. O client id não é segredo — ele viaja na querystring da URL de
 * consentimento, visível na barra do navegador — e é o que resolve a dúvida
 * "cadastrei a URI, mas em qual dos clients do projeto?".
 *
 * Restrito a admin: é informação de configuração da empresa.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { data: membership } = await supabase
    .from("location_members")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership?.role !== "admin") {
    return Response.json({ error: "Apenas administradores" }, { status: 403 });
  }

  const drive = providerConfig("google_drive");
  const canva = providerConfig("canva");
  return Response.json({
    redirectUri: redirectUri(),
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
    google_drive: {
      configured: !!drive.clientId && !!drive.clientSecret,
      clientId: drive.clientId || null,
    },
    canva: {
      configured: !!canva.clientId && !!canva.clientSecret,
      clientId: canva.clientId || null,
    },
  });
}
