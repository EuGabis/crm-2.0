"use client";

import { useEffect, useState } from "react";
import { LogOut, Minus, Moon, Plus, SunMedium } from "lucide-react";
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
import { clearBrowserSession } from "@/lib/auth/session-marker";
import {
  FONT_SIZES,
  getFontPx,
  getTheme,
  setFontPx,
  setTheme,
  type ThemePref,
} from "@/lib/ui/prefs";
import { NotificationsPanel } from "./notifications-panel";

/**
 * Suporte e o botão verde de ligar SAÍRAM da barra superior
 * (2026-08-24): nenhum dos três fazia o que prometia. Sobraram a aparência
 * (tema/fonte), a central de avisos e o menu do usuário.
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
      <AppearancePopover />
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

/** Controle de aparência: tema claro/escuro + tamanho da fonte (por usuário). */
function AppearancePopover() {
  const [theme, setThemeState] = useState<ThemePref>("light");
  const [fontPx, setFontState] = useState<number>(16);

  useEffect(() => {
    setThemeState(getTheme());
    setFontState(getFontPx());
  }, []);

  const changeTheme = (t: ThemePref) => {
    setTheme(t);
    setThemeState(t);
  };
  const stepFont = (dir: 1 | -1) => {
    const idx = FONT_SIZES.indexOf(fontPx);
    const next = FONT_SIZES[Math.min(FONT_SIZES.length - 1, Math.max(0, idx + dir))];
    setFontPx(next);
    setFontState(next);
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            title="Aparência (tema e fonte)"
            className="flex size-7 items-center justify-center rounded-full bg-slate-700 text-white hover:bg-slate-600"
          />
        }
      >
        {theme === "dark" ? <Moon className="size-3.5" /> : <SunMedium className="size-3.5" />}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Tema</p>
        <div className="mb-3 grid grid-cols-2 gap-1.5">
          <button
            onClick={() => changeTheme("light")}
            className={`flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-medium ${
              theme === "light" ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "text-slate-600"
            }`}
          >
            <SunMedium className="size-3.5" /> Claro
          </button>
          <button
            onClick={() => changeTheme("dark")}
            className={`flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-medium ${
              theme === "dark" ? "border-indigo-400 bg-indigo-50 text-indigo-700" : "text-slate-600"
            }`}
          >
            <Moon className="size-3.5" /> Escuro
          </button>
        </div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          Tamanho da fonte
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => stepFont(-1)}
            disabled={fontPx <= FONT_SIZES[0]}
            className="flex size-8 items-center justify-center rounded-lg border text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <Minus className="size-4" />
          </button>
          <div className="flex-1 text-center">
            <span className="text-sm font-bold text-slate-800">Aa</span>
            <span className="ml-1 text-[10px] text-slate-400">{fontPx}px</span>
          </div>
          <button
            onClick={() => stepFont(1)}
            disabled={fontPx >= FONT_SIZES[FONT_SIZES.length - 1]}
            className="flex size-8 items-center justify-center rounded-lg border text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
