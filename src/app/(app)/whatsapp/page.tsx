"use client";

import { useState } from "react";
import { ChannelsTable } from "@/components/whatsapp/channels-table";
import { CreateChannelDialog } from "@/components/whatsapp/create-channel-dialog";
import { TemplatesTab } from "@/components/whatsapp/templates-tab";
import { TemplateLogsTab } from "@/components/whatsapp/template-logs-tab";
import { BotsManager } from "@/components/whatsapp/bots-manager";

type Tab = "canais" | "templates" | "logs" | "bot";
const TABS: [Tab, string][] = [
  ["canais", "Canais"],
  ["templates", "Templates"],
  ["logs", "Logs"],
  ["bot", "Bot"],
];

export default function WhatsappPage() {
  const [tab, setTab] = useState<Tab>("canais");
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">WhatsApp</h1>
          <p className="text-xs text-slate-500">
            Canais, templates da Meta e rastreio de entrega.
          </p>
        </div>
        {tab === "canais" && <CreateChannelDialog />}
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium ${
              tab === key
                ? "border-indigo-500 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "canais" && <ChannelsTable />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "logs" && <TemplateLogsTab />}
      {tab === "bot" && <BotsManager />}
    </div>
  );
}
