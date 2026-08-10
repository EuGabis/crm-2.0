"use client";

import { useState, type ReactNode } from "react";
import {
  CheckCircle2,
  FileSpreadsheet,
  Hash,
  LayoutTemplate,
  Music2,
  Plus,
  Repeat,
  Rss,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { SubNav } from "@/components/layout/subnav";
import { CampaignsTab } from "@/components/marketing/campaigns-tab";
import { KpiCard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Planejador Social" },
  { label: "E-mails" },
  { label: "Trechos" },
  { label: "Contadores regressivos" },
  { label: "Links de acionamento" },
  { label: "Afiliados" },
  { label: "Brand Boards" },
  { label: "Gerenciador de anúncios" },
];

const INNER_TABS = ["Planejador", "Conteúdo", "Comentários", "Estatísticas", "Escuta social", "Configurações"];

const NETWORKS = [
  "Facebook",
  "Instagram",
  "Google Business Profile",
  "LinkedIn",
  "TikTok",
  "YouTube",
  "Pinterest",
  "Threads",
  "Bluesky",
  "Comunidade",
];

const POSTS = [
  { caption: 'Comente "AUTOMACAO" e receba 70% de desconto na assinatura', status: "Publicado", type: "Compositor", date: "21 jun 2026 10:00", network: "Instagram" },
  { caption: "5 sinais de que sua empresa precisa de um CRM", status: "Publicado", type: "Compositor", date: "28 jun 2026 09:00", network: "Facebook" },
  { caption: "Bastidores: como automatizamos 80% do follow-up", status: "Rascunho", type: "Nativa", date: "5 jul 2026 14:00", network: "Instagram" },
  { caption: "Case: +40% de conversão com pipeline automatizado", status: "Publicado", type: "Compositor", date: "12 jul 2026 11:00", network: "LinkedIn" },
  { caption: "Novidade: agente de IA no atendimento", status: "Rascunho", type: "Compositor", date: "1 ago 2026 16:00", network: "Instagram" },
];

const CONTENT_SOURCES = [
  { label: "CSV", icon: FileSpreadsheet },
  { label: "Recorrente", icon: Repeat },
  { label: "RSS", icon: Rss },
  { label: "Biblioteca de modelos", icon: LayoutTemplate },
  { label: "Aprovação", icon: CheckCircle2 },
];

const CONTENT_BATCHES = [
  { name: "Lote julho — Dicas de CRM", format: "CSV", posts: 12, status: "Importado", updated: "10 jul 2026" },
  { name: "Depoimentos de clientes", format: "Recorrente", posts: 8, status: "Ativo", updated: "3 jul 2026" },
  { name: "Blog Lito — feed RSS", format: "RSS", posts: 20, status: "Aguardando aprovação", updated: "1 ago 2026" },
];

const COMMENTS = [
  { network: "Instagram", author: "@mari.empreende", text: "AUTOMACAO! Quero o desconto 🙌", post: 'Comente "AUTOMACAO" e receba 70%...' },
  { network: "Facebook", author: "Ricardo Nunes", text: "Vocês têm integração com WhatsApp?", post: "5 sinais de que sua empresa precisa de um CRM" },
  { network: "Instagram", author: "@studio.dandara", text: "Uso há 3 meses e o follow-up nunca mais atrasou.", post: "Bastidores: como automatizamos 80% do follow-up" },
  { network: "Facebook", author: "Paula Andrade", text: "Qual o valor do plano pra 5 usuários?", post: 'Comente "AUTOMACAO" e receba 70%...' },
  { network: "Instagram", author: "@consultoria.vega", text: "O agente de IA responde fora do horário comercial?", post: "Novidade: agente de IA no atendimento" },
];

const NETWORK_STATS = [
  { network: "Instagram", posts: 14, reach: "48,2 mil", engagement: "6,8%" },
  { network: "Facebook", posts: 10, reach: "22,4 mil", engagement: "3,1%" },
  { network: "LinkedIn", posts: 6, reach: "9,7 mil", engagement: "5,2%" },
  { network: "TikTok", posts: 4, reach: "31,5 mil", engagement: "9,4%" },
];

const GOOGLE_TRENDS = [
  { term: "crm para pequenas empresas", volume: "+180%" },
  { term: "automação de whatsapp", volume: "+140%" },
  { term: "funil de vendas", volume: "+95%" },
  { term: "agente de ia atendimento", volume: "+80%" },
  { term: "email marketing gratuito", volume: "+45%" },
];

const TIKTOK_TAGS = [
  { tag: "#empreendedorismo", volume: "2,4 bi" },
  { tag: "#marketingdigital", volume: "1,8 bi" },
  { tag: "#vendas", volume: "940 mi" },
  { tag: "#pequenasempresas", volume: "610 mi" },
  { tag: "#automacao", volume: "220 mi" },
];

const TIKTOK_SONGS = [
  { title: "Funk do Verão 2026 — DJ Kaio", uses: "1,2 mi vídeos" },
  { title: "Aesthetic Morning — Lo-fi Brasil", uses: "840 mil vídeos" },
  { title: "Pagode do Escritório — Grupo Sintonia", uses: "512 mil vídeos" },
];

const SNIPPETS = [
  { name: "Assinatura padrão", content: "Equipe Lito — Seu negócio inteiro em um lugar. Responda este e-mail para falar com a gente.", uses: 132 },
  { name: "CTA teste grátis", content: "Comece seu teste grátis de 14 dias — sem cartão de crédito: litocrm.com.br/teste", uses: 87 },
  { name: "Prova social", content: "Mais de 1.200 empresas brasileiras já automatizam o follow-up com a gente.", uses: 54 },
  { name: "Aviso de reunião", content: "Sua reunião está confirmada. Chegando perto do horário, enviaremos o link por WhatsApp.", uses: 41 },
];

const COUNTDOWNS = [
  { name: "Oferta 70% OFF", ends: "12 ago 2026 23:59", status: "Ativo", preview: "05d 14h 22m" },
  { name: "Black Friday antecipada", ends: "20 nov 2026 23:59", status: "Ativo", preview: "105d 09h 10m" },
  { name: "Turma de julho — Mentoria", ends: "30 jun 2026 20:00", status: "Expirado", preview: "00d 00h 00m" },
];

const TRIGGER_LINKS = [
  { name: "Teste grátis — bio Instagram", url: "lito.link/teste-gratis", clicks: 1842, automation: "Onboarding de trial" },
  { name: "Agendar demonstração", url: "lito.link/demo", clicks: 976, automation: "Agenda + lembrete WhatsApp" },
  { name: "Baixar e-book CRM", url: "lito.link/ebook-crm", clicks: 654, automation: "Nutrição de leads" },
  { name: "Oferta 70% OFF", url: "lito.link/oferta70", clicks: 2310, automation: "Checkout com desconto" },
];

const AFFILIATES = [
  { name: "Marina Prado", sales: 32, commission: 4160, status: "Ativo" },
  { name: "Canal Vende Mais", sales: 21, commission: 2730, status: "Ativo" },
  { name: "João Bertolini", sales: 12, commission: 1560, status: "Pendente" },
  { name: "Agência Norte Digital", sales: 7, commission: 910, status: "Ativo" },
];

const BRAND_BOARDS = [
  { name: "Lito — Principal", palette: ["#4f46e5", "#0f172a", "#10b981", "#f8fafc"], font: "Inter" },
  { name: "Campanha 70% OFF", palette: ["#dc2626", "#f59e0b", "#111827", "#fef2f2"], font: "Poppins" },
];

const AD_CAMPAIGNS = [
  { name: "[Frio] Vídeo — Dor do follow-up", status: "Ativo", budget: 150, results: 214, cpl: 11.2 },
  { name: "[Frio] Carrossel — 5 sinais", status: "Ativo", budget: 100, results: 122, cpl: 15.8 },
  { name: "[Remarketing] Depoimentos", status: "Ativo", budget: 80, results: 96, cpl: 9.4 },
  { name: "[Teste] Oferta 70% OFF", status: "Pausado", results: 41, budget: 60, cpl: 21.3 },
];

const GOOD_STATUSES = ["Publicado", "Enviada", "Ativo", "Importado", "Pago"];

function StatusBadge({ value }: { value: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(GOOD_STATUSES.includes(value) && "bg-emerald-100 text-emerald-700")}
    >
      {value}
    </Badge>
  );
}

function MiniTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b text-[11px] text-slate-400">
            {headers.map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b last:border-0">
              {cells.map((c, j) => (
                <td
                  key={j}
                  className={cn("px-4 py-2.5", j === 0 ? "font-medium text-slate-800" : "text-slate-500")}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MarketingPage() {
  const [tab, setTab] = useState("Planejador Social");
  const [innerTab, setInnerTab] = useState("Planejador");
  const [connectOpen, setConnectOpen] = useState(false);
  const [contentSource, setContentSource] = useState("CSV");
  const [approvalRequired, setApprovalRequired] = useState(true);
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [signature, setSignature] = useState("#LitoCRM — Seu negócio inteiro em um lugar");

  const timezoneLabels: Record<string, string> = {
    "America/Sao_Paulo": "Brasília (GMT-3)",
    "America/Manaus": "Manaus (GMT-4)",
    "America/Rio_Branco": "Rio Branco (GMT-5)",
    "America/Noronha": "Fernando de Noronha (GMT-2)",
  };

  return (
    <div>
      <SubNav tabs={TABS} active={tab} onChange={setTab} />
      <div className="p-6">
        {tab === "Planejador Social" && (
          <>
            <div className="mb-3 flex items-center justify-between">
              <h1 className="text-lg font-bold text-slate-900">Planejador Social</h1>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setConnectOpen(true)}>
                  <Plus className="size-3.5" /> Redes sociais
                </Button>
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => toast.info("Compositor de publicações chega em breve")}>
                  <Plus className="size-3.5" /> Nova publicação
                </Button>
              </div>
            </div>
            <div className="mb-3 flex gap-1">
              {INNER_TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setInnerTab(t)}
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-medium",
                    innerTab === t ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            {innerTab === "Planejador" && (
              <MiniTable
                headers={["Legenda", "Status", "Tipo", "Data", "Rede"]}
                rows={POSTS.map((p) => [
                  <span key="c" className="block max-w-72 truncate">{p.caption}</span>,
                  <StatusBadge key="s" value={p.status} />,
                  p.type,
                  p.date,
                  p.network,
                ])}
              />
            )}
            {innerTab === "Conteúdo" && (
              <div className="flex gap-4">
                <div className="w-52 shrink-0 rounded-xl border bg-white p-2">
                  {CONTENT_SOURCES.map(({ label, icon: Icon }) => (
                    <button
                      key={label}
                      onClick={() => setContentSource(label)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium",
                        contentSource === label
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      <Icon className="size-3.5" /> {label}
                    </button>
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <MiniTable
                    headers={["Nome do lote", "Formato", "Nº de publicações", "Status", "Atualizado em"]}
                    rows={CONTENT_BATCHES.map((b) => [
                      b.name,
                      b.format,
                      b.posts,
                      <StatusBadge key="s" value={b.status} />,
                      b.updated,
                    ])}
                  />
                </div>
              </div>
            )}
            {innerTab === "Comentários" && (
              <div className="rounded-xl border bg-white">
                {COMMENTS.map((c, i) => (
                  <div key={i} className="flex items-start justify-between gap-4 border-b p-4 last:border-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="secondary"
                          className={cn(
                            c.network === "Instagram"
                              ? "bg-fuchsia-100 text-fuchsia-700"
                              : "bg-blue-100 text-blue-700"
                          )}
                        >
                          {c.network}
                        </Badge>
                        <span className="text-xs font-semibold text-slate-800">{c.author}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-700">{c.text}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-400">Em: {c.post}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 text-xs"
                      onClick={() => toast.info("Resposta a comentários chega com o backend")}
                    >
                      Responder
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {innerTab === "Estatísticas" && (
              <>
                <div className="mb-4 grid gap-3 md:grid-cols-4">
                  <KpiCard label="Alcance" value="111,8 mil" delta={18.4} />
                  <KpiCard label="Engajamento" value="6,2%" delta={1.1} />
                  <KpiCard label="Novos seguidores" value="2.340" delta={9.6} />
                  <KpiCard label="Cliques no link" value="4.812" delta={-3.2} />
                </div>
                <MiniTable
                  headers={["Rede", "Publicações", "Alcance", "Engajamento %"]}
                  rows={NETWORK_STATS.map((n) => [n.network, n.posts, n.reach, n.engagement])}
                />
              </>
            )}
            {innerTab === "Escuta social" && (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border bg-white p-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="size-4 text-indigo-500" />
                    <p className="text-sm font-semibold text-slate-800">Google Trends</p>
                  </div>
                  <ol className="mt-3 space-y-2">
                    {GOOGLE_TRENDS.map((t, i) => (
                      <li key={t.term} className="flex items-center justify-between text-xs">
                        <span className="text-slate-700">
                          <span className="mr-2 font-bold text-slate-400">{i + 1}</span>
                          {t.term}
                        </span>
                        <span className="font-semibold text-emerald-600">{t.volume}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="rounded-xl border bg-white p-4">
                  <div className="flex items-center gap-2">
                    <Hash className="size-4 text-indigo-500" />
                    <p className="text-sm font-semibold text-slate-800">Hashtags do TikTok</p>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {TIKTOK_TAGS.map((t) => (
                      <li key={t.tag} className="flex items-center justify-between text-xs">
                        <span className="font-medium text-indigo-600">{t.tag}</span>
                        <span className="text-slate-500">{t.volume} visualizações</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border bg-white p-4">
                  <div className="flex items-center gap-2">
                    <Music2 className="size-4 text-indigo-500" />
                    <p className="text-sm font-semibold text-slate-800">Músicas em alta no TikTok</p>
                  </div>
                  <ul className="mt-3 space-y-2.5">
                    {TIKTOK_SONGS.map((s) => (
                      <li key={s.title} className="text-xs">
                        <p className="font-medium text-slate-800">{s.title}</p>
                        <p className="text-[11px] text-slate-500">{s.uses}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            {innerTab === "Configurações" && (
              <div className="max-w-xl space-y-4 rounded-xl border bg-white p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-800">Aprovação obrigatória</p>
                    <p className="text-[11px] text-slate-500">
                      Publicações só vão ao ar depois de aprovadas por um administrador
                    </p>
                  </div>
                  <Switch checked={approvalRequired} onCheckedChange={setApprovalRequired} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Fuso de publicação</Label>
                  <Select value={timezone} onValueChange={(v) => v && setTimezone(v)}>
                    <SelectTrigger className="h-8 w-64 text-xs">
                      <SelectValue>{timezoneLabels[timezone]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(timezoneLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value} className="text-xs">
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Assinatura padrão nas legendas</Label>
                  <Input
                    value={signature}
                    onChange={(e) => setSignature(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => toast.success("Configurações salvas")}
                >
                  Salvar configurações
                </Button>
              </div>
            )}
          </>
        )}
        {tab === "E-mails" && <CampaignsTab />}
        {tab === "Trechos" && (
          <>
            <div className="mb-4">
              <h1 className="text-lg font-bold text-slate-900">Trechos</h1>
              <p className="text-xs text-slate-500">Blocos de texto reutilizáveis em e-mails, SMS e redes sociais</p>
            </div>
            <MiniTable
              headers={["Nome", "Conteúdo", "Usos"]}
              rows={SNIPPETS.map((s) => [
                s.name,
                <span key="c" className="block max-w-96 truncate">{s.content}</span>,
                s.uses,
              ])}
            />
          </>
        )}
        {tab === "Contadores regressivos" && (
          <>
            <div className="mb-4">
              <h1 className="text-lg font-bold text-slate-900">Contadores regressivos</h1>
              <p className="text-xs text-slate-500">Crie urgência em páginas e e-mails com timers dinâmicos</p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {COUNTDOWNS.map((c) => (
                <div key={c.name} className="rounded-xl border bg-white p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                    <StatusBadge value={c.status} />
                  </div>
                  <p className="mt-3 font-mono text-2xl font-bold tracking-tight text-indigo-600">
                    {c.preview}
                  </p>
                  <p className="mt-2 text-[11px] text-slate-500">Termina em {c.ends}</p>
                </div>
              ))}
            </div>
          </>
        )}
        {tab === "Links de acionamento" && (
          <>
            <div className="mb-4">
              <h1 className="text-lg font-bold text-slate-900">Links de acionamento</h1>
              <p className="text-xs text-slate-500">Links curtos que disparam automações quando clicados</p>
            </div>
            <MiniTable
              headers={["Nome", "URL", "Cliques", "Automação vinculada"]}
              rows={TRIGGER_LINKS.map((l) => [
                l.name,
                <span key="u" className="font-medium text-indigo-600">{l.url}</span>,
                l.clicks.toLocaleString("pt-BR"),
                l.automation,
              ])}
            />
          </>
        )}
        {tab === "Afiliados" && (
          <>
            <h1 className="mb-4 text-lg font-bold text-slate-900">Afiliados</h1>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <KpiCard label="Afiliados ativos" value="3" />
              <KpiCard label="Vendas via afiliados" value="72" delta={22.4} />
              <KpiCard label="Comissões a pagar" value={formatBRL(9360)} hint="Fechamento em 15 ago 2026" />
            </div>
            <MiniTable
              headers={["Afiliado", "Vendas", "Comissão", "Status"]}
              rows={AFFILIATES.map((a) => [
                a.name,
                a.sales,
                formatBRL(a.commission),
                <StatusBadge key="s" value={a.status} />,
              ])}
            />
          </>
        )}
        {tab === "Brand Boards" && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-lg font-bold text-slate-900">Brand Boards</h1>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => toast.info("Criação de marca chega com o backend")}>
                <Plus className="size-3.5" /> Nova marca
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {BRAND_BOARDS.map((b) => (
                <div key={b.name} className="rounded-xl border bg-white p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-indigo-100 text-sm font-bold text-indigo-600">
                      {b.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{b.name}</p>
                      <p className="text-[11px] text-slate-500">Fonte: {b.font}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-1.5">
                    {b.palette.map((color) => (
                      <div
                        key={color}
                        className="size-7 rounded-md border"
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {tab === "Gerenciador de anúncios" && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-lg font-bold text-slate-900">Gerenciador de anúncios</h1>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => toast.info("Criação de anúncio chega com o backend")}>
                <Plus className="size-3.5" /> Criar anúncio
              </Button>
            </div>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <KpiCard label="Investimento" value={formatBRL(12480)} hint="Últimos 30 dias" />
              <KpiCard label="Impressões" value="842 mil" delta={12.7} />
              <KpiCard label="Cliques" value="18.940" delta={8.3} />
              <KpiCard label="CPL" value={formatBRL(13.1)} delta={-6.2} />
            </div>
            <MiniTable
              headers={["Campanha", "Status", "Orçamento/dia", "Resultados (leads)", "CPL"]}
              rows={AD_CAMPAIGNS.map((c) => [
                c.name,
                <StatusBadge key="s" value={c.status} />,
                formatBRL(c.budget),
                c.results,
                formatBRL(c.cpl),
              ])}
            />
          </>
        )}
      </div>
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Conectar redes sociais</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {NETWORKS.map((n) => (
              <button
                key={n}
                onClick={() => toast.info(`Conexão com ${n} chega com o backend`)}
                className="rounded-lg border px-3 py-2.5 text-left text-xs font-medium text-slate-700 hover:border-indigo-300 hover:bg-indigo-50"
              >
                Conectar {n}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
