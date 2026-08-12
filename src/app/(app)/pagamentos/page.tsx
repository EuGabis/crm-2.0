"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SubNav } from "@/components/layout/subnav";
import { KpiCard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Users2,
  UserPlus,
  Radar,
  BarChart3,
  FileText,
  Upload,
  Download,
  Trash2,
  Loader2,
  ArrowUpDown,
} from "lucide-react";
import { useContacts, contactName } from "@/lib/data/repos/contacts";
import { formatBRL } from "@/lib/data/repos/opportunities";
import {
  EVENTS_PAGE_SIZE,
  EVENTS_PAGE_SIZE_OPTIONS,
  paymentsActions,
  useGuruIntegration,
  usePaymentEventsForContact,
  usePaymentEventsPage,
  usePaymentSalesReport,
  usePaymentSubscriptions,
  usePaymentSubscriptionsForContact,
  usePaymentsRealtimeStatus,
  type PaymentEvent,
  type PaymentSubscription,
} from "@/lib/data/repos/db/payments";
import {
  ALLOWED_FILES,
  paymentFilesActions,
  usePaymentFiles,
  type PaymentFile,
} from "@/lib/data/repos/db/payment-files";
import {
  CONTACTS_PAGE_SIZE,
  usePaymentContactsPage,
  usePaymentContactsSummary,
  type GuruContact,
} from "@/lib/data/repos/db/payment-contacts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { classifyGuruStatus, guruStatusLabel } from "@/lib/data/guru";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Integrações" },
  { label: "Arquivos e contratos" },
  { label: "Vendas" },
  { label: "Assinaturas" },
  { label: "Contatos" },
  { label: "Leads" },
  { label: "Produtos" },
  { label: "R.P.P.C." },
  { label: "Relatórios" },
];

/* ------------------------------- Guru (real) ----------------------------- */

function GuruProviderCard() {
  const { guru, loaded } = useGuruIntegration();
  const { isAdmin } = useMyMembership();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col rounded-xl border bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex size-9 items-center justify-center rounded-lg bg-slate-100 text-sm font-black text-slate-600">
          G
        </span>
        {loaded && guru.connected && (
          <Badge className="bg-emerald-100 text-emerald-700">Conectado</Badge>
        )}
      </div>
      <p className="text-sm font-semibold text-slate-800">Guru</p>
      <p className="mt-1 flex-1 text-[11px] text-slate-500">
        Checkout, vendas e assinaturas da Digital Manager Guru — sincronizado a cada minuto.
      </p>
      {!loaded ? (
        <p className="mt-1 text-[10px] text-slate-400">Verificando conexão...</p>
      ) : (
        guru.connected && (
          <>
            <p className="mt-1 text-[10px] text-slate-400">
              {guru.lastSyncedAt
                ? `Última sincronização: ${format(new Date(guru.lastSyncedAt), "dd MMM, HH:mm:ss", { locale: ptBR })}`
                : "Aguardando a primeira sincronização (roda a cada minuto)..."}
            </p>
            <p className="text-[10px] text-slate-400">
              {guru.historyBackfillDone
                ? "Histórico completo importado (desde 01/06/2024)."
                : guru.historyBackfillCursor
                  ? `Importando histórico: já coberto até ${format(new Date(guru.historyBackfillCursor), "dd MMM yyyy", { locale: ptBR })}...`
                  : "Histórico completo começa a ser importado no próximo minuto..."}
            </p>
          </>
        )
      )}
      <Button
        variant={loaded && guru.connected ? "outline" : "default"}
        size="sm"
        className="mt-3 h-7 text-xs"
        disabled={!loaded}
        onClick={() => {
          if (!isAdmin) {
            toast.info("Apenas administradores podem configurar integrações de pagamento");
            return;
          }
          setOpen(true);
        }}
      >
        {!loaded ? "..." : guru.connected ? "Gerenciar" : "Conectar"}
      </Button>
      <GuruDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function GuruDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { guru } = useGuruIntegration();
  const [apiKey, setApiKey] = useState(guru.apiKey);
  const [webhookToken, setWebhookToken] = useState(guru.webhookToken);
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    if (open) {
      setApiKey(guru.apiKey);
      setWebhookToken(guru.webhookToken);
      setOrigin(window.location.origin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const webhookUrl = origin ? `${origin}/api/webhooks/guru` : "";

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copiado`);
  };

  const save = async () => {
    if (!webhookToken.trim()) {
      toast.error("Cole o Account Token (api_token) mostrado no painel da Guru");
      return;
    }
    if (!apiKey.trim()) {
      toast.error("Cole o User Token — sem ele a sincronização de 1 minuto não funciona");
      return;
    }
    setSaving(true);
    const res = await paymentsActions.saveGuruCredentials({ apiKey, webhookToken });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível salvar");
      return;
    }
    toast.success("Guru conectada");
    onOpenChange(false);
  };

  const disconnect = async () => {
    if (!window.confirm("Desconectar a Guru? Os eventos já recebidos continuam salvos.")) return;
    const ok = await paymentsActions.disconnectGuru();
    if (ok) {
      toast.success("Guru desconectada");
      onOpenChange(false);
    } else {
      toast.error("Não foi possível desconectar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar com a Guru</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">URL do webhook</Label>
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly className="h-8 font-mono text-[11px]" />
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 text-xs"
                onClick={() => copy(webhookUrl, "URL")}
              >
                Copiar
              </Button>
            </div>
            <p className="text-[10px] text-slate-400">
              Cole esta URL no painel da Guru em Configurações → Webhook.
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Account Token (api_token do webhook) *</Label>
            <Input
              key={open ? "open" : "closed"}
              value={webhookToken}
              onChange={(e) => setWebhookToken(e.target.value)}
              placeholder="Painel da Guru → Minha Conta → API"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-8 font-mono text-xs"
            />
            <p className="text-[10px] text-slate-400">
              A Guru envia esse valor em todo webhook — usamos para confirmar que o evento é
              mesmo dela e identificar sua empresa.
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">User Token (para sincronizar vendas/assinaturas) *</Label>
            <Input
              key={open ? "open" : "closed"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Painel da Guru → Meu Perfil → Tokens API"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-8 font-mono text-xs"
            />
            <p className="text-[10px] text-slate-400">
              {guru.apiKey
                ? `Token salvo: ${"•".repeat(Math.max(0, guru.apiKey.length - 4))}${guru.apiKey.slice(-4)}`
                : "Nenhum token salvo ainda."}{" "}
              Sem ele, a sincronização automática de 1 minuto não roda — só os webhooks recebidos.
            </p>
          </div>
        </div>
        <DialogFooter>
          {guru.connected && (
            <Button variant="ghost" className="text-red-600 hover:text-red-700" onClick={disconnect}>
              Desconectar
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function guruStatusBadgeClass(status: string | null): string {
  switch (classifyGuruStatus(status)) {
    case "aprovado":
      return "bg-emerald-100 text-emerald-700";
    case "pendente":
    case "atrasado":
      return "bg-amber-100 text-amber-700";
    case "recusado":
    case "reembolsado":
    case "chargeback":
    case "cancelado":
    case "expirado":
      return "bg-red-100 text-red-600";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function GuruStatusBadge({ status }: { status: string | null }) {
  return (
    <Badge variant="secondary" className={cn(guruStatusBadgeClass(status))}>
      {guruStatusLabel(status)}
    </Badge>
  );
}

/** Aberto por "Ver payload" nas tabelas alimentadas pela Guru — mostra o JSON bruto. */
function RawPayloadDialog({
  raw,
  onClose,
}: {
  raw: Record<string, unknown> | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!raw} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Payload recebido da Guru</DialogTitle>
        </DialogHeader>
        <pre className="max-h-96 overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] text-slate-700">
          {raw ? JSON.stringify(raw, null, 2) : ""}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

function RawPayloadButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="text-[11px] font-medium text-indigo-600 hover:underline"
      onClick={onClick}
    >
      Ver payload
    </button>
  );
}

function GuruLiveBadge() {
  const realtime = usePaymentsRealtimeStatus();
  if (realtime !== "on") return null;
  return <Badge className="bg-emerald-100 text-emerald-700">● Ao vivo</Badge>;
}

/**
 * "YYYY-MM" de um ISO — usado pra casar `SalesMonthlyRow.month` (vem de
 * `date_trunc('month', ...)` no Postgres, sempre em UTC, ex.
 * "2026-08-01T00:00:00+00:00") com o mês corrente. Comparar via
 * `new Date(iso).getMonth()` quebra em fuso negativo (Brasil, UTC-3): meia-
 * noite UTC do dia 1º cai no dia anterior ainda no mês passado no horário
 * local, e o mês inteiro fica de fora do filtro — foi por isso que Receita
 * do mês/Vendas aprovadas (mês) apareciam zeradas mesmo com vendas reais
 * naquele mês. Comparar a string evita qualquer conversão de fuso.
 */
function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** As listas já vêm ordenadas por data (mais recente primeiro) do store; isto só inverte a exibição. */
function SortToggle({
  ascending,
  onToggle,
}: {
  ascending: boolean;
  onToggle: () => void;
}) {
  return (
    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onToggle}>
      <ArrowUpDown className="size-3.5" />
      {ascending ? "Mais antigas primeiro" : "Mais recentes primeiro"}
    </Button>
  );
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "Pago":
    case "Paga":
    case "Concluído":
    case "Ativa":
    case "Ativo":
      return "bg-emerald-100 text-emerald-700";
    case "Pendente":
    case "Enviada":
    case "Processando":
      return "bg-amber-100 text-amber-700";
    case "Reembolsado":
    case "Vencida":
    case "Inadimplente":
    case "Expirado":
      return "bg-red-100 text-red-600";
    case "Cancelada":
      return "bg-slate-200 text-slate-600";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="secondary" className={cn(statusBadgeClass(status))}>
      {status}
    </Badge>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
  onAction,
}: {
  title: string;
  subtitle: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <h1 className="text-lg font-bold text-slate-900">{title}</h1>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      {action && (
        <Button size="sm" className="h-8 text-xs" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
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
              {cells.map((cell, j) => (
                <td key={j} className="whitespace-nowrap px-4 py-2.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useClienteNome() {
  const contacts = useContacts();
  return useMemo(
    () => (i: number) =>
      contacts.length > 0 ? contactName(contacts[i % contacts.length]) : "Cliente",
    [contacts]
  );
}

/* ------------------------------- Pagamentos ------------------------------ */

function TransacoesTab() {
  const { guru, loaded } = useGuruIntegration();
  if (!loaded) return null;
  return guru.connected ? <TransacoesGuruTab /> : <TransacoesMockTab />;
}

function TransacoesMockTab() {
  const nome = useClienteNome();
  const rows = useMemo(
    () => [
      { cliente: nome(0), metodo: "Pix", valor: 147, status: "Pago", data: "06 ago 2026" },
      { cliente: nome(3), metodo: "Cartão", valor: 197, status: "Pago", data: "05 ago 2026" },
      { cliente: nome(5), metodo: "Boleto", valor: 97, status: "Pendente", data: "05 ago 2026" },
      { cliente: nome(8), metodo: "Cartão", valor: 1470, status: "Pago", data: "04 ago 2026" },
      { cliente: nome(11), metodo: "Pix", valor: 147, status: "Reembolsado", data: "03 ago 2026" },
      { cliente: nome(14), metodo: "Cartão", valor: 147, status: "Pago", data: "02 ago 2026" },
      { cliente: nome(16), metodo: "Pix", valor: 297, status: "Pago", data: "01 ago 2026" },
      { cliente: nome(19), metodo: "Boleto", valor: 147, status: "Reembolsado", data: "31 jul 2026" },
    ],
    [nome]
  );
  return (
    <>
      <SectionHeader
        title="Vendas"
        subtitle="Transações processadas pelos provedores conectados"
        action="Registrar pagamento"
        onAction={() => toast.info("Registro manual de pagamento chega com o backend")}
      />
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Receita do mês" value="R$ 12.480,00" delta={12} />
        <KpiCard label="Transações" value="94" delta={8} />
        <KpiCard label="Ticket médio" value="R$ 132,77" delta={-2} />
        <KpiCard label="Reembolsos" value="R$ 294,00" hint="2 transações reembolsadas" />
      </div>
      <MiniTable
        headers={["Cliente", "Método", "Valor", "Status", "Data"]}
        rows={rows.map((r) => [
          <span key="c" className="font-medium text-slate-800">{r.cliente}</span>,
          <span key="m" className="text-slate-600">{r.metodo}</span>,
          <span key="v" className="font-semibold text-slate-800">{formatBRL(r.valor)}</span>,
          <StatusBadge key="s" status={r.status} />,
          <span key="d" className="text-slate-500">{r.data}</span>,
        ])}
      />
    </>
  );
}

function TransacoesGuruTab() {
  const salesReport = usePaymentSalesReport();
  const [rawEvent, setRawEvent] = useState<PaymentEvent | null>(null);
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(EVENTS_PAGE_SIZE);
  const { rows: events, total, loading } = usePaymentEventsPage(page, sortAsc, pageSize);

  // KPIs vêm de payment_sales_monthly (histórico completo agregado no
  // banco), não do array `events` (só as 100 vendas mais recentes) — com
  // milhares de vendas sincronizadas, o mês corrente sozinho já passa
  // disso e os números ficavam bem abaixo do que a Guru mostra.
  const kpis = useMemo(() => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const thisMonth = salesReport.rows.filter((r) => monthKey(r.month) === currentMonth);
    const approved = thisMonth.filter((r) => classifyGuruStatus(r.status) === "aprovado");
    const revenue = approved.reduce((sum, r) => sum + r.revenue, 0);
    const count = approved.reduce((sum, r) => sum + r.salesCount, 0);
    const refunded = salesReport.rows.filter((r) =>
      ["reembolsado", "chargeback"].includes(classifyGuruStatus(r.status))
    );
    const refundTotal = refunded.reduce((sum, r) => sum + r.revenue, 0);
    const refundCount = refunded.reduce((sum, r) => sum + r.salesCount, 0);
    return {
      revenue,
      count,
      ticket: count ? revenue / count : 0,
      refundTotal,
      refundCount,
    };
  }, [salesReport.rows]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Vendas</h1>
          <p className="text-xs text-slate-500">Vendas sincronizadas da Guru (webhook + API)</p>
        </div>
        <div className="flex items-center gap-2">
          <GuruLiveBadge />
          <Select
            value={String(pageSize)}
            onValueChange={(v) => {
              setPageSize(Number(v ?? EVENTS_PAGE_SIZE));
              setPage(0);
            }}
          >
            <SelectTrigger className="h-7 w-[110px] text-xs">
              <SelectValue>{pageSize} / página</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {EVENTS_PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)} className="text-xs">
                  {n} / página
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SortToggle
            ascending={sortAsc}
            onToggle={() => {
              setSortAsc((v) => !v);
              setPage(0);
            }}
          />
        </div>
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Receita do mês" value={formatBRL(kpis.revenue)} />
        <KpiCard label="Vendas aprovadas (mês)" value={String(kpis.count)} />
        <KpiCard label="Ticket médio" value={formatBRL(kpis.ticket)} />
        <KpiCard
          label="Reembolsos / chargebacks"
          value={formatBRL(kpis.refundTotal)}
          hint={`${kpis.refundCount} transações`}
        />
      </div>
      {total === 0 && !loading ? (
        <div className="rounded-xl border bg-white p-8 text-center text-xs text-slate-400">
          Nenhuma venda sincronizada ainda. A primeira sincronização roda no próximo minuto após
          conectar — as vendas aparecem aqui automaticamente.
        </div>
      ) : (
        <>
          <div className={cn("transition-opacity", loading && "opacity-50")}>
            <MiniTable
              headers={["Código", "Contato", "Produto", "Criada em", "Status", "Valor", ""]}
              rows={events.map((e) => [
                <span key="cd" className="font-mono text-[11px] text-slate-500">{e.code ?? "—"}</span>,
                <span key="c" className="text-slate-600">{e.contactName ?? e.contactEmail ?? "—"}</span>,
                <span key="p" className="text-slate-600">{e.productName ?? "—"}</span>,
                <span key="d" className="text-slate-500">
                  {e.guruCreatedAt ? format(new Date(e.guruCreatedAt), "dd MMM yyyy, HH:mm", { locale: ptBR }) : "—"}
                </span>,
                <GuruStatusBadge key="s" status={e.status} />,
                <span key="v" className="font-semibold text-slate-800">
                  {e.amount !== null ? formatBRL(e.amount) : "—"}
                </span>,
                <RawPayloadButton key="raw" onClick={() => setRawEvent(e)} />,
              ])}
            />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[11px] text-slate-400">
              {total === 0 ? 0 : page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} de{" "}
              {total.toLocaleString("pt-BR")} vendas
            </p>
            <Pager page={page} pageCount={Math.max(1, Math.ceil(total / pageSize))} onChange={setPage} />
          </div>
        </>
      )}
      <RawPayloadDialog raw={rawEvent?.raw ?? null} onClose={() => setRawEvent(null)} />
    </>
  );
}

/* ------------------------------- Assinaturas ----------------------------- */

function AssinaturasTab() {
  const { guru, loaded } = useGuruIntegration();
  if (!loaded) return null;
  return guru.connected ? <AssinaturasGuruTab /> : <AssinaturasMockTab />;
}

function AssinaturasMockTab() {
  const nome = useClienteNome();
  const rows = useMemo(
    () => [
      { cliente: nome(0), plano: "Mensal — R$ 147,00", status: "Ativa", proxima: "01 set 2026" },
      { cliente: nome(3), plano: "Anual — R$ 1.470,00", status: "Ativa", proxima: "04 mar 2027" },
      { cliente: nome(5), plano: "Mensal — R$ 147,00", status: "Inadimplente", proxima: "28 jul 2026" },
      { cliente: nome(8), plano: "Mensal — R$ 147,00", status: "Ativa", proxima: "15 ago 2026" },
      { cliente: nome(11), plano: "Anual — R$ 1.470,00", status: "Ativa", proxima: "10 jan 2027" },
      { cliente: nome(14), plano: "Mensal — R$ 147,00", status: "Cancelada", proxima: "—" },
    ],
    [nome]
  );
  return (
    <>
      <SectionHeader
        title="Assinaturas"
        subtitle="Cobranças recorrentes ativas, inadimplentes e canceladas"
        action="+ Nova assinatura"
        onAction={() => toast.info("Criação de assinaturas chega com o backend")}
      />
      <MiniTable
        headers={["Cliente", "Plano", "Status", "Próxima cobrança"]}
        rows={rows.map((r) => [
          <span key="c" className="font-medium text-slate-800">{r.cliente}</span>,
          <span key="p" className="text-slate-600">{r.plano}</span>,
          <StatusBadge key="s" status={r.status} />,
          <span key="d" className="text-slate-500">{r.proxima}</span>,
        ])}
      />
    </>
  );
}

function AssinaturasGuruTab() {
  const subscriptions = usePaymentSubscriptions();
  const [rawSub, setRawSub] = useState<PaymentSubscription | null>(null);
  const [sortAsc, setSortAsc] = useState(false);

  const sortedSubscriptions = useMemo(
    () => (sortAsc ? [...subscriptions].reverse() : subscriptions),
    [subscriptions, sortAsc]
  );

  const counts = useMemo(() => {
    const byCategory = { ativa: 0, atrasado: 0, cancelado: 0, outro: 0 };
    for (const s of subscriptions) {
      const cat = classifyGuruStatus(s.status);
      if (cat === "aprovado") byCategory.ativa++;
      else if (cat === "atrasado") byCategory.atrasado++;
      else if (cat === "cancelado" || cat === "expirado") byCategory.cancelado++;
      else byCategory.outro++;
    }
    return byCategory;
  }, [subscriptions]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Assinaturas</h1>
          <p className="text-xs text-slate-500">Estado atual de cada assinante da Guru</p>
        </div>
        <div className="flex items-center gap-2">
          <GuruLiveBadge />
          <SortToggle ascending={sortAsc} onToggle={() => setSortAsc((v) => !v)} />
        </div>
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Ativas" value={String(counts.ativa)} />
        <KpiCard label="Atrasadas" value={String(counts.atrasado)} />
        <KpiCard label="Canceladas / expiradas" value={String(counts.cancelado)} />
        <KpiCard label="Total de assinantes" value={String(subscriptions.length)} />
      </div>
      {subscriptions.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-xs text-slate-400">
          Nenhuma assinatura sincronizada ainda. A primeira sincronização roda no próximo minuto
          após conectar — as assinaturas aparecem aqui automaticamente.
        </div>
      ) : (
        <MiniTable
          headers={["Código", "Contato", "Produto", "Iniciada em", "Atualizada em", "Status", "Qtd cobranças", "Cobrada a cada", ""]}
          rows={sortedSubscriptions.map((s) => [
            <span key="cd" className="font-mono text-[11px] text-slate-500">{s.code ?? "—"}</span>,
            <span key="c" className="font-medium text-slate-800">
              {s.contactName ?? s.contactEmail ?? "—"}
            </span>,
            <span key="p" className="text-slate-600">{s.productName ?? "—"}</span>,
            <span key="i" className="text-slate-500">
              {s.guruStartedAt ? format(new Date(s.guruStartedAt), "dd MMM yyyy, HH:mm", { locale: ptBR }) : "—"}
            </span>,
            <span key="d" className="text-slate-500">
              {s.guruUpdatedAt ? format(new Date(s.guruUpdatedAt), "dd MMM yyyy, HH:mm", { locale: ptBR }) : "—"}
            </span>,
            <GuruStatusBadge key="s" status={s.status} />,
            <span key="qt" className="text-slate-600">{s.chargedTimes ?? "—"}</span>,
            <span key="ce" className="text-slate-600">
              {s.chargedEveryDays !== null ? `${s.chargedEveryDays} dias` : "—"}
            </span>,
            <RawPayloadButton key="raw" onClick={() => setRawSub(s)} />,
          ])}
        />
      )}
      <RawPayloadDialog raw={rawSub?.raw ?? null} onClose={() => setRawSub(null)} />
    </>
  );
}

/* -------------------------------- Produtos ------------------------------- */

const PRODUTOS_MOCK = [
  { nome: "Plano Mensal", desc: "Acesso completo à plataforma com cobrança mensal.", preco: 147, tipo: "Recorrente", ativo: true },
  { nome: "Plano Anual", desc: "12 meses com 2 meses de desconto na adesão.", preco: 1470, tipo: "Recorrente", ativo: true },
  { nome: "Implementação", desc: "Setup assistido: funis, automações e integrações.", preco: 2000, tipo: "Único", ativo: true },
  { nome: "Curso CRM na Prática", desc: "Treinamento gravado para o time comercial.", preco: 297, tipo: "Único", ativo: true },
];

function ProdutosTab() {
  const { guru, loaded } = useGuruIntegration();
  if (!loaded) return null;
  return guru.connected ? <ProdutosGuruTab /> : <ProdutosMockTab />;
}

function ProdutosMockTab() {
  return (
    <>
      <SectionHeader
        title="Produtos"
        subtitle="Catálogo usado em faturas, links de pagamento e checkout"
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PRODUTOS_MOCK.map((p) => (
          <div key={p.nome} className="flex flex-col rounded-xl border bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <Badge variant="secondary" className="bg-slate-100 text-slate-600">
                {p.tipo}
              </Badge>
              {p.ativo && <Badge className="bg-emerald-100 text-emerald-700">Ativo</Badge>}
            </div>
            <p className="text-sm font-semibold text-slate-800">{p.nome}</p>
            <p className="mt-1 flex-1 text-[11px] text-slate-500">{p.desc}</p>
            <p className="mt-3 text-lg font-bold text-slate-900">
              {formatBRL(p.preco)}
              {p.tipo === "Recorrente" && (
                <span className="text-[11px] font-medium text-slate-400">
                  {p.preco >= 1000 ? "/ano" : "/mês"}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

interface GuruProductRow {
  id: string;
  name: string;
  type: string;
  is_hidden?: number;
  marketplace_name?: string;
  group?: { name?: string };
  created_at?: number;
}

function ProdutosGuruTab() {
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    products: GuruProductRow[];
  }>({ loading: true, error: null, products: [] });

  useEffect(() => {
    let active = true;
    fetch("/api/integrations/guru/products")
      .then(async (res) => {
        const json = await res.json();
        if (!active) return;
        if (!res.ok) {
          setState({ loading: false, error: json.error ?? "Falha ao carregar produtos", products: [] });
          return;
        }
        setState({ loading: false, error: null, products: json.products ?? [] });
      })
      .catch((e) => {
        if (active) setState({ loading: false, error: e instanceof Error ? e.message : "Falha ao carregar", products: [] });
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <SectionHeader title="Produtos" subtitle="Catálogo de produtos da Guru (GET /api/v2/products)" />
      {state.loading ? (
        <div className="rounded-xl border bg-white p-8 text-center text-xs text-slate-400">
          Carregando produtos da Guru...
        </div>
      ) : state.error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-xs text-red-600">
          {state.error}
        </div>
      ) : state.products.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-xs text-slate-400">
          Nenhum produto encontrado na conta da Guru.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {state.products.map((p) => (
            <div key={p.id} className="flex flex-col rounded-xl border bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <Badge variant="secondary" className="bg-slate-100 text-slate-600">
                  {p.type === "plan" ? "Assinatura" : "Produto"}
                </Badge>
                {p.is_hidden ? (
                  <Badge variant="secondary" className="bg-slate-100 text-slate-500">Oculto</Badge>
                ) : (
                  <Badge className="bg-emerald-100 text-emerald-700">Visível</Badge>
                )}
              </div>
              <p className="text-sm font-semibold text-slate-800">{p.name}</p>
              <p className="mt-1 flex-1 text-[11px] text-slate-500">
                {p.group?.name ?? "Sem grupo"} · {p.marketplace_name ?? "—"}
              </p>
              <p className="mt-3 text-[11px] text-slate-400">
                {p.created_at
                  ? `Criado em ${format(new Date(p.created_at * 1000), "dd MMM yyyy", { locale: ptBR })}`
                  : "—"}
              </p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* -------------------------------- Contatos ------------------------------- */

function ContatosTab() {
  const { guru, loaded } = useGuruIntegration();
  if (!loaded) return null;
  return guru.connected ? (
    <ContatosGuruTab />
  ) : (
    <EmptyState
      icon={Users2}
      title="Contatos da Guru"
      description="Conecte a Guru na aba Integrações. Assim que os dados sincronizarem, seus contatos aparecem aqui automaticamente."
    />
  );
}

/** Paginação estilo Guru: Anterior / números / Próxima. */
function Pager({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (p: number) => void }) {
  if (pageCount <= 1) return null;
  // janela de até 5 números em volta da página atual
  const start = Math.max(0, Math.min(page - 2, pageCount - 5));
  const nums = Array.from({ length: Math.min(5, pageCount) }, (_, i) => start + i);
  const btn = "flex h-7 min-w-7 items-center justify-center rounded-md border px-2 text-[11px] font-medium";
  return (
    <div className="flex items-center gap-1">
      <button
        className={cn(btn, "text-slate-600 disabled:opacity-40")}
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      >
        Anterior
      </button>
      {start > 0 && <span className="px-1 text-[11px] text-slate-400">…</span>}
      {nums.map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={cn(btn, n === page ? "border-indigo-500 bg-indigo-500 text-white" : "text-slate-600 hover:bg-slate-100")}
        >
          {n + 1}
        </button>
      ))}
      {start + nums.length < pageCount && <span className="px-1 text-[11px] text-slate-400">…</span>}
      <button
        className={cn(btn, "text-slate-600 disabled:opacity-40")}
        disabled={page >= pageCount - 1}
        onClick={() => onChange(page + 1)}
      >
        Próxima
      </button>
    </div>
  );
}

/**
 * Aberto ao clicar num contato — espelha a tela de detalhe da própria Guru
 * (Dados Pessoais, Vendas, Assinaturas). Endereço/saldo/lista de bloqueio
 * que aparecem no painel da Guru não vêm de nenhum campo documentado em
 * GET /api/v2/contacts — por isso não têm como aparecer aqui.
 */
function ContactDetailDialog({ contact, onClose }: { contact: GuruContact | null; onClose: () => void }) {
  const [tab, setTab] = useState("detalhe");
  const { rows: sales, loading: salesLoading } = usePaymentEventsForContact(
    contact?.email ?? null,
    contact?.email ? null : contact?.name ?? null
  );
  const { rows: subs, loading: subsLoading } = usePaymentSubscriptionsForContact(
    contact?.email ?? null,
    contact?.email ? null : contact?.name ?? null
  );

  useEffect(() => {
    if (contact) setTab("detalhe");
  }, [contact?.contactKey]);

  return (
    <Dialog open={!!contact} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="truncate pr-6">{contact?.name ?? contact?.email ?? "Contato"}</DialogTitle>
        </DialogHeader>
        {contact && (
          <Tabs
            value={tab}
            onValueChange={(v) => setTab((v as string) ?? "detalhe")}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList variant="line" className="w-full shrink-0 border-b">
              <TabsTrigger value="detalhe" className="text-xs">Detalhe</TabsTrigger>
              <TabsTrigger value="vendas" className="text-xs">
                Vendas{sales.length > 0 ? ` (${sales.length})` : ""}
              </TabsTrigger>
              <TabsTrigger value="assinaturas" className="text-xs">
                Assinaturas{subs.length > 0 ? ` (${subs.length})` : ""}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="detalhe" className="mt-4 space-y-4 overflow-y-auto">
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-700">Dados pessoais</p>
                <div className="grid grid-cols-2 gap-4 rounded-lg border bg-white p-4 text-xs">
                  <div>
                    <p className="text-slate-400">Nome</p>
                    <p className="font-medium text-slate-800">{contact.name ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">E-mail</p>
                    <p className="font-medium text-slate-800">{contact.email ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Documento</p>
                    <p className="font-mono text-slate-800">{contact.doc ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Celular</p>
                    <p className="text-slate-800">{contact.phone ?? "—"}</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <KpiCard label="Compras" value={String(contact.purchases)} />
                <KpiCard label="Total gasto" value={formatBRL(contact.totalSpent)} />
                <KpiCard label="Assinaturas ativas" value={String(contact.activeSubs)} />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-700">Endereço</p>
                <p className="rounded-lg border bg-slate-50 p-3 text-xs text-slate-400">
                  Não disponível — a API pública da Guru não retorna endereço no cadastro de contatos.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="vendas" className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto">
              {salesLoading ? (
                <p className="p-6 text-center text-xs text-slate-400">Carregando...</p>
              ) : sales.length === 0 ? (
                <p className="rounded-lg border bg-white p-6 text-center text-xs text-slate-400">
                  Nenhuma venda encontrada para este contato.
                </p>
              ) : (
                <MiniTable
                  headers={["Código", "Produto", "Criada em", "Status", "Valor"]}
                  rows={sales.map((e) => [
                    <span key="cd" className="block max-w-24 truncate font-mono text-[11px] text-slate-500" title={e.code ?? undefined}>
                      {e.code ?? "—"}
                    </span>,
                    <span key="p" className="text-slate-600">{e.productName ?? "—"}</span>,
                    <span key="d" className="text-slate-500">
                      {e.guruCreatedAt ? format(new Date(e.guruCreatedAt), "dd MMM yyyy", { locale: ptBR }) : "—"}
                    </span>,
                    <GuruStatusBadge key="s" status={e.status} />,
                    <span key="v" className="font-semibold text-slate-800">
                      {e.amount !== null ? formatBRL(e.amount) : "—"}
                    </span>,
                  ])}
                />
              )}
            </TabsContent>

            <TabsContent value="assinaturas" className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto">
              {subsLoading ? (
                <p className="p-6 text-center text-xs text-slate-400">Carregando...</p>
              ) : subs.length === 0 ? (
                <p className="rounded-lg border bg-white p-6 text-center text-xs text-slate-400">
                  Nenhuma assinatura encontrada para este contato.
                </p>
              ) : (
                <MiniTable
                  headers={["Código", "Produto", "Status", "Iniciada em", "Próxima cobrança", "Valor"]}
                  rows={subs.map((s) => [
                    <span key="cd" className="block max-w-24 truncate font-mono text-[11px] text-slate-500" title={s.code ?? undefined}>
                      {s.code ?? "—"}
                    </span>,
                    <span key="p" className="text-slate-600">{s.productName ?? "—"}</span>,
                    <GuruStatusBadge key="s" status={s.status} />,
                    <span key="d" className="text-slate-500">
                      {s.guruStartedAt ? format(new Date(s.guruStartedAt), "dd MMM yyyy", { locale: ptBR }) : "—"}
                    </span>,
                    <span key="n" className="text-slate-500">
                      {s.nextCycleAt ? format(new Date(s.nextCycleAt), "dd MMM yyyy", { locale: ptBR }) : "—"}
                    </span>,
                    <span key="v" className="font-semibold text-slate-800">
                      {s.amount !== null ? formatBRL(s.amount) : "—"}
                    </span>,
                  ])}
                />
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ContatosGuruTab() {
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<GuruContact | null>(null);
  const summary = usePaymentContactsSummary();
  const { rows, total, loading } = usePaymentContactsPage(page, search);

  // Debounce curto: 180ms depois da última tecla já busca (a consulta usa
  // índices em lower(contact_email)/lower(email), fica rápida mesmo assim).
  // Sempre volta pra página 1 quando o termo muda (a página atual pode não
  // existir mais no resultado filtrado).
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 180);
    return () => clearTimeout(t);
  }, [searchInput]);

  const pageCount = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE));
  const firstOnPage = total === 0 ? 0 : page * CONTACTS_PAGE_SIZE + 1;
  const lastOnPage = Math.min(total, (page + 1) * CONTACTS_PAGE_SIZE);
  const contacts = summary?.contacts ?? total;
  const revenue = summary?.revenue ?? 0;

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Contatos</h1>
          <p className="text-xs text-slate-500">Todos os contatos da Guru (vendas e assinaturas), com histórico completo</p>
        </div>
        <GuruLiveBadge />
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Contatos" value={summary ? String(contacts) : "…"} />
        <KpiCard label="Receita total" value={summary ? formatBRL(revenue) : "…"} />
        <KpiCard label="Ticket por contato" value={summary ? formatBRL(contacts ? revenue / contacts : 0) : "…"} />
        <KpiCard label="Com assinatura ativa" value={summary ? String(summary.withSubs) : "…"} />
      </div>
      <div className="mb-3">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por nome, e-mail, telefone ou documento (CPF)..."
          className="h-8 max-w-sm text-xs"
        />
      </div>
      {total === 0 && !loading ? (
        <div className="rounded-xl border bg-white p-8 text-center text-xs text-slate-400">
          {search
            ? "Nenhum contato encontrado com esse termo."
            : "Nenhum contato ainda. Eles aparecem aqui conforme as vendas e assinaturas sincronizam da Guru."}
        </div>
      ) : (
        <>
          <div className={cn("transition-opacity", loading && "opacity-50")}>
            <MiniTable
              headers={["Contato", "E-mail", "Telefone", "Documento", "Compras", "Total gasto", "Assinaturas", "Última atividade"]}
              rows={rows.map((b) => [
                <button
                  key="n"
                  className="font-medium text-slate-800 hover:text-indigo-600 hover:underline"
                  onClick={() => setSelectedContact(b)}
                >
                  {b.name ?? b.email ?? "—"}
                </button>,
                <span key="e" className="text-slate-500">{b.email ?? "—"}</span>,
                <span key="p" className="text-slate-600">{b.phone ?? "—"}</span>,
                <span key="d" className="font-mono text-[11px] text-slate-600">{b.doc ?? "—"}</span>,
                <span key="c" className="text-slate-600">{b.purchases}</span>,
                <span key="t" className="font-semibold text-slate-800">{formatBRL(b.totalSpent)}</span>,
                <span key="s" className="text-slate-600">
                  {b.activeSubs > 0 ? (
                    <Badge className="bg-emerald-100 text-emerald-700">
                      {b.activeSubs} ativa{b.activeSubs > 1 ? "s" : ""}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </span>,
                <span key="a" className="text-slate-500">
                  {b.lastActivity ? format(new Date(b.lastActivity), "dd MMM yyyy", { locale: ptBR }) : "—"}
                </span>,
              ])}
            />
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[11px] text-slate-400">
              {firstOnPage}–{lastOnPage} de {total.toLocaleString("pt-BR")} contatos
            </p>
            <Pager page={page} pageCount={pageCount} onChange={setPage} />
          </div>
        </>
      )}
      <ContactDetailDialog contact={selectedContact} onClose={() => setSelectedContact(null)} />
    </>
  );
}

/* ------------------------------- Relatórios ------------------------------ */

const CHART_INDIGO = "#6366f1";
const CHART_INDIGO_ACTIVE = "#4338ca";
const SUB_COLORS = { ativa: "#10b981", atrasado: "#f59e0b", cancelado: "#ef4444", outro: "#94a3b8" };
const SUB_STATUS_LABELS = ["Ativas", "Atrasadas", "Canceladas", "Outras"] as const;
type SubStatusLabel = (typeof SUB_STATUS_LABELS)[number];

function csvEscape(v: string | number): string {
  return `"${String(v ?? "").replaceAll('"', '""')}"`;
}

/** Mesmo padrão de contatos/exportContactsCsv: ; como separador (Excel pt-BR), BOM UTF-8. */
function downloadCsv(filename: string, rows: (string | number)[][]) {
  const content = rows.map((r) => r.map(csvEscape).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function RelatoriosTab() {
  const { guru, loaded } = useGuruIntegration();
  if (!loaded) return null;
  return guru.connected ? (
    <RelatoriosGuruTab />
  ) : (
    <EmptyState
      icon={BarChart3}
      title="Relatórios"
      description="Conecte a Guru para ver receita por mês, os produtos que mais vendem e o estado das assinaturas."
    />
  );
}

function subStatusLabel(status: string | null): SubStatusLabel {
  const cat = classifyGuruStatus(status);
  if (cat === "aprovado") return "Ativas";
  if (cat === "atrasado") return "Atrasadas";
  if (cat === "cancelado" || cat === "expirado") return "Canceladas";
  return "Outras";
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      onClick={onClear}
      className="ml-2 inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-200"
    >
      {label} ✕
    </button>
  );
}

function RelatoriosGuruTab() {
  const salesReport = usePaymentSalesReport();
  const subscriptions = usePaymentSubscriptions();
  const [monthFilter, setMonthFilter] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<SubStatusLabel | null>(null);

  // Receita/produtos/ticket vêm de payment_sales_monthly (histórico
  // completo agregado no banco) em vez do array `usePaymentEvents` (só as
  // 100 vendas mais recentes) — com milhares de vendas desde 2024, os
  // últimos 6 meses sozinhos já passavam desse limite e os números do
  // relatório ficavam bem abaixo dos da Guru.
  const data = useMemo(() => {
    const approved = salesReport.rows.filter((r) => classifyGuruStatus(r.status) === "aprovado");
    const revenue = approved.reduce((s, r) => s + r.revenue, 0);
    const salesCount = approved.reduce((s, r) => s + r.salesCount, 0);

    // Receita dos últimos 6 meses — chave em "YYYY-MM" (ver monthKey) pra
    // casar com o mês UTC de `date_trunc` sem passar por conversão de fuso;
    // o label usa o mês local (só exibição, não afeta o agrupamento). Clicar
    // num produto em "Produtos que mais faturam" restringe esse gráfico só
    // às vendas daquele produto.
    const now = new Date();
    const months: { key: string; label: string; total: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: monthKey(d.toISOString()), label: format(d, "MMM/yy", { locale: ptBR }), total: 0 });
    }
    const idxByKey = new Map(months.map((m, i) => [m.key, i]));
    const monthsSource = productFilter ? approved.filter((r) => r.productName === productFilter) : approved;
    for (const r of monthsSource) {
      const idx = idxByKey.get(monthKey(r.month));
      if (idx !== undefined) months[idx].total += r.revenue;
    }

    // Top produtos por receita — clicar num mês no gráfico ao lado restringe
    // esta lista só às vendas daquele mês.
    const prodSource = monthFilter ? approved.filter((r) => monthKey(r.month) === monthFilter) : approved;
    const prod = new Map<string, number>();
    for (const r of prodSource) {
      prod.set(r.productName, (prod.get(r.productName) ?? 0) + r.revenue);
    }
    const topProducts = Array.from(prod.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
    const topMax = Math.max(1, ...topProducts.map((p) => p.total));

    // Assinaturas por status
    const subCounts = { Ativas: 0, Atrasadas: 0, Canceladas: 0, Outras: 0 };
    for (const s of subscriptions) subCounts[subStatusLabel(s.status)]++;
    const pie = [
      { name: "Ativas" as const, value: subCounts.Ativas, color: SUB_COLORS.ativa },
      { name: "Atrasadas" as const, value: subCounts.Atrasadas, color: SUB_COLORS.atrasado },
      { name: "Canceladas" as const, value: subCounts.Canceladas, color: SUB_COLORS.cancelado },
      { name: "Outras" as const, value: subCounts.Outras, color: SUB_COLORS.outro },
    ].filter((d) => d.value > 0);

    return {
      revenue,
      salesCount,
      ticket: salesCount ? revenue / salesCount : 0,
      activeSubs: subCounts.Ativas,
      months,
      topProducts,
      topMax,
      pie,
    };
  }, [salesReport.rows, subscriptions, monthFilter, productFilter]);

  const filteredSubs = useMemo(
    () => (statusFilter ? subscriptions.filter((s) => subStatusLabel(s.status) === statusFilter) : []),
    [subscriptions, statusFilter]
  );

  const monthFilterLabel = monthFilter ? data.months.find((m) => m.key === monthFilter)?.label ?? monthFilter : null;

  function handleExportCsv() {
    const rows: (string | number)[][] = [
      ["Relatório de Pagamentos — Guru"],
      [`Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}`],
      [],
      ["Receita aprovada", formatBRL(data.revenue)],
      ["Vendas aprovadas", data.salesCount],
      ["Ticket médio", formatBRL(data.ticket)],
      ["Assinaturas ativas", data.activeSubs],
      [],
      [productFilter ? `Receita por mês — ${productFilter}` : "Receita por mês"],
      ["Mês", "Receita"],
      ...data.months.map((m) => [m.label, formatBRL(m.total)]),
      [],
      [monthFilterLabel ? `Produtos que mais faturam — ${monthFilterLabel}` : "Produtos que mais faturam"],
      ["Produto", "Receita"],
      ...data.topProducts.map((p) => [p.name, formatBRL(p.total)]),
      [],
      ["Assinaturas por status"],
      ["Status", "Quantidade"],
      ...data.pie.map((d) => [d.name, d.value]),
    ];
    downloadCsv(`relatorio-pagamentos-guru-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success("Relatório exportado em CSV");
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Relatórios</h1>
          <p className="text-xs text-slate-500">
            Consolidado de vendas e assinaturas da Guru — clique num mês, produto ou status pra filtrar
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GuruLiveBadge />
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleExportCsv}>
            <Download className="size-3.5" />
            Exportar CSV
          </Button>
        </div>
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Receita aprovada" value={formatBRL(data.revenue)} />
        <KpiCard label="Vendas aprovadas" value={String(data.salesCount)} />
        <KpiCard label="Ticket médio" value={formatBRL(data.ticket)} />
        <KpiCard label="Assinaturas ativas" value={String(data.activeSubs)} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border bg-white p-4 lg:col-span-2">
          <p className="mb-3 flex items-center text-xs font-semibold text-slate-700">
            Receita por mês (aprovadas)
            {productFilter && <FilterChip label={productFilter} onClear={() => setProductFilter(null)} />}
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.months} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                width={64}
                tickFormatter={(v) => formatBRL(Number(v)).replace(/\s?R\$\s?/, "R$")}
              />
              <RTooltip
                formatter={(v) => formatBRL(Number(v))}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
              />
              <Bar
                dataKey="total"
                radius={[4, 4, 0, 0]}
                style={{ cursor: "pointer" }}
                onClick={(entry: any) => setMonthFilter((cur) => (cur === entry.key ? null : entry.key))}
              >
                {data.months.map((m) => (
                  <Cell key={m.key} fill={m.key === monthFilter ? CHART_INDIGO_ACTIVE : CHART_INDIGO} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <p className="mb-3 text-xs font-semibold text-slate-700">Assinaturas por status</p>
          {data.pie.length === 0 ? (
            <p className="py-12 text-center text-xs text-slate-400">Sem assinaturas ainda.</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={data.pie} dataKey="value" nameKey="name" innerRadius={44} outerRadius={70} paddingAngle={2}>
                    {data.pie.map((d) => (
                      <Cell
                        key={d.name}
                        fill={d.color}
                        style={{ cursor: "pointer" }}
                        opacity={statusFilter && statusFilter !== d.name ? 0.35 : 1}
                        onClick={() => setStatusFilter((cur) => (cur === d.name ? null : d.name))}
                      />
                    ))}
                  </Pie>
                  <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1">
                {data.pie.map((d) => (
                  <button
                    key={d.name}
                    onClick={() => setStatusFilter((cur) => (cur === d.name ? null : d.name))}
                    className={cn(
                      "flex w-full items-center justify-between rounded px-1 py-0.5 text-[11px] hover:bg-slate-50",
                      statusFilter === d.name && "bg-indigo-50"
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span className="size-2 rounded-full" style={{ background: d.color }} />
                      {d.name}
                    </span>
                    <span className="font-medium text-slate-800">{d.value}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="mt-3 rounded-xl border bg-white p-4">
        <p className="mb-3 flex items-center text-xs font-semibold text-slate-700">
          Produtos que mais faturam
          {monthFilterLabel && <FilterChip label={monthFilterLabel} onClear={() => setMonthFilter(null)} />}
        </p>
        {data.topProducts.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-400">Nenhuma venda aprovada ainda.</p>
        ) : (
          <div className="space-y-2">
            {data.topProducts.map((p) => (
              <button
                key={p.name}
                onClick={() => setProductFilter((cur) => (cur === p.name ? null : p.name))}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-1 py-0.5 hover:bg-slate-50",
                  productFilter === p.name && "bg-indigo-50"
                )}
              >
                <span className="w-40 shrink-0 truncate text-left text-xs text-slate-700" title={p.name}>{p.name}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                  <div className="h-full rounded bg-indigo-500" style={{ width: `${(p.total / data.topMax) * 100}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right text-xs font-semibold text-slate-800">{formatBRL(p.total)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {statusFilter && (
        <div className="mt-3 rounded-xl border bg-white p-4">
          <p className="mb-3 flex items-center text-xs font-semibold text-slate-700">
            Assinaturas {statusFilter.toLowerCase()}
            <FilterChip label={statusFilter} onClear={() => setStatusFilter(null)} />
          </p>
          {filteredSubs.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">Nenhuma assinatura encontrada.</p>
          ) : (
            <>
              <MiniTable
                headers={["Contato", "Produto", "Status", "Próxima cobrança", "Valor"]}
                rows={filteredSubs.slice(0, 50).map((s) => [
                  <span key="c" className="text-slate-700">{s.contactName ?? s.contactEmail ?? "—"}</span>,
                  <span key="p" className="text-slate-600">{s.productName ?? "—"}</span>,
                  <GuruStatusBadge key="s" status={s.status} />,
                  <span key="n" className="text-slate-500">
                    {s.nextCycleAt ? format(new Date(s.nextCycleAt), "dd MMM yyyy", { locale: ptBR }) : "—"}
                  </span>,
                  <span key="v" className="font-semibold text-slate-800">
                    {s.amount !== null ? formatBRL(s.amount) : "—"}
                  </span>,
                ])}
              />
              {filteredSubs.length > 50 && (
                <p className="mt-2 text-[11px] text-slate-400">Mostrando 50 de {filteredSubs.length} assinaturas.</p>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

/* -------------------------------- Placeholders ---------------------------- */

function LeadsTab() {
  return (
    <EmptyState
      icon={UserPlus}
      title="Leads"
      description="A API pública da Guru não expõe um recurso de leads separado — só de contatos (quem já comprou aparece na aba Contatos). Esta aba fica reservada para quando decidirmos puxar todos os contatos capturados da Guru (incl. quem ainda não comprou)."
    />
  );
}

function RPPCTab() {
  return (
    <EmptyState
      icon={Radar}
      title="R.P.P.C."
      description="Rastreamento de campanhas, checkouts, grupos e custo de tráfego da Guru — o domínio mais complexo dos que faltam, com vários sub-recursos na API. Ainda não construído."
    />
  );
}

/* -------------------------- Arquivos e contratos ------------------------- */

function formatBytes(n: number | null): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const FILE_ACCEPT = [
  ".pdf",
  ".docx",
  ...ALLOWED_FILES.map((a) => a.mime),
].join(",");

function ArquivosTab() {
  const { files, ready } = usePaymentFiles();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    const res = await paymentFilesActions.upload(file);
    setBusy(false);
    if (res.ok) toast.success("Arquivo enviado");
    else toast.error(res.error ?? "Falha no upload");
  };

  const onDownload = async (f: PaymentFile) => {
    const url = await paymentFilesActions.signedUrl(f.path);
    if (url) window.open(url, "_blank", "noopener");
    else toast.error("Não foi possível gerar o link de download");
  };

  const onDelete = async (f: PaymentFile) => {
    if (!window.confirm(`Excluir "${f.name}"? Essa ação não pode ser desfeita.`)) return;
    const ok = await paymentFilesActions.remove(f.id, f.path);
    if (ok) toast.success("Arquivo excluído");
    else toast.error("Não foi possível excluir");
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Arquivos e contratos</h1>
          <p className="text-xs text-slate-500">Guarde contratos e propostas em PDF ou DOCX (até 15 MB)</p>
        </div>
        <input ref={inputRef} type="file" accept={FILE_ACCEPT} className="hidden" onChange={onFile} />
        <Button size="sm" className="h-8 text-xs" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? (
            <><Loader2 className="mr-1.5 size-3.5 animate-spin" /> Enviando...</>
          ) : (
            <><Upload className="mr-1.5 size-3.5" /> Enviar arquivo</>
          )}
        </Button>
      </div>
      {!ready ? (
        <div className="rounded-xl border bg-white p-8 text-center text-xs text-slate-400">Carregando arquivos...</div>
      ) : files.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhum arquivo ainda"
          description="Envie contratos e propostas em PDF ou DOCX. Ficam guardados com segurança, visíveis só para a sua empresa."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-[11px] text-slate-400">
                <th className="px-4 py-2.5 font-medium">Arquivo</th>
                <th className="px-4 py-2.5 font-medium">Tipo</th>
                <th className="px-4 py-2.5 font-medium">Tamanho</th>
                <th className="px-4 py-2.5 font-medium">Enviado em</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2 font-medium text-slate-800">
                      <FileText className="size-4 shrink-0 text-slate-400" />
                      <span className="truncate">{f.name}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="secondary" className="bg-slate-100 text-slate-600">
                      {f.name.toLowerCase().endsWith(".docx") ? "DOCX" : "PDF"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{formatBytes(f.size)}</td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {format(new Date(f.createdAt), "dd MMM yyyy, HH:mm", { locale: ptBR })}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => onDownload(f)}
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        title="Baixar"
                      >
                        <Download className="size-4" />
                      </button>
                      <button
                        onClick={() => onDelete(f)}
                        className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                        title="Excluir"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ---------------------------------- Page --------------------------------- */

export default function PagamentosPage() {
  const [tab, setTab] = useState("Integrações");

  return (
    <div>
      <SubNav tabs={TABS} active={tab} onChange={setTab} />
      <div className="p-6">
        {tab === "Integrações" ? (
          <>
            <div className="mb-4">
              <h1 className="text-lg font-bold text-slate-900">Integrações de pagamento</h1>
              <p className="text-xs text-slate-500">
                A Guru é a central de pagamentos do CRM — vendas e assinaturas vêm daqui.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <GuruProviderCard />
            </div>
          </>
        ) : tab === "Arquivos e contratos" ? (
          <ArquivosTab />
        ) : tab === "Vendas" ? (
          <TransacoesTab />
        ) : tab === "Assinaturas" ? (
          <AssinaturasTab />
        ) : tab === "Contatos" ? (
          <ContatosTab />
        ) : tab === "Leads" ? (
          <LeadsTab />
        ) : tab === "Produtos" ? (
          <ProdutosTab />
        ) : tab === "R.P.P.C." ? (
          <RPPCTab />
        ) : (
          <RelatoriosTab />
        )}
      </div>
    </div>
  );
}
