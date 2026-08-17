"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { BadgeCheck, CreditCard, Repeat, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { GuruStatusBadge } from "@/components/payments/status-badge";
import {
  attemptedKeys,
  MATCH_KEY_LABEL,
  useLeadPaymentProfile,
  type LeadPaymentProfile,
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
function formatDoc(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return raw?.trim() || "—";
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
                  <tr key={s.id} className="border-t">
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
              <li key={s.id} className="rounded-lg border bg-white p-2.5">
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
