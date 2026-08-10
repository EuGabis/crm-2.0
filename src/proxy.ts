import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Tudo, exceto assets estáticos e imagens — inclui /login e todas as rotas do app.
  // `api/automations` e `api/marketing` ficam de fora: são chamadas máquina-a-máquina
  // (pg_cron) ou públicas verificadas (webhook/unsubscribe), sem sessão de usuário — as
  // próprias rotas validam o segredo/assinatura. As rotas autenticadas de marketing
  // (send/test) fazem seu próprio getUser().
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/automations|api/marketing|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
