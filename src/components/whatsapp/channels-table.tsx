"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MessageCircle, Pencil } from "lucide-react";
import { useWhatsappChannels, whatsappActions } from "@/lib/data/repos/db/whatsapp";
import { EmptyState } from "@/components/shared/empty-state";
import { EditChannelDialog } from "./edit-channel-dialog";

export function ChannelsTable() {
  const { channels, ready } = useWhatsappChannels();
  const [editing, setEditing] = useState<(typeof channels)[number] | null>(null);

  if (ready && channels.length === 0) {
    return (
      <EmptyState
        icon={MessageCircle}
        title="Nenhum canal de atendimento"
        description="Cadastre um número do WhatsApp Business (Meta Cloud API) para começar a atender."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-xs">
        <thead className="border-b bg-slate-50 text-left text-slate-500">
          <tr>
            {["Canal", "Nome na Meta", "Número", "Status", "Setor", "Limite diário", "Bot", "Coexistência", "Criado em", "Ações"].map(
              (h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {channels.map((c) => (
            <tr key={c.id} className="border-b last:border-0">
              <td className="px-3 py-2 font-semibold text-slate-800">{c.name}</td>
              <td className="px-3 py-2 text-slate-600">{c.metaName || "—"}</td>
              <td className="px-3 py-2 text-slate-600">{c.phoneE164 || "—"}</td>
              <td className="px-3 py-2">
                <button
                  onClick={() => whatsappActions.toggleActive(c.id, !c.active)}
                  className={
                    c.active
                      ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
                      : "rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500"
                  }
                >
                  {c.active ? "Ativo" : "Inativo"}
                </button>
              </td>
              <td className="px-3 py-2 text-slate-600">{c.sector || "—"}</td>
              <td className="px-3 py-2 text-slate-600">{c.dailyLimit}</td>
              <td className="px-3 py-2 text-slate-400">—</td>
              <td className="px-3 py-2 text-slate-400">—</td>
              <td className="px-3 py-2 text-slate-500">
                {format(new Date(c.createdAt), "d MMM yyyy", { locale: ptBR })}
              </td>
              <td className="px-3 py-2">
                <button
                  onClick={() => setEditing(c)}
                  title="Editar nome e setor"
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50"
                >
                  <Pencil className="size-3" /> Editar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <EditChannelDialog
        channel={editing}
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
      />
    </div>
  );
}
