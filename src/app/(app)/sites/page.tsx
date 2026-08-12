"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Globe, MessageCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { SubNav } from "@/components/layout/subnav";
import { EmptyState } from "@/components/shared/empty-state";
import { FormsTab } from "@/components/sites/forms/forms-tab";
import { KpiCard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatBRL } from "@/lib/data/repos/opportunities";
import { useUsers } from "@/lib/data/repos/contacts";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Funis" },
  { label: "Sites" },
  { label: "Lojas" },
  { label: "Webinars" },
  { label: "Analytics" },
  { label: "Blogs" },
  { label: "WordPress" },
  { label: "Portal do cliente" },
  { label: "Formulários" },
  { label: "Pesquisas" },
  { label: "Testes" },
  { label: "Widget de chat" },
  { label: "Códigos QR" },
];

const SITES = [
  { name: "Site institucional", domain: "www.litocrm.com.br", status: "Publicado", visits: "12.480" },
  { name: "Página de lançamento — Agente de IA", domain: "lancamento.litocrm.com.br", status: "Rascunho", visits: "—" },
];

const STORE_PRODUCTS = [
  { name: "Plano Pro — Assinatura mensal", price: 297, stock: "Ilimitado", sales: 84 },
  { name: "Mentoria CRM na Prática", price: 1497, stock: "12", sales: 23 },
  { name: "E-book — Funil de vendas do zero", price: 47, stock: "Ilimitado", sales: 156 },
  { name: "Template de pipeline (pack 5)", price: 97, stock: "Ilimitado", sales: 61 },
];

const WEBINARS = [
  { title: "Como automatizar 80% do follow-up", date: "18 ago 2026 20:00", subscribers: 642, attendance: "—", status: "Agendado" },
  { title: "CRM para agências: caso prático", date: "9 jul 2026 19:30", subscribers: 418, attendance: "52%", status: "Realizado" },
  { title: "Vendas no WhatsApp sem perder lead", date: "11 jun 2026 20:00", subscribers: 890, attendance: "61%", status: "Realizado" },
];

const TOP_PAGES = [
  { path: "/", views: "8.412", avg: "1m 42s" },
  { path: "/precos", views: "3.976", avg: "2m 10s" },
  { path: "/teste-gratis", views: "2.841", avg: "58s" },
  { path: "/blog/5-sinais-crm", views: "1.634", avg: "3m 24s" },
  { path: "/oferta70", views: "1.128", avg: "1m 05s" },
];

const BLOG_POSTS = [
  { title: "5 sinais de que sua empresa precisa de um CRM", status: "Publicado", date: "12 jul 2026", views: "4.218" },
  { title: "Funil de vendas do zero: guia completo", status: "Publicado", date: "28 jun 2026", views: "2.907" },
  { title: "Agente de IA no atendimento: o que muda", status: "Rascunho", date: "—", views: "—" },
  { title: "WhatsApp + CRM: 7 automações essenciais", status: "Publicado", date: "5 jun 2026", views: "5.634" },
];

const SURVEYS = [
  { name: "Pesquisa de satisfação NPS", responses: 212, completion: "87%", created: "1 jul 2026" },
  { name: "Pós-onboarding — primeiras impressões", responses: 96, completion: "74%", created: "10 jun 2026" },
  { name: "Motivo de cancelamento", responses: 18, completion: "91%", created: "22 mai 2026" },
];

const QUIZZES = [
  { name: "Quiz Lito — Teste grátis", started: 842, completed: 617, leads: 512 },
  { name: "Diagnóstico: maturidade comercial", started: 436, completed: 298, leads: 251 },
];

const QR_CODES = [
  { name: "Cartão de visita digital", url: "litocrm.com.br/contato", scans: 342 },
  { name: "Evento — Feira do Empreendedor", url: "lito.link/feira2026", scans: 1208 },
  { name: "Cardápio de serviços", url: "litocrm.com.br/servicos", scans: 96 },
];

const CHAT_COLORS = ["#4f46e5", "#10b981", "#0f172a"];

const GOOD_STATUSES = ["Publicado", "Realizado"];

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

function QrPlaceholder() {
  const pattern = [
    [1, 1, 1, 0, 1, 0, 1],
    [1, 0, 1, 0, 0, 1, 1],
    [1, 1, 1, 0, 1, 0, 1],
    [0, 0, 0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1, 1, 1],
    [1, 1, 0, 1, 0, 0, 1],
    [1, 0, 1, 0, 1, 1, 1],
  ];
  return (
    <div className="grid size-16 shrink-0 grid-cols-7 gap-px rounded-md border bg-white p-1.5">
      {pattern.flat().map((cell, i) => (
        <div key={i} className={cn("rounded-[1px]", cell ? "bg-slate-900" : "bg-white")} />
      ))}
    </div>
  );
}

export default function SitesPage() {
  const [tab, setTab] = useState("Funis");
  const users = useUsers();
  const [chatColor, setChatColor] = useState(CHAT_COLORS[0]);
  const [welcome, setWelcome] = useState("Olá! Como podemos ajudar seu negócio hoje?");
  const [allPages, setAllPages] = useState(true);

  return (
    <div>
      <SubNav tabs={TABS} active={tab} onChange={setTab} />
      <div className="p-6">
        {tab === "Funis" && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold text-slate-900">Funis</h1>
                <p className="text-xs text-slate-500">
                  Crie e gerencie funis para gerar leads, compromissos e receber pagamentos
                </p>
              </div>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => toast.info("Construtor de funis chega em breve")}>
                <Plus className="size-3.5" /> Novo funil
              </Button>
            </div>
            <EmptyState
              icon={Globe}
              title="Comece criando um funil"
              description="Todos os seus funis e pastas ficarão aqui. Conecte seu domínio próprio e publique páginas de captura, vendas e obrigado."
              cta={
                <Button size="sm" className="text-xs" onClick={() => toast.info("Construtor de funis chega em breve")}>
                  <Plus className="size-3.5" /> Novo funil
                </Button>
              }
            />
          </>
        )}
        {tab === "Sites" && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-lg font-bold text-slate-900">Sites</h1>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => toast.info("Construtor de sites chega com o backend")}>
                <Plus className="size-3.5" /> Novo site
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {SITES.map((s) => (
                <div key={s.name} className="rounded-xl border bg-white p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">{s.name}</p>
                    <StatusBadge value={s.status} />
                  </div>
                  <p className="mt-1 text-xs font-medium text-indigo-600">{s.domain}</p>
                  <p className="mt-3 text-[11px] text-slate-500">
                    Visitas no mês: <span className="font-semibold text-slate-700">{s.visits}</span>
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
        {tab === "Lojas" && (
          <>
            <h1 className="mb-4 text-lg font-bold text-slate-900">Lojas</h1>
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <KpiCard label="Pedidos do mês" value="324" delta={14.2} />
              <KpiCard label="Receita" value={formatBRL(48620)} delta={9.8} />
              <KpiCard label="Taxa de conversão" value="3,4%" delta={0.6} />
            </div>
            <MiniTable
              headers={["Produto", "Preço", "Estoque", "Vendas"]}
              rows={STORE_PRODUCTS.map((p) => [p.name, formatBRL(p.price), p.stock, p.sales])}
            />
          </>
        )}
        {tab === "Webinars" && (
          <>
            <h1 className="mb-4 text-lg font-bold text-slate-900">Webinars</h1>
            <MiniTable
              headers={["Título", "Data", "Inscritos", "Comparecimento", "Status"]}
              rows={WEBINARS.map((w) => [
                w.title,
                w.date,
                w.subscribers,
                w.attendance,
                <StatusBadge key="s" value={w.status} />,
              ])}
            />
          </>
        )}
        {tab === "Analytics" && (
          <>
            <h1 className="mb-4 text-lg font-bold text-slate-900">Analytics</h1>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <KpiCard label="Visitantes" value="14.820" delta={11.3} />
              <KpiCard label="Pageviews" value="42.176" delta={7.9} />
              <KpiCard label="Taxa de rejeição" value="38,2%" delta={-2.4} />
              <KpiCard label="Duração média" value="1m 47s" hint="Últimos 30 dias" />
            </div>
            <MiniTable
              headers={["Página", "Visualizações", "Tempo médio"]}
              rows={TOP_PAGES.map((p) => [
                <span key="p" className="font-medium text-indigo-600">{p.path}</span>,
                p.views,
                p.avg,
              ])}
            />
          </>
        )}
        {tab === "Blogs" && (
          <>
            <h1 className="mb-4 text-lg font-bold text-slate-900">Blogs</h1>
            <MiniTable
              headers={["Título", "Autor", "Status", "Publicado em", "Visualizações"]}
              rows={BLOG_POSTS.map((p, i) => [
                p.title,
                users[i % Math.max(users.length, 1)]?.name ?? "—",
                <StatusBadge key="s" value={p.status} />,
                p.date,
                p.views,
              ])}
            />
          </>
        )}
        {tab === "WordPress" && (
          <>
            <h1 className="mb-4 text-lg font-bold text-slate-900">WordPress</h1>
            <div className="max-w-lg rounded-xl border bg-white p-6 text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-slate-900 text-2xl font-black text-white">
                W
              </div>
              <p className="mt-4 text-sm font-semibold text-slate-800">
                Hospede seu WordPress dentro do CRM
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Migração gratuita, SSL automático e atualizações gerenciadas — tudo integrado aos
                seus funis e formulários.
              </p>
              <Button
                size="sm"
                className="mt-4 h-8 text-xs"
                onClick={() => toast.info("Conexão com WordPress chega com o backend")}
              >
                Conectar
              </Button>
            </div>
          </>
        )}
        {tab === "Portal do cliente" && (
          <>
            <h1 className="mb-4 text-lg font-bold text-slate-900">Portal do cliente</h1>
            <Link
              href="/assinaturas"
              className="block max-w-lg rounded-xl border bg-white p-5 transition-colors hover:border-indigo-300"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    O Portal do cliente mora no módulo Assinaturas
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Gerencie acessos, links mágicos e convites em Assinaturas → Portal do cliente.
                  </p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-indigo-500" />
              </div>
            </Link>
          </>
        )}
        {tab === "Formulários" && <FormsTab />}
        {tab === "Pesquisas" && (
          <>
            <h1 className="mb-4 text-lg font-bold text-slate-900">Pesquisas</h1>
            <MiniTable
              headers={["Nome", "Respostas", "Taxa de conclusão", "Criada em"]}
              rows={SURVEYS.map((s) => [s.name, s.responses, s.completion, s.created])}
            />
          </>
        )}
        {tab === "Testes" && (
          <>
            <h1 className="mb-4 text-lg font-bold text-slate-900">Testes</h1>
            <MiniTable
              headers={["Nome", "Iniciados", "Concluídos", "Leads gerados"]}
              rows={QUIZZES.map((q) => [q.name, q.started, q.completed, q.leads])}
            />
          </>
        )}
        {tab === "Widget de chat" && (
          <>
            <h1 className="mb-4 text-lg font-bold text-slate-900">Widget de chat</h1>
            <div className="grid max-w-3xl gap-4 md:grid-cols-2">
              <div className="flex min-h-56 items-end justify-end rounded-xl border bg-slate-50 p-5">
                <div className="flex flex-col items-end gap-2">
                  <div className="max-w-52 rounded-xl rounded-br-sm border bg-white p-3 text-xs text-slate-700 shadow-sm">
                    {welcome}
                  </div>
                  <div
                    className="flex size-12 items-center justify-center rounded-full shadow-md"
                    style={{ backgroundColor: chatColor }}
                  >
                    <MessageCircle className="size-5 text-white" />
                  </div>
                </div>
              </div>
              <div className="space-y-4 rounded-xl border bg-white p-5">
                <div className="space-y-1.5">
                  <Label className="text-xs">Cor do widget</Label>
                  <div className="flex gap-2">
                    {CHAT_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setChatColor(c)}
                        className={cn(
                          "size-7 rounded-full border-2",
                          chatColor === c ? "border-indigo-500 ring-2 ring-indigo-200" : "border-transparent"
                        )}
                        style={{ backgroundColor: c }}
                        aria-label={`Cor ${c}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Mensagem de boas-vindas</Label>
                  <Input
                    value={welcome}
                    onChange={(e) => setWelcome(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-slate-700">Exibir em todas as páginas</p>
                  <Switch checked={allPages} onCheckedChange={setAllPages} />
                </div>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => toast.success("Configurações do widget salvas")}
                >
                  Salvar
                </Button>
              </div>
            </div>
          </>
        )}
        {tab === "Códigos QR" && (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-lg font-bold text-slate-900">Códigos QR</h1>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => toast.info("Gerador de QR chega com o backend")}>
                <Plus className="size-3.5" /> Novo QR
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {QR_CODES.map((q) => (
                <div key={q.name} className="flex items-center gap-4 rounded-xl border bg-white p-4">
                  <QrPlaceholder />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{q.name}</p>
                    <p className="truncate text-xs font-medium text-indigo-600">{q.url}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {q.scans.toLocaleString("pt-BR")} escaneamentos
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
