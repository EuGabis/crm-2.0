"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsUpDown, Plus, Search } from "lucide-react";
import { brand } from "@/lib/config/brand";
import { NAV_ITEMS, SETTINGS_ITEM, type NavItem } from "@/lib/config/nav";
import { useAccount } from "@/lib/data/repos/db/account";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { cn } from "@/lib/utils";

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium text-slate-300 transition-colors",
        active
          ? "bg-[var(--lito-sidebar-accent)] text-white"
          : "hover:bg-[var(--lito-sidebar-hover)] hover:text-white"
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
      {item.badge && (
        <span className="ml-auto rounded bg-amber-400/90 px-1.5 py-px text-[10px] font-bold text-amber-950">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { can } = useMyMembership();
  const { company } = useAccount();
  return (
    <aside className="flex h-screen w-[240px] shrink-0 flex-col bg-[var(--lito-sidebar)]">
      <div className="px-4 pt-4">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center overflow-hidden rounded-lg bg-[var(--lito-sidebar-accent)] text-sm font-black text-white">
            {company?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoUrl} alt="Logo" className="size-full object-cover" />
            ) : (
              brand.shortName[0]
            )}
          </div>
          <span className="text-[15px] font-bold text-white">{brand.name}</span>
        </div>
        <Link
          href="/configuracoes/perfil"
          title="Perfil da empresa"
          className="mt-3 flex w-full items-center justify-between rounded-lg bg-[var(--lito-sidebar-hover)] px-3 py-2 text-left"
        >
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-white">
              {company?.name ?? "Minha empresa"}
            </span>
            <span className="block truncate text-[10px] text-slate-400">
              {company?.city || "Definir localização"}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-slate-400" />
        </Link>
        <div className="mt-2 flex items-center gap-1.5">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-slate-700 px-2.5 py-1.5">
            <Search className="size-3.5 text-slate-500" />
            <span className="flex-1 text-xs text-slate-500">Pesquisar</span>
            <kbd className="rounded bg-slate-700 px-1 text-[10px] text-slate-300">Ctrl K</kbd>
          </div>
          <button className="flex size-7 items-center justify-center rounded-md bg-emerald-500 text-white">
            <Plus className="size-4" />
          </button>
        </div>
      </div>
      <nav className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">
        <NavLink item={NAV_ITEMS[0]} active={pathname.startsWith(NAV_ITEMS[0].href)} />
        <div className="mx-2 my-2 border-t border-slate-700/60" />
        {NAV_ITEMS.slice(1)
          .filter((item) => can(item.key))
          .map((item) => (
            <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
          ))}
      </nav>
      <div className="border-t border-slate-700/60 p-2">
        <NavLink item={SETTINGS_ITEM} active={pathname.startsWith(SETTINGS_ITEM.href)} />
      </div>
    </aside>
  );
}
