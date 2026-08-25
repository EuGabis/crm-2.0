"use client";

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { classifyGuruStatus } from "@/lib/data/guru";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface GuruCredential {
  connected: boolean;
  apiKey: string;
  webhookToken: string;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  historyBackfillCursor: string | null;
  historyBackfillDone: boolean;
}

export interface PaymentEvent {
  id: string;
  provider: string;
  externalId: string | null;
  code: string | null;
  eventType: string | null;
  status: string | null;
  amount: number | null;
  currency: string;
  contactName: string | null;
  contactEmail: string | null;
  productName: string | null;
  raw: Record<string, unknown>;
  receivedAt: string;
  guruCreatedAt: string | null;
  guruUpdatedAt: string | null;
}

export interface PaymentSubscription {
  id: string;
  provider: string;
  externalId: string;
  code: string | null;
  status: string | null;
  amount: number | null;
  currency: string;
  contactName: string | null;
  contactEmail: string | null;
  productName: string | null;
  raw: Record<string, unknown>;
  updatedAt: string;
  guruStartedAt: string | null;
  guruUpdatedAt: string | null;
  chargedTimes: number | null;
  chargedEveryDays: number | null;
  nextCycleAt: string | null;
}

const EMPTY_GURU: GuruCredential = {
  connected: false,
  apiKey: "",
  webhookToken: "",
  connectedAt: null,
  lastSyncedAt: null,
  historyBackfillCursor: null,
  historyBackfillDone: false,
};

/**
 * Estado da integração para quem NÃO é admin: mesma forma do crédito, mas sem
 * token nenhum — a view da 0036 não expõe api_key/webhook_token.
 */
function mapGuruStatus(row: any): GuruCredential {
  return {
    connected: true,
    apiKey: "",
    webhookToken: "",
    connectedAt: row.connected_at ?? null,
    lastSyncedAt: row.last_synced_at ?? null,
    historyBackfillCursor: row.history_backfill_cursor ?? null,
    historyBackfillDone: row.history_backfill_done ?? false,
  };
}

function mapGuruCredential(row: any): GuruCredential {
  return {
    connected: true,
    apiKey: row.api_key ?? "",
    webhookToken: row.webhook_token,
    connectedAt: row.created_at,
    lastSyncedAt: row.last_synced_at ?? null,
    historyBackfillCursor: row.history_backfill_cursor ?? null,
    historyBackfillDone: row.history_backfill_done ?? false,
  };
}

function mapPaymentEvent(row: any): PaymentEvent {
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.external_id,
    code: row.code ?? null,
    eventType: row.event_type,
    status: row.status,
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
    currency: row.currency ?? "BRL",
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    productName: row.product_name,
    raw: row.raw ?? {},
    receivedAt: row.received_at,
    guruCreatedAt: row.guru_created_at ?? null,
    guruUpdatedAt: row.guru_updated_at ?? null,
  };
}

function mapPaymentSubscription(row: any): PaymentSubscription {
  return {
    id: row.id,
    provider: row.provider,
    externalId: row.external_id,
    code: row.code ?? null,
    status: row.status,
    amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
    currency: row.currency ?? "BRL",
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    productName: row.product_name,
    raw: row.raw ?? {},
    updatedAt: row.updated_at,
    guruStartedAt: row.guru_started_at ?? null,
    guruUpdatedAt: row.guru_updated_at ?? null,
    chargedTimes: row.charged_times ?? null,
    chargedEveryDays: row.charged_every_days ?? null,
    nextCycleAt: row.next_cycle_at ?? null,
  };
}

interface PaymentsState {
  loaded: boolean;
  loading: boolean;
  realtime: "off" | "on";
  guru: GuruCredential;
  subscriptions: PaymentSubscription[];
  load: () => Promise<void>;
  patch: (p: Partial<Pick<PaymentsState, "guru" | "subscriptions" | "realtime">>) => void;
}

export const usePaymentsStore = create<PaymentsState>((set, get) => ({
  loaded: false,
  loading: false,
  realtime: "off",
  guru: EMPTY_GURU,
  subscriptions: [],

  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    await useDbStore.getState().ensureSession();
    const locationId = useDbStore.getState().locationId;
    if (!locationId) {
      set({ loading: false, loaded: true });
      return;
    }
    const supabase = createClient();
    const [statusRes, { data: credential }, { data: subscriptions }, eventsCount] =
      await Promise.all([
      // Estado da integração — legível por qualquer membro (view da 0036).
      // Sem isso, usuário não-admin via "Conectar Guru" numa empresa já
      // conectada, porque payment_credentials é admin-only.
      supabase
        .from("payment_integration_status")
        .select("*")
        .eq("location_id", locationId)
        .eq("provider", "guru")
        .maybeSingle(),
      // Só o admin recebe linha aqui (tokens). Para os demais volta vazio.
      supabase
        .from("payment_credentials")
        .select("*")
        .eq("location_id", locationId)
        .eq("provider", "guru")
        .maybeSingle(),
      supabase
        .from("payment_subscriptions")
        .select("*")
        .eq("location_id", locationId)
        .order("guru_updated_at", { ascending: false, nullsFirst: false }),
      // Rede de segurança: se há venda sincronizada nesta empresa, a Guru
      // ESTÁ conectada — não importa se a view de status respondeu. Sem isto,
      // qualquer falha na view (migração não aplicada num ambiente, cache do
      // PostgREST velho, permissão faltando) devolve o usuário comum para a
      // tela de dados fictícios, que é o pior desfecho possível.
      supabase
        .from("payment_events")
        .select("id", { count: "exact", head: true })
        .eq("location_id", locationId),
    ]);

    const status = statusRes.data;
    if (statusRes.error) {
      // Silenciar isso foi o erro da primeira correção: sem row e sem log,
      // "não conectado" e "consulta falhou" viravam a mesma coisa na tela.
      console.warn(
        "[pagamentos] payment_integration_status indisponível:",
        statusRes.error.message
      );
    }
    const hasGuruData =
      (eventsCount.count ?? 0) > 0 || (subscriptions?.length ?? 0) > 0;

    set({
      loaded: true,
      loading: false,
      guru: credential
        ? mapGuruCredential(credential)
        : status
          ? mapGuruStatus(status)
          : hasGuruData
            ? { ...EMPTY_GURU, connected: true }
            : EMPTY_GURU,
      subscriptions: (subscriptions ?? []).map(mapPaymentSubscription),
    });

    // Assinaturas cabem inteiras em memória (poucos milhares); um
    // INSERT/UPDATE isolado emendado no array arrisca furar a ordenação —
    // por isso qualquer mudança só dispara um refetch (debounced) da mesma
    // consulta do load(), nunca uma emenda manual no array.
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    const refetch = () => {
      if (refetchTimer) clearTimeout(refetchTimer);
      refetchTimer = setTimeout(async () => {
        const { data: freshSubs } = await supabase
          .from("payment_subscriptions")
          .select("*")
          .eq("location_id", locationId)
          .order("guru_updated_at", { ascending: false, nullsFirst: false });
        set({ subscriptions: (freshSubs ?? []).map(mapPaymentSubscription) });
      }, 800);
    };

    supabase
      .channel("lito-pagamentos")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_subscriptions" }, refetch)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") set({ realtime: "on" });
      });
  },

  patch: (p) => set(p),
}));

export function useGuruIntegration() {
  const { guru, loaded, load } = usePaymentsStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { guru, loaded };
}

export function usePaymentSubscriptions() {
  const { subscriptions, load } = usePaymentsStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useMemo(() => subscriptions, [subscriptions]);
}

export const EVENTS_PAGE_SIZE = 50;
export const EVENTS_PAGE_SIZE_OPTIONS = [50, 100, 150] as const;

/**
 * Uma página de vendas direto de payment_events (índice em
 * (location_id, guru_created_at) da migração 0020) — cobre TODO o
 * histórico, com paginação real (50/100/150 por página) em vez de manter
 * um cache fixo em memória. Sem isso, os KPIs de payment_sales_monthly
 * (histórico completo) não tinham como bater com o que a tabela mostrava
 * — não dava pra conferir na tela se os números eram reais.
 */
/**
 * Filtro das vendas. Aplicado no BANCO, não em memória: são milhares de
 * registros e a tela carrega uma página por vez — filtrar no client filtraria
 * só a página visível, dando um resultado errado e convincente.
 */
export interface PaymentEventsFilter {
  dateField: string; // "guru_created_at" | "guru_updated_at" | "received_at"
  from: string; // yyyy-mm-dd
  to: string;
  status: string[];
  product: string;
  search: string;
}

export function usePaymentEventsPage(
  page: number,
  ascending: boolean,
  pageSize: number = EVENTS_PAGE_SIZE,
  filter?: PaymentEventsFilter
) {
  const [rows, setRows] = useState<PaymentEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      await useDbStore.getState().ensureSession();
      const loc = useDbStore.getState().locationId;
      if (!loc) {
        if (active) {
          setRows([]);
          setTotal(0);
          setLoading(false);
        }
        return;
      }
      const supabase = createClient();
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const dateField = filter?.dateField || "guru_created_at";
      let query = supabase
        .from("payment_events")
        .select("*", { count: "exact" })
        .eq("location_id", loc);

      if (filter) {
        if (filter.from) query = query.gte(dateField, `${filter.from}T00:00:00`);
        // `to` inclusivo: o usuário escolhe o dia, não o instante.
        if (filter.to) query = query.lte(dateField, `${filter.to}T23:59:59.999`);
        if (filter.status.length > 0) query = query.in("status", filter.status);
        if (filter.product.trim()) query = query.ilike("product_name", `%${filter.product.trim()}%`);
        if (filter.search.trim()) {
          const q = filter.search.trim().replace(/[,()]/g, " ");
          query = query.or(
            `code.ilike.%${q}%,contact_name.ilike.%${q}%,contact_email.ilike.%${q}%`
          );
        }
      }

      const { data, count } = await query
        .order(dateField, { ascending, nullsFirst: false })
        .range(from, to);
      if (!active) return;
      setRows((data ?? []).map(mapPaymentEvent));
      if (typeof count === "number") setTotal(count);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
    // Serializa o filtro: o objeto muda de identidade a cada render do
    // chamador e refazer a consulta por isso derrubaria a tela em loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, ascending, pageSize, JSON.stringify(filter ?? null)]);

  return { rows, total, loading };
}

export function usePaymentsRealtimeStatus() {
  return usePaymentsStore((s) => s.realtime);
}

/**
 * Vendas/assinaturas de UM contato (pela mesma chave de payment_contacts:
 * e-mail, ou nome quando não há e-mail) — usado no detalhe do contato,
 * espelhando as abas Vendas/Assinaturas do próprio painel da Guru.
 */
export function usePaymentEventsForContact(email: string | null, name: string | null) {
  const [rows, setRows] = useState<PaymentEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!email && !name) {
      setRows([]);
      return;
    }
    let active = true;
    setLoading(true);
    (async () => {
      await useDbStore.getState().ensureSession();
      const loc = useDbStore.getState().locationId;
      if (!loc) {
        if (active) {
          setRows([]);
          setLoading(false);
        }
        return;
      }
      const supabase = createClient();
      let query = supabase.from("payment_events").select("*").eq("location_id", loc);
      query = email ? query.ilike("contact_email", email) : query.ilike("contact_name", name as string);
      const { data } = await query.order("guru_created_at", { ascending: false, nullsFirst: false }).limit(200);
      if (!active) return;
      setRows((data ?? []).map(mapPaymentEvent));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [email, name]);

  return { rows, loading };
}

export const PRODUCT_SALES_PAGE_SIZE = 10;

/**
 * Vendas de UM produto, paginadas no banco — a aba "Vendas" do detalhe do
 * produto, espelhando a mesma aba no painel da Guru.
 *
 * Casamento por `product_name` exato (é o campo que a Guru manda tanto no
 * webhook quanto na API, copiado de `product.name`), e não por `ilike %nome%`
 * como no filtro livre da aba Vendas: aqui o produto é escolhido numa lista,
 * então um "contém" traria as vendas de qualquer produto cujo nome comece
 * igual (ex.: "Aviônica + GMP Turbo" arrastaria "Aviônica + GMP Turbo Anual").
 */
export function usePaymentEventsForProduct(
  productName: string | null,
  page: number,
  pageSize: number = PRODUCT_SALES_PAGE_SIZE
) {
  const [rows, setRows] = useState<PaymentEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!productName) {
      setRows([]);
      setTotal(0);
      return;
    }
    let active = true;
    setLoading(true);
    (async () => {
      await useDbStore.getState().ensureSession();
      const loc = useDbStore.getState().locationId;
      if (!loc) {
        if (active) {
          setRows([]);
          setTotal(0);
          setLoading(false);
        }
        return;
      }
      const supabase = createClient();
      const from = page * pageSize;
      const { data, count } = await supabase
        .from("payment_events")
        .select("*", { count: "exact" })
        .eq("location_id", loc)
        .eq("product_name", productName)
        .order("guru_created_at", { ascending: false, nullsFirst: false })
        .range(from, from + pageSize - 1);
      if (!active) return;
      setRows((data ?? []).map(mapPaymentEvent));
      if (typeof count === "number") setTotal(count);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [productName, page, pageSize]);

  return { rows, total, loading };
}

export interface ProductSalesSummary {
  revenue: number;
  approvedCount: number;
  ticket: number;
  refundedTotal: number;
  refundedCount: number;
}

/**
 * KPIs de um produto somando o HISTÓRICO INTEIRO, a partir da view agregada
 * `payment_sales_monthly` (migração 0020) — não da página de vendas visível,
 * que mostra 10 linhas e daria um número convincente e errado.
 */
export function useProductSalesSummary(productName: string | null) {
  const [summary, setSummary] = useState<ProductSalesSummary | null>(null);

  useEffect(() => {
    if (!productName) {
      setSummary(null);
      return;
    }
    let active = true;
    (async () => {
      await useDbStore.getState().ensureSession();
      const loc = useDbStore.getState().locationId;
      if (!loc) {
        if (active) setSummary(null);
        return;
      }
      const supabase = createClient();
      // Uma linha por mês x status para este produto — poucas centenas no pior
      // caso, mas o PostgREST corta em 1000 sem avisar, então pagina igual ao
      // relatório geral.
      const CHUNK = 1000;
      const all: any[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("payment_sales_monthly")
          .select("*")
          .eq("location_id", loc)
          .eq("product_name", productName)
          .range(from, from + CHUNK - 1);
        all.push(...(data ?? []));
        if (!data || data.length < CHUNK) break;
        from += CHUNK;
      }
      if (!active) return;
      const rows = all.map(mapSalesMonthlyRow);
      let revenue = 0;
      let approvedCount = 0;
      let refundedTotal = 0;
      let refundedCount = 0;
      for (const r of rows) {
        const category = classifyGuruStatus(r.status);
        if (category === "aprovado") {
          revenue += r.revenue;
          approvedCount += r.salesCount;
        } else if (category === "reembolsado" || category === "chargeback") {
          refundedTotal += r.revenue;
          refundedCount += r.salesCount;
        }
      }
      setSummary({
        revenue,
        approvedCount,
        ticket: approvedCount ? revenue / approvedCount : 0,
        refundedTotal,
        refundedCount,
      });
    })();
    return () => {
      active = false;
    };
  }, [productName]);

  return summary;
}

export function usePaymentSubscriptionsForContact(email: string | null, name: string | null) {
  const [rows, setRows] = useState<PaymentSubscription[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!email && !name) {
      setRows([]);
      return;
    }
    let active = true;
    setLoading(true);
    (async () => {
      await useDbStore.getState().ensureSession();
      const loc = useDbStore.getState().locationId;
      if (!loc) {
        if (active) {
          setRows([]);
          setLoading(false);
        }
        return;
      }
      const supabase = createClient();
      let query = supabase.from("payment_subscriptions").select("*").eq("location_id", loc);
      query = email ? query.ilike("contact_email", email) : query.ilike("contact_name", name as string);
      const { data } = await query.order("guru_updated_at", { ascending: false, nullsFirst: false });
      if (!active) return;
      setRows((data ?? []).map(mapPaymentSubscription));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [email, name]);

  return { rows, loading };
}

export interface SalesMonthlyRow {
  month: string;
  productName: string;
  status: string | null;
  salesCount: number;
  revenue: number;
}

function mapSalesMonthlyRow(r: any): SalesMonthlyRow {
  return {
    month: r.month,
    productName: r.product_name,
    status: r.status ?? null,
    salesCount: Number(r.sales_count ?? 0),
    revenue: Number(r.revenue ?? 0),
  };
}

/**
 * Vendas agregadas por mês x produto x status, direto de `payment_sales_monthly`
 * (migração 0020) — cobre TODO o histórico, não só as 100 vendas mais
 * recentes carregadas por `usePaymentEvents`. Usado nos KPIs/gráficos de
 * Vendas e Relatórios, que precisam bater com os números reais da Guru.
 */
export function usePaymentSalesReport() {
  const [rows, setRows] = useState<SalesMonthlyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      await useDbStore.getState().ensureSession();
      const loc = useDbStore.getState().locationId;
      if (!loc) {
        if (active) {
          setRows([]);
          setLoading(false);
        }
        return;
      }
      const supabase = createClient();
      // A view agrupa por mês x produto x status — cresce sem limite
      // conforme o histórico e o catálogo de produtos aumentam (já passa de
      // 1.800 linhas). Sem paginar, o PostgREST corta silenciosamente em
      // 1000 linhas (limite padrão): "Vendas aprovadas (mês)" e "Receita do
      // mês" ficavam bem abaixo do real porque parte das linhas do mês
      // corrente nunca chegava no client.
      const CHUNK = 1000;
      const all: any[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("payment_sales_monthly")
          .select("*")
          .eq("location_id", loc)
          .range(from, from + CHUNK - 1);
        all.push(...(data ?? []));
        if (!data || data.length < CHUNK) break;
        from += CHUNK;
      }
      if (!active) return;
      setRows(all.map(mapSalesMonthlyRow));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { rows, loading };
}

const locationId = () => useDbStore.getState().locationId;

export const paymentsActions = {
  /** Só administradores conseguem (a RLS reforça). */
  async saveGuruCredentials(input: {
    apiKey: string;
    webhookToken: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const loc = locationId();
    const userId = useDbStore.getState().userId;
    if (!loc) return { ok: false, error: "Empresa não encontrada" };
    const webhookToken = input.webhookToken.trim();
    if (!webhookToken) return { ok: false, error: "Informe o token do webhook" };

    const supabase = createClient();
    const { data, error } = await supabase
      .from("payment_credentials")
      .upsert(
        {
          location_id: loc,
          provider: "guru",
          api_key: input.apiKey.trim() || null,
          webhook_token: webhookToken,
          connected_by: userId,
        },
        { onConflict: "location_id,provider" }
      )
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === "23505" && error.message.includes("webhook_token")) {
        return {
          ok: false,
          error: "Esse token já está em uso por outra empresa — gere um novo no painel da Guru",
        };
      }
      // 42501 = RLS bloqueou (política "admins criam/editam credenciais")
      if (error.code === "42501") {
        return { ok: false, error: "Apenas administradores podem configurar integrações de pagamento" };
      }
      // 42P01 = tabela ainda não existe (migração 0008 não aplicada)
      if (error.code === "42P01") {
        return { ok: false, error: "Migração do banco ainda não aplicada (payment_credentials não existe)" };
      }
      return { ok: false, error: `Não foi possível salvar: ${error.message}` };
    }
    if (!data) {
      return { ok: false, error: "Apenas administradores podem configurar integrações de pagamento" };
    }

    // Confere se o que voltou do banco é o que enviamos — evita um "sucesso" falso
    // se algo (RLS, trigger, etc.) silenciosamente descartar algum campo.
    const sentApiKey = input.apiKey.trim() || null;
    if (data.api_key !== sentApiKey) {
      return {
        ok: false,
        error: "A chave de API não foi salva corretamente — tente novamente",
      };
    }

    usePaymentsStore.getState().patch({ guru: mapGuruCredential(data) });
    return { ok: true };
  },

  async disconnectGuru(): Promise<boolean> {
    const loc = locationId();
    if (!loc) return false;
    const supabase = createClient();
    const { error } = await supabase
      .from("payment_credentials")
      .delete()
      .eq("location_id", loc)
      .eq("provider", "guru");
    if (error) return false;
    usePaymentsStore.getState().patch({ guru: EMPTY_GURU });
    return true;
  },
};
