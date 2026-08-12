import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Tudo, exceto assets estáticos e imagens — inclui /login e todas as rotas do app.
  // `api/automations`, `api/whatsapp`, `api/forms`, `api/webhooks`,
  // `api/integrations` e `api/marketing` ficam de fora: são chamadas
  // máquina-a-máquina (pg_cron e provedores externos como a Guru, o Resend e a
  // Meta) ou públicas verificadas (webhook/unsubscribe/envio de formulário),
  // sem sessão de usuário — cada rota valida sua própria credencial
  // (x-automation-secret, o token da Guru, x-guru-sync-secret, assinatura Svix
  // ou a assinatura HMAC da Meta no webhook do WhatsApp). As rotas autenticadas
  // de marketing (send/test) fazem seu próprio getUser().
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/automations|api/whatsapp|api/forms|api/webhooks|api/integrations|api/marketing|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
