import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SessionManager } from "@/components/layout/session-manager";
import { Reminders } from "@/components/calendar/reminders";
import { ConfirmProvider } from "@/components/shared/confirm";
import { RouteRevalidator } from "@/components/layout/route-revalidator";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    // ConfirmProvider no shell: o diálogo de confirmação é um só para o app
    // inteiro, e qualquer tela pode pedir sem montar diálogo próprio.
    <ConfirmProvider>
    <div className="flex h-screen overflow-hidden">
      <SessionManager />
      {/* Relê os dados da tela ao trocar de página: as stores carregam uma vez
          por sessão, e o bot escreve no banco sem o usuário estar olhando. */}
      <RouteRevalidator />
      {/* Lembrete de compromisso (0042): fica no shell para avisar em qualquer
          tela — um aviso que só aparece com o Calendário aberto não serviria. */}
      <Reminders />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50">{children}</main>
      </div>
    </div>
    </ConfirmProvider>
  );
}
