"use client";

import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { clearBrowserSession } from "@/lib/auth/session-marker";
import { NotificationsPanel } from "./notifications-panel";

/**
 * Suporte, Webphone e o botão verde de ligar SAÍRAM da barra superior
 * (2026-08-24, a pedido do Gabriel): eram os três primeiros elementos da tela e
 * nenhum dos três fazia o que prometia — o Suporte abria um painel de contato
 * que não abre ticket, e o webphone não completa chamada (não há provedor de
 * voz; o botão verde só reabria o MESMO painel do Webphone).
 *
 * O painel do webphone continua existindo em Configurações → Telefonia, que é
 * onde ele volta a ser oferecido no dia em que houver VoIP de verdade. Quem
 * dependia do popover da topbar para ligar — o card do funil e o cabeçalho da
 * conversa — passou a abrir o discador do aparelho (`tel:`), que é o caminho
 * que de fato completa a ligação hoje.
 */
export function Topbar() {
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
  }, []);

  const signOut = async () => {
    const supabase = createClient();
    // Escopo "local": limpa a sessão/cookie deste dispositivo na hora, sem depender
    // de uma chamada de rede que poderia falhar e travar o logout. O try/catch garante
    // que, mesmo se algo der errado, ainda saímos para o /login.
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // ignora — segue para o login de qualquer forma
    }
    clearBrowserSession(); // some com o marcador de sessão do navegador também
    // Navegação dura: força o middleware a reavaliar já com o cookie limpo.
    window.location.href = "/login";
  };

  return (
    <header className="flex h-12 shrink-0 items-center justify-end gap-2 border-b bg-[#0d1117] px-4">
      {/* O sino agora abre a central de verdade (avisos derivados de conversas,
          agenda e agendamentos que falharam), no lugar do toast "chega em breve". */}
      <NotificationsPanel />
      <DropdownMenu>
        <DropdownMenuTrigger render={<button className="rounded-full" />}>
          <Avatar className="size-7">
            <AvatarFallback className="bg-indigo-500 text-[11px] font-bold text-white">
              {(userEmail?.[0] ?? "?").toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate text-xs font-normal text-slate-500">
            {userEmail ?? "Carregando..."}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>
            <LogOut className="size-4" /> Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
