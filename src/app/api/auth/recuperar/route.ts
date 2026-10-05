import { createAdminClient } from "@/lib/supabase/admin";
import { appOrigin, enviarRedefinicao } from "@/lib/auth/recovery";

/**
 * "Esqueci minha senha" — rota PÚBLICA (a pessoa não tem sessão).
 * Liberada em `lib/supabase/proxy.ts` (prefixo `/api/auth/`).
 *
 * ⚠️ Responde SEMPRE a mesma coisa, exista o e-mail ou não: dizer "e-mail não
 * encontrado" transformaria a tela de login numa forma de descobrir quem tem
 * conta no CRM.
 *
 * Trava de 60 s por e-mail, em memória: impede que alguém dispare dezenas de
 * e-mails para a caixa de um colega com um laço. É por instância (serverless),
 * então é atrito, não garantia.
 */
const ultimoEnvio = new Map<string, number>();
const INTERVALO_MS = 60_000;

const RESPOSTA = {
  ok: true,
  message: "Se este e-mail tiver conta no CRM, você vai receber o link em instantes.",
};

export async function POST(request: Request) {
  let email = "";
  try {
    const body = (await request.json()) as { email?: string };
    email = (body.email ?? "").trim().toLowerCase();
  } catch {
    return Response.json({ error: "Requisição inválida" }, { status: 400 });
  }
  if (!email.includes("@")) {
    return Response.json({ error: "Informe um e-mail válido" }, { status: 400 });
  }

  const agora = Date.now();
  const antes = ultimoEnvio.get(email);
  if (antes && agora - antes < INTERVALO_MS) return Response.json(RESPOSTA);
  ultimoEnvio.set(email, agora);

  try {
    const admin = createAdminClient();
    const { data: perfil } = await admin
      .from("profiles")
      .select("name")
      // ilike para ignorar maiúsculas; `_` e `%` escapados (são curinga no LIKE
      // e `_` é comum em e-mail).
      .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
      .limit(1)
      .maybeSingle();
    // Sem perfil = sem conta no CRM: não gera link nem envia nada.
    if (perfil) {
      const r = await enviarRedefinicao(email, appOrigin(request), perfil.name ?? undefined);
      if (!r.emailSent) console.warn("[recuperar] e-mail não enviado:", email, r.error);
    }
  } catch (e) {
    console.warn("[recuperar] falha:", e instanceof Error ? e.message : e);
  }
  return Response.json(RESPOSTA);
}
