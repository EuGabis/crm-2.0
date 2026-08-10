"use client";

import { useEffect, useState } from "react";
import { Bell, Headset, LifeBuoy, LogOut, Phone } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";
import { SupportPanel } from "./support-panel";
import { WebphonePanel } from "./webphone-panel";

export function Topbar() {
  const [supportOpen, setSupportOpen] = useState(false);
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
    // Navegação dura: força o middleware a reavaliar já com o cookie limpo.
    window.location.href = "/login";
  };

  return (
    <header className="flex h-12 shrink-0 items-center justify-end gap-2 border-b bg-[#0d1117] px-4">
      <button
        onClick={() => setSupportOpen(true)}
        className="flex items-center gap-1.5 rounded-full bg-lime-400 px-3 py-1 text-xs font-bold text-lime-950 hover:bg-lime-300"
      >
        <LifeBuoy className="size-3.5" />
        Suporte
      </button>
      <Popover>
        <PopoverTrigger
          render={
            <button className="flex items-center gap-1.5 rounded-full bg-slate-700 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-600" />
          }
        >
          <Headset className="size-3.5" />
          Webphone
        </PopoverTrigger>
        <PopoverContent align="end" className="p-0">
          <WebphonePanel />
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger
          render={
            <button className="flex size-7 items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-400" />
          }
        >
          <Phone className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent align="end" className="p-0">
          <WebphonePanel />
        </PopoverContent>
      </Popover>
      <button
        onClick={() => toast.info("Central de notificações chega em breve")}
        className="relative flex size-7 items-center justify-center rounded-full text-slate-300 hover:bg-slate-700"
      >
        <Bell className="size-4" />
        <span className="absolute right-1 top-1 size-1.5 rounded-full bg-orange-400" />
      </button>
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
      <SupportPanel open={supportOpen} onOpenChange={setSupportOpen} />
    </header>
  );
}
