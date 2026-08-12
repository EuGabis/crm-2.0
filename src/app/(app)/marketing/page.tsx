"use client";

import { useState } from "react";
import { SubNav } from "@/components/layout/subnav";
import { CampaignsTab } from "@/components/marketing/campaigns-tab";
import { TrechosTab } from "@/components/marketing/trechos-tab";
import { CountdownsTab } from "@/components/marketing/countdowns-tab";
import { BrandBoardsTab } from "@/components/marketing/brand-boards-tab";

const TABS = [
  { label: "E-mails" },
  { label: "Trechos" },
  { label: "Contadores regressivos" },
  { label: "Brand Boards" },
];

export default function MarketingPage() {
  const [tab, setTab] = useState("E-mails");

  return (
    <div>
      <SubNav tabs={TABS} active={tab} onChange={setTab} />
      <div className="p-6">
        {tab === "E-mails" && <CampaignsTab />}
        {tab === "Trechos" && <TrechosTab />}
        {tab === "Contadores regressivos" && <CountdownsTab />}
        {tab === "Brand Boards" && <BrandBoardsTab />}
      </div>
    </div>
  );
}
