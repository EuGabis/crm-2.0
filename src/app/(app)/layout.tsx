import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SessionManager } from "@/components/layout/session-manager";
import { Reminders } from "@/components/calendar/reminders";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <SessionManager />
      {/* Lembrete de compromisso (0042): fica no shell para avisar em qualquer
          tela — um aviso que só aparece com o Calendário aberto não serviria. */}
      <Reminders />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50">{children}</main>
      </div>
    </div>
  );
}
