"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BadgeCheck,
  CreditCard,
  ExternalLink,
  Repeat,
  ShieldQuestion,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GuruStatusBadge } from "@/components/payments/status-badge";
import {
  attemptedKeys,
  guruDoc,
  isStrongMatch,
  linkDocToContact,
  MATCH_KEY_LABEL,
  useLeadPaymentProfile,
  type LeadPaymentProfile,
  type LeadSale,
  type LeadSubscription,
} from "@/lib/data/repos/db/lead-payments";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { formatBRL } from "@/lib/data/repos/opportunities";
import type { Contact } from "@/lib/data/types";

/**
 * Painel do histórico de compra na Guru do MESMO comprador (cruzado por
 * CPF → telefone → e-mail → nome, migração 0048). Antes só existia dentro do
 * detalhe do lead; agora é reaproveitado no cadastro do contato.
 */

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-1.5 last:border-0">
      <dt className="shrink-0 text-[11px] text-slate-500">{label}</dt>
      <dd className="min-w-0 truncate text-right text-xs font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-slate-900">{value}</p>
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

const fmtDate = (v: string | null | undefined, withTime = false) =>
  v
    ? format(new Date(v), withTime ? "dd/MM/yyyy HH:mm" : "dd/MM/yyyy", { locale: ptBR })
    : "—";

/** Documento só de dígitos vindo da Guru fica ilegível; formata CPF/CNPJ. */
export function formatDoc(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return raw?.trim() || "—";
}

/** Linha de detalhe que NÃO trunca (código de transação precisa aparecer inteiro). */
function DetailLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-1.5 last:border-0">
      <span className="shrink-0 text-[11px] text-slate-500">{label}</span>
      <span className="min-w-0 break-all text-right text-xs font-medium text-slate-800">{value}</span>
    </div>
  );
}

/** Detalhes de uma compra (venda), abre ao clicar na linha. */
function SaleDialog({ sale, onClose }: { sale: LeadSale | null; onClose: () => void }) {
  return (
    <Dialog open={!!sale} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Detalhes da compra</DialogTitle>
        </DialogHeader>
        {sale && (
          <div>
            <div className="mb-2">
              <GuruStatusBadge status={sale.status} />
            </div>
            <DetailLine label="Produto" value={sale.productName ?? "—"} />
            <DetailLine label="Valor" value={sale.amount === null ? "—" : formatBRL(sale.amount)} />
            <DetailLine label="Código" value={sale.code ?? "—"} />
            <DetailLine label="Data da compra" value={fmtDate(sale.guruCreatedAt, true)} />
            <DetailLine label="Recebido em" value={fmtDate(sale.receivedAt, true)} />
            <p className="mb-1 mt-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Comprador na Guru
            </p>
            <DetailLine label="Nome" value={sale.contactName ?? "—"} />
            <DetailLine label="E-mail" value={sale.contactEmail ?? "—"} />
            <DetailLine label="CPF/CNPJ" value={formatDoc(sale.contactDoc)} />
            <DetailLine label="Telefone" value={sale.contactPhone ?? "—"} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Detalhes de uma assinatura. */
function SubDialog({ sub, onClose }: { sub: LeadSubscription | null; onClose: () => void }) {
  return (
    <Dialog open={!!sub} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Detalhes da assinatura</DialogTitle>
        </DialogHeader>
        {sub && (
          <div>
            <div className="mb-2">
              <GuruStatusBadge status={sub.status} />
            </div>
            <DetailLine label="Produto" value={sub.productName ?? "—"} />
            <DetailLine label="Valor" value={sub.amount === null ? "—" : formatBRL(sub.amount)} />
            <DetailLine label="Código" value={sub.code ?? "—"} />
            <DetailLine
              label="Cobranças"
              value={`${sub.chargedTimes ?? 0}${sub.chargedEveryDays ? ` · a cada ${sub.chargedEveryDays} dias` : ""}`}
            />
            <DetailLine label="Início" value={fmtDate(sub.guruStartedAt, true)} />
            <DetailLine label="Próximo ciclo" value={fmtDate(sub.nextCycleAt)} />
            <DetailLine label="Atualizado em" value={fmtDate(sub.guruUpdatedAt, true)} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Casamento por NOME não grava o documento sozinho (homônimo existe) — aqui a
 * pessoa confirma. Nas chaves fortes o vínculo já aconteceu sem perguntar, e
 * este bloco nem aparece.
 */
function LinkDocButton({
  contact,
  profile,
}: {
  contact: Contact;
  profile: LeadPaymentProfile;
}) {
  const [busy, setBusy] = useState(false);
  const doc = guruDoc(profile);
  if (contact.doc?.trim() || !doc || isStrongMatch(profile)) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
      <p className="text-[11px] text-amber-900">
        A Guru tem o documento <strong>{formatDoc(doc)}</strong> para este comprador. Como o
        casamento saiu pelo nome, confirme que é a mesma pessoa antes de vincular.
      </p>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const saved = await linkDocToContact(contact.id, doc);
          setBusy(false);
          if (saved) toast.success("CPF/CNPJ vinculado ao contato");
          else toast.error("Não foi possível vincular o documento");
        }}
        className="mt-1.5 rounded-md bg-amber-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
      >
        {busy ? "Vinculando..." : "Vincular ao contato"}
      </button>
    </div>
  );
}

/** Rendering puro do perfil de pagamento (recebe o profile já carregado). */
export function PaymentsProfileView({
  contact,
  profile,
  loading,
  error,
}: {
  contact: Contact;
  profile: LeadPaymentProfile;
  loading: boolean;
  error: string | null;
}) {
  const [saleDetail, setSaleDetail] = useState<LeadSale | null>(null);
  const [subDetail, setSubDetail] = useState<LeadSubscription | null>(null);
  const totals = profile.totals;

  if (loading) {
    return <p className="p-6 text-center text-xs text-slate-400">Cruzando com a Guru…</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-xs font-semibold text-amber-900">Não foi possível cruzar</p>
        <p className="mt-1 text-[11px] text-amber-800">{error}</p>
      </div>
    );
  }

  if (!profile.matchKey) {
    const tried = attemptedKeys(contact);
    return (
      <div className="rounded-lg border bg-slate-50 p-5 text-center">
        <ShieldQuestion className="mx-auto size-6 text-slate-300" />
        <p className="mt-2 text-xs font-semibold text-slate-700">
          Nenhuma compra encontrada na Guru para este contato
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          {tried.length > 0
            ? `Tentamos casar por ${tried.map((k) => MATCH_KEY_LABEL[k]).join(", ")}.`
            : "O contato não tem CPF, telefone, e-mail nem nome para casar."}
        </p>
        {!contact.doc?.trim() && (
          <p className="mt-2 text-[11px] text-slate-500">
            O CPF/CNPJ é a chave mais confiável — preencha no cadastro do contato para melhorar o
            cruzamento.
          </p>
        )}
      </div>
    );
  }

  const g = profile.guruContact;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1 bg-indigo-100 text-indigo-700">
          <BadgeCheck className="size-3" />
          Casado por {MATCH_KEY_LABEL[profile.matchKey]}
        </Badge>
        {profile.matchKey === "name" && (
          <span className="text-[10px] text-amber-700">
            Chave fraca — confirme que não é homônimo antes de agir sobre esses dados.
          </span>
        )}
      </div>

      <LinkDocButton contact={contact} profile={profile} />

      <div className="grid gap-2 sm:grid-cols-4">
        <Kpi
          label="Total aprovado"
          value={formatBRL(totals?.approvedTotal ?? 0)}
          hint={`${totals?.approvedCount ?? 0} venda(s) aprovada(s)`}
        />
        <Kpi
          label="Vendas"
          value={String(totals?.salesCount ?? 0)}
          hint={`1ª em ${fmtDate(totals?.firstSaleAt)}`}
        />
        <Kpi
          label="Assinaturas ativas"
          value={String(totals?.activeSubs ?? 0)}
          hint={`${profile.subscriptions.length} no total`}
        />
        <Kpi
          label="Reembolsos"
          value={formatBRL(totals?.refundedTotal ?? 0)}
          hint={`${totals?.refundedCount ?? 0} ocorrência(s)`}
        />
      </div>

      {g && (
        <div className="rounded-lg border bg-white p-3">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Contato na Guru
          </p>
          <dl className="grid gap-x-6 sm:grid-cols-2">
            <DataRow label="Nome" value={g.name ?? "—"} />
            <DataRow label="CPF/CNPJ" value={formatDoc(g.doc)} />
            <DataRow label="E-mail" value={g.email ?? "—"} />
            <DataRow label="Telefone" value={g.phone ?? "—"} />
          </dl>
        </div>
      )}

      <div>
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <CreditCard className="size-3.5 text-slate-400" /> Vendas
          {profile.sales.length > 0 && (
            <span className="text-[10px] font-normal text-slate-400">
              ({profile.sales.length}
              {(totals?.salesCount ?? 0) > profile.sales.length ? ` de ${totals?.salesCount}` : ""})
            </span>
          )}
        </p>
        {profile.sales.length === 0 ? (
          <p className="rounded-lg border bg-slate-50 p-3 text-[11px] text-slate-500">
            Nenhuma venda registrada.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase text-slate-400">
                <tr>
                  <th className="px-2 py-1.5 font-bold">Produto</th>
                  <th className="px-2 py-1.5 font-bold">Status</th>
                  <th className="px-2 py-1.5 text-right font-bold">Valor</th>
                  <th className="px-2 py-1.5 font-bold">Data</th>
                </tr>
              </thead>
              <tbody>
                {profile.sales.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSaleDetail(s)}
                    title="Ver detalhes da compra"
                    className="cursor-pointer border-t hover:bg-slate-50"
                  >
                    <td className="max-w-[220px] truncate px-2 py-1.5 text-slate-700">
                      {s.productName ?? "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <GuruStatusBadge status={s.status} />
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold text-slate-800">
                      {s.amount === null ? "—" : formatBRL(s.amount)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                      {fmtDate(s.guruCreatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <Repeat className="size-3.5 text-slate-400" /> Assinaturas
        </p>
        {profile.subscriptions.length === 0 ? (
          <p className="rounded-lg border bg-slate-50 p-3 text-[11px] text-slate-500">
            Nenhuma assinatura.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {profile.subscriptions.map((s) => (
              <li
                key={s.id}
                onClick={() => setSubDetail(s)}
                title="Ver detalhes da assinatura"
                className="cursor-pointer rounded-lg border bg-white p-2.5 hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">
                    {s.productName ?? "—"}
                  </span>
                  <GuruStatusBadge status={s.status} />
                </div>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {s.amount === null ? "" : `${formatBRL(s.amount)} · `}
                  {s.chargedTimes ?? 0} cobrança(s)
                  {s.chargedEveryDays ? ` a cada ${s.chargedEveryDays} dias` : ""} · início{" "}
                  {fmtDate(s.guruStartedAt)}
                  {s.nextCycleAt ? ` · próximo ciclo ${fmtDate(s.nextCycleAt)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <SaleDialog sale={saleDetail} onClose={() => setSaleDetail(null)} />
      <SubDialog sub={subDetail} onClose={() => setSubDetail(null)} />
    </div>
  );
}

/**
 * Link para a aba Contatos de Pagamentos já buscando este comprador. Prefere o
 * e-mail (é o que identifica sem ambiguidade); cai no nome quando não há.
 */
export function paymentsDeepLink(
  contact: Contact,
  profile: LeadPaymentProfile,
): string {
  const termo =
    profile.guruContact?.email?.trim() ||
    contact.email?.trim() ||
    profile.guruContact?.name?.trim() ||
    `${contact.firstName} ${contact.lastName}`.trim();
  return `/pagamentos?tab=Contatos&busca=${encodeURIComponent(termo)}`;
}

/**
 * Versão ENXUTA para a barra lateral da caixa de entrada (~300 px): assinaturas
 * e as 3 compras mais recentes, com atalho para o histórico completo. A visão
 * larga (`PaymentsProfileView`) não cabe aqui — a grade de 4 KPIs e a tabela de
 * 4 colunas viram um amontoado ilegível nessa largura.
 *
 * Devolve `null` sem permissão de Pagamentos: a aba nem chega a existir para
 * quem não enxerga o módulo.
 */
export function ContactPaymentsSummary({
  contact,
  maxSales = 3,
}: {
  contact: Contact;
  maxSales?: number;
}) {
  const { can } = useMyMembership();
  const canPayments = can("pagamentos");
  const { profile, loading, error } = useLeadPaymentProfile(contact, canPayments);

  if (!canPayments) return null;

  if (loading) {
    return <p className="py-2 text-[11px] text-slate-400">Cruzando com a Guru…</p>;
  }

  if (error) {
    return <p className="py-2 text-[11px] text-amber-700">{error}</p>;
  }

  if (!profile.matchKey) {
    const tried = attemptedKeys(contact);
    return (
      <div className="py-1">
        <p className="text-[11px] text-slate-500">Nenhuma compra encontrada na Guru.</p>
        <p className="mt-1 text-[10px] text-slate-400">
          {tried.length > 0
            ? `Tentamos casar por ${tried.map((k) => MATCH_KEY_LABEL[k]).join(", ")}.`
            : "Sem CPF, telefone, e-mail ou nome para casar."}
        </p>
      </div>
    );
  }

  const totals = profile.totals;
  const sales = profile.sales.slice(0, maxSales);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant="secondary" className="gap-1 bg-indigo-100 text-[10px] text-indigo-700">
          <BadgeCheck className="size-2.5" />
          Casado por {MATCH_KEY_LABEL[profile.matchKey]}
        </Badge>
      </div>

      <LinkDocButton contact={contact} profile={profile} />

      <div className="rounded-lg border bg-slate-50 p-2">
        <p className="text-[10px] text-slate-400">Total aprovado</p>
        <p className="text-sm font-bold text-slate-900">
          {formatBRL(totals?.approvedTotal ?? 0)}
        </p>
        <p className="text-[10px] text-slate-400">
          {totals?.approvedCount ?? 0} de {totals?.salesCount ?? 0} venda(s)
        </p>
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          <Repeat className="size-3" /> Assinaturas
        </p>
        {profile.subscriptions.length === 0 ? (
          <p className="text-[11px] text-slate-400">Nenhuma assinatura.</p>
        ) : (
          <ul className="space-y-1">
            {profile.subscriptions.map((s) => (
              <li key={s.id} className="rounded-md border bg-white p-1.5">
                <div className="flex items-start justify-between gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-800">
                    {s.productName ?? "—"}
                  </span>
                  <GuruStatusBadge status={s.status} />
                </div>
                {s.nextCycleAt && (
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    Próximo ciclo {fmtDate(s.nextCycleAt)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          <CreditCard className="size-3" /> Últimas compras
        </p>
        {sales.length === 0 ? (
          <p className="text-[11px] text-slate-400">Nenhuma venda registrada.</p>
        ) : (
          <ul className="space-y-1">
            {sales.map((s) => (
              <li key={s.id} className="rounded-md border bg-white p-1.5">
                <p className="truncate text-[11px] font-medium text-slate-800">
                  {s.productName ?? "—"}
                </p>
                <div className="mt-0.5 flex items-center justify-between gap-1.5">
                  <span className="text-[10px] text-slate-400">{fmtDate(s.guruCreatedAt)}</span>
                  <span className="text-[11px] font-semibold text-slate-700">
                    {s.amount === null ? "—" : formatBRL(s.amount)}
                  </span>
                </div>
                <div className="mt-0.5">
                  <GuruStatusBadge status={s.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link
        href={paymentsDeepLink(contact, profile)}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline"
      >
        Ver detalhes completos <ExternalLink className="size-3" />
      </Link>
    </div>
  );
}

/**
 * Painel pronto pro cadastro do contato: cuida da permissão (só quem vê
 * Pagamentos) e do cruzamento. Renderiza um card com título; nulo sem permissão.
 */
export function ContactPaymentsPanel({ contact }: { contact: Contact }) {
  const { can } = useMyMembership();
  const canPayments = can("pagamentos");
  const { profile, loading, error } = useLeadPaymentProfile(contact, canPayments);
  if (!canPayments) return null;
  return (
    <div className="rounded-xl border bg-white p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <CreditCard className="size-4 text-slate-400" /> Pagamentos (Guru)
      </h2>
      <PaymentsProfileView contact={contact} profile={profile} loading={loading} error={error} />
    </div>
  );
}
