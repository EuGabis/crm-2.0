"use client";

import { WebphonePanel } from "@/components/layout/webphone-panel";

export default function TelefoniaPage() {
  return (
    <div className="max-w-xl">
      <h1 className="text-lg font-bold text-slate-900">Sistema telefônico</h1>
      <p className="mb-5 text-xs text-slate-500">
        Ligações VoIP direto do CRM. Enquanto não houver provedor de voz conectado, o
        botão verde abre o discador do próprio aparelho.
      </p>
      <div className="w-fit rounded-xl border bg-white">
        <WebphonePanel />
      </div>
    </div>
  );
}
