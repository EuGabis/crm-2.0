"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { brand } from "@/lib/config/brand";
import { NAV_ITEMS, SETTINGS_ITEM, type NavItem } from "@/lib/config/nav";
import { useAccount } from "@/lib/data/repos/db/account";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { cn } from "@/lib/utils";

/**
 * Sidebar com modo minimizado.
 *
 * A escolha fica no `localStorage`, como as outras preferências de tela do CRM:
 * é por DISPOSITIVO. Quem trabalha o dia todo no notebook de 13" quer a barra
 * fechada; no monitor grande, aberta — guardar "na conta" imporia a mesma
 * decisão nos dois.
 *
 * Fechada, os rótulos saem e sobram os ícones, com o nome no tooltip. Não é
 * `w-0`: sumir com a navegação inteira obrigaria a reabrir para trocar de
 * módulo, que é o oposto do ganho pretendido.
 */

const STORAGE_KEY = "lito.sidebar.collapsed";

/**
 * A preferência é estado EXTERNO ao React (localStorage), então é lida por
 * `useSyncExternalStore` em vez de `useState` + efeito:
 *   * o servidor não tem localStorage — o snapshot do servidor é "aberta", e o
 *     React reconcilia na hidratação sem o aviso de mismatch;
 *   * ler no efeito e chamar `setState` dispara renderização em cascata (a
 *     regra react-hooks/set-state-in-effect existe por isso);
 *   * de graça, o evento `storage` sincroniza DUAS ABAS do CRM: minimizar numa
 *     minimiza na outra.
 * O evento nativo não dispara na aba que escreveu, daí o conjunto de ouvintes.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

const isCollapsed = () => window.localStorage.getItem(STORAGE_KEY) === "1";

function setCollapsedPref(next: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // localStorage bloqueado — volta ao padrão no F5, nada quebra.
  }
  listeners.forEach((l) => l());
}

function NavLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      // `title` some quando há tooltip para não aparecerem os dois.
      title={collapsed ? undefined : item.label}
      className={cn(
        "flex items-center rounded-md py-[7px] text-[13px] font-medium text-slate-300 transition-colors",
        collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
        active
          ? "bg-[var(--lito-sidebar-accent)] text-white"
          : "hover:bg-[var(--lito-sidebar-hover)] hover:text-white"
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate">{item.label}</span>
          {item.badge && (
            <span className="ml-auto rounded bg-amber-400/90 px-1.5 py-px text-[10px] font-bold text-amber-950">
              {item.badge}
            </span>
          )}
        </>
      )}
    </Link>
  );

  if (!collapsed) return link;
  // Fechada, o nome vira tooltip — sem isso a barra viraria adivinhação de ícone.
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" className="text-[11px]">
        {item.label}
        {item.badge ? ` · ${item.badge}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { can } = useMyMembership();
  const { company } = useAccount();
  const collapsed = useSyncExternalStore(subscribe, isCollapsed, () => false);
  const toggle = () => setCollapsedPref(!collapsed);

  const items = NAV_ITEMS.slice(1).filter((item) => can(item.key));

  return (
    <aside
      className={cn(
        "flex h-screen shrink-0 flex-col bg-[var(--lito-sidebar)] transition-[width] duration-200",
        collapsed ? "w-[64px]" : "w-[240px]"
      )}
    >
      <div className={cn("pt-4", collapsed ? "px-2" : "px-4")}>
        {/* Um só bloco de "workspace": logo + nome da empresa + cidade. Antes eram
            dois blocos empilhados (logo+produto e depois a empresa), o que ficava
            redundante e apertado. */}
        <Link
          href="/configuracoes/perfil"
          title={collapsed ? (company?.name ?? "Perfil da empresa") : "Perfil da empresa"}
          className={cn(
            "flex w-full items-center rounded-lg py-2 text-left transition-colors hover:bg-[var(--lito-sidebar-hover)]",
            collapsed ? "justify-center px-0" : "gap-2.5 px-2"
          )}
        >
          <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--lito-sidebar-accent)] text-sm font-black text-white">
            {company?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoUrl} alt="Logo da empresa" className="size-full object-cover" />
            ) : (
              (company?.name?.[0] ?? brand.shortName[0]).toUpperCase()
            )}
          </div>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold leading-tight text-white">
                  {company?.name ?? "Minha empresa"}
                </span>
                <span className="block truncate text-[10px] leading-tight text-slate-400">
                  {company?.city || "Definir localização"}
                </span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-slate-400" />
            </>
          )}
        </Link>
      </div>

      <nav
        className={cn(
          "mt-3 flex-1 space-y-0.5 overflow-y-auto pb-2 [scrollbar-width:thin]",
          collapsed ? "px-2" : "px-2"
        )}
      >
        <NavLink
          item={NAV_ITEMS[0]}
          active={pathname.startsWith(NAV_ITEMS[0].href)}
          collapsed={collapsed}
        />
        <div className="mx-2 my-2 border-t border-slate-700/60" />
        {items.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={pathname.startsWith(item.href)}
            collapsed={collapsed}
          />
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-slate-700/60 p-2">
        <NavLink
          item={SETTINGS_ITEM}
          active={pathname.startsWith(SETTINGS_ITEM.href)}
          collapsed={collapsed}
        />
        {/* O botão fica no PÉ da barra, junto de Configurações: é ajuste de tela,
            não navegação — no topo competiria com o bloco da empresa. */}
        <button
          onClick={toggle}
          title={collapsed ? "Expandir menu" : "Minimizar menu"}
          aria-label={collapsed ? "Expandir menu" : "Minimizar menu"}
          className={cn(
            "flex w-full items-center rounded-md py-[7px] text-[13px] font-medium text-slate-400 transition-colors hover:bg-[var(--lito-sidebar-hover)] hover:text-white",
            collapsed ? "justify-center px-0" : "gap-2.5 px-2.5"
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4 shrink-0" />
          ) : (
            <PanelLeftClose className="size-4 shrink-0" />
          )}
          {!collapsed && <span className="truncate">Minimizar menu</span>}
        </button>
      </div>
    </aside>
  );
}
