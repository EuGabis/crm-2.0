"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const GROUPS: { title: string; items: { label: string; href?: string }[] }[] = [
  {
    title: "Minha Empresa",
    items: [
      { label: "Perfil da empresa", href: "/configuracoes/perfil" },
      { label: "Meu perfil", href: "/configuracoes/meu-perfil" },
      { label: "Departamentos", href: "/configuracoes/departamentos" },
      { label: "Leads & Pipelines", href: "/configuracoes/leads-pipelines" },
    ],
  },
  {
    title: "Empresariais",
    items: [
      { label: "Calendários", href: "/configuracoes/calendarios" },
      { label: "Serviços de e-mail", href: "/configuracoes/email" },
      { label: "WhatsApp", href: "/configuracoes/whatsapp" },
    ],
  },
  {
    title: "Configurações",
    items: [
      { label: "Objetos", href: "/configuracoes/objetos" },
      { label: "Campos personalizados", href: "/configuracoes/campos" },
      { label: "Valores personalizados", href: "/configuracoes/valores" },
      { label: "Importar dados", href: "/configuracoes/importar" },
      { label: "Pontuação de leads", href: "/configuracoes/pontuacao" },
      { label: "Domínios e redirecionamentos", href: "/configuracoes/dominios" },
      { label: "Integrações", href: "/configuracoes/integracoes" },
    ],
  },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-full">
      <aside className="w-60 shrink-0 border-r bg-white p-4">
        <Link
          href="/dashboard"
          className="mb-3 flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-4">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              {g.title}
            </p>
            <ul className="space-y-0.5">
              {g.items.map((item) =>
                item.href ? (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className={cn(
                        "block rounded-md px-2 py-1.5 text-xs font-medium",
                        pathname === item.href
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                ) : (
                  <li
                    key={item.label}
                    title="Em construção"
                    className="cursor-not-allowed rounded-md px-2 py-1.5 text-xs text-slate-400"
                  >
                    {item.label}
                  </li>
                )
              )}
            </ul>
          </div>
        ))}
      </aside>
      <div className="min-w-0 flex-1 p-6">{children}</div>
    </div>
  );
}
