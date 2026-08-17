"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Contact } from "@/lib/data/types";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Perfil de pagamento de um lead: o mesmo comprador visto do lado da Guru.
 *
 * Todo o casamento acontece no banco, em `public.lead_payment_profile`
 * (migração 0048) — CPF/CNPJ → telefone → e-mail → nome, a primeira chave que
 * acha algo ganha. Fazer isso aqui obrigaria uma ida e volta por chave e abriria
 * a porta para o rótulo ("casou por telefone") vir de uma consulta e as vendas
 * de outra.
 */

export type LeadMatchKey = "doc" | "phone" | "email" | "name";

export const MATCH_KEY_LABEL: Record<LeadMatchKey, string> = {
  doc: "CPF/CNPJ",
  phone: "telefone",
  email: "e-mail",
  name: "nome",
};

export interface LeadGuruContact {
  externalId: string;
  name: string | null;
  email: string | null;
  doc: string | null;
  phone: string | null;
  guruCreatedAt: string | null;
  guruUpdatedAt: string | null;
}

export interface LeadSale {
  id: string;
  code: string | null;
  status: string | null;
  amount: number | null;
  currency: string;
  productName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactDoc: string | null;
  contactPhone: string | null;
  guruCreatedAt: string | null;
  receivedAt: string | null;
}

export interface LeadSubscription {
  id: string;
  code: string | null;
  status: string | null;
  amount: number | null;
  currency: string;
  productName: string | null;
  chargedTimes: number | null;
  chargedEveryDays: number | null;
  nextCycleAt: string | null;
  guruStartedAt: string | null;
  guruUpdatedAt: string | null;
}

export interface LeadPaymentTotals {
  approvedCount: number;
  approvedTotal: number;
  refundedCount: number;
  refundedTotal: number;
  salesCount: number;
  activeSubs: number;
  firstSaleAt: string | null;
  lastSaleAt: string | null;
}

export interface LeadPaymentProfile {
  matchKey: LeadMatchKey | null;
  guruContact: LeadGuruContact | null;
  sales: LeadSale[];
  subscriptions: LeadSubscription[];
  totals: LeadPaymentTotals | null;
}

const EMPTY: LeadPaymentProfile = {
  matchKey: null,
  guruContact: null,
  sales: [],
  subscriptions: [],
  totals: null,
};

function mapProfile(payload: any): LeadPaymentProfile {
  const g = payload?.guru_contact;
  const t = payload?.totals;
  return {
    matchKey: (payload?.match_key ?? null) as LeadMatchKey | null,
    guruContact: g
      ? {
          externalId: g.external_id,
          name: g.name ?? null,
          email: g.email ?? null,
          doc: g.doc ?? null,
          phone: g.phone ?? null,
          guruCreatedAt: g.guru_created_at ?? null,
          guruUpdatedAt: g.guru_updated_at ?? null,
        }
      : null,
    sales: (payload?.sales ?? []).map((s: any) => ({
      id: s.id,
      code: s.code ?? null,
      status: s.status ?? null,
      amount: s.amount === null || s.amount === undefined ? null : Number(s.amount),
      currency: s.currency ?? "BRL",
      productName: s.product_name ?? null,
      contactName: s.contact_name ?? null,
      contactEmail: s.contact_email ?? null,
      contactDoc: s.contact_doc ?? null,
      contactPhone: s.contact_phone ?? null,
      guruCreatedAt: s.guru_created_at ?? null,
      receivedAt: s.received_at ?? null,
    })),
    subscriptions: (payload?.subscriptions ?? []).map((s: any) => ({
      id: s.id,
      code: s.code ?? null,
      status: s.status ?? null,
      amount: s.amount === null || s.amount === undefined ? null : Number(s.amount),
      currency: s.currency ?? "BRL",
      productName: s.product_name ?? null,
      chargedTimes: s.charged_times ?? null,
      chargedEveryDays: s.charged_every_days ?? null,
      nextCycleAt: s.next_cycle_at ?? null,
      guruStartedAt: s.guru_started_at ?? null,
      guruUpdatedAt: s.guru_updated_at ?? null,
    })),
    totals: t
      ? {
          approvedCount: Number(t.approved_count ?? 0),
          approvedTotal: Number(t.approved_total ?? 0),
          refundedCount: Number(t.refunded_count ?? 0),
          refundedTotal: Number(t.refunded_total ?? 0),
          salesCount: Number(t.sales_count ?? 0),
          activeSubs: Number(t.active_subs ?? 0),
          firstSaleAt: t.first_sale_at ?? null,
          lastSaleAt: t.last_sale_at ?? null,
        }
      : null,
  };
}

/** Chaves que serão tentadas — a tela mostra isso quando nada casa. */
export function attemptedKeys(contact: Contact | null | undefined): LeadMatchKey[] {
  if (!contact) return [];
  const keys: LeadMatchKey[] = [];
  if (contact.doc?.trim()) keys.push("doc");
  if (contact.phone?.trim()) keys.push("phone");
  if (contact.email?.trim()) keys.push("email");
  if (`${contact.firstName} ${contact.lastName}`.trim()) keys.push("name");
  return keys;
}

export function useLeadPaymentProfile(contact: Contact | null | undefined, enabled = true) {
  const [profile, setProfile] = useState<LeadPaymentProfile>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doc = contact?.doc?.trim() ?? "";
  const phone = contact?.phone?.trim() ?? "";
  const email = contact?.email?.trim() ?? "";
  const name = contact ? `${contact.firstName} ${contact.lastName}`.trim() : "";

  useEffect(() => {
    if (!enabled || (!doc && !phone && !email && !name)) {
      setProfile(EMPTY);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      await useDbStore.getState().load();
      const loc = useDbStore.getState().locationId;
      if (!loc) {
        if (active) {
          setProfile(EMPTY);
          setLoading(false);
        }
        return;
      }
      const supabase = createClient();
      const { data, error: err } = await supabase.rpc("lead_payment_profile", {
        p_location: loc,
        p_doc: doc || null,
        p_phone: phone || null,
        p_email: email || null,
        p_name: name || null,
        p_limit: 200,
      });
      if (!active) return;
      if (err) {
        // 42883 = função não existe (migração 0048 não aplicada). Dizer isso na
        // tela é melhor do que mostrar "sem histórico" para um cliente que compra.
        setError(
          err.code === "42883"
            ? "Cruzamento indisponível — migração 0048 ainda não aplicada no banco."
            : err.message
        );
        setProfile(EMPTY);
        setLoading(false);
        return;
      }
      setProfile(mapProfile(data));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [enabled, doc, phone, email, name]);

  return { profile, loading, error };
}
