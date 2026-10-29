"use client";

import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type { Audience, Campaign, Recipient } from "@/lib/marketing/types";
import { useDbStore } from "./contacts";
import { anexosDe, type AnexoEmail } from "@/lib/email/anexos";
import { normalizarDesign, type DesignEmail } from "@/lib/email/design";

/* eslint-disable @typescript-eslint/no-explicit-any */

const mapCampaign = (r: any): Campaign => ({
  id: r.id,
  name: r.name,
  subject: r.subject ?? "",
  fromEmail: r.from_email,
  replyTo: r.reply_to,
  bodyHtml: r.body_html ?? "",
  bodyText: r.body_text ?? "",
  audience: (r.audience ?? { type: "all", value: null }) as Audience,
  accentColor: r.accent_color ?? null,
  attachments: anexosDe(r.attachments),
  design: normalizarDesign(r.design, r.accent_color),
  status: r.status,
  scheduledAt: r.scheduled_at,
  total: r.total ?? 0,
  sent: r.sent ?? 0,
  delivered: r.delivered ?? 0,
  opened: r.opened ?? 0,
  clicked: r.clicked ?? 0,
  bounced: r.bounced ?? 0,
  failed: r.failed ?? 0,
  unsubscribed: r.unsubscribed ?? 0,
  createdAt: r.created_at,
});

const mapRecipient = (r: any): Recipient => ({
  id: r.id,
  contactId: r.contact_id,
  email: r.email,
  status: r.status,
  sentAt: r.sent_at,
  deliveredAt: r.delivered_at,
  openedAt: r.opened_at,
  clickedAt: r.clicked_at,
  error: r.error,
});

interface CampaignState {
  loaded: boolean;
  loading: boolean;
  campaigns: Campaign[];
  load: () => Promise<void>;
  patch: (c: Campaign[]) => void;
  upsert: (c: Campaign) => void;
}

export const useCampaignStore = create<CampaignState>((set, get) => ({
  loaded: false,
  loading: false,
  campaigns: [],

  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    await useDbStore.getState().ensureSession();
    const supabase = createClient();
    const { data } = await supabase
      .from("email_campaigns")
      .select("*")
      .order("created_at", { ascending: false });
    set({ loaded: true, loading: false, campaigns: (data ?? []).map(mapCampaign) });
  },

  patch: (campaigns) => set({ campaigns }),
  upsert: (c) =>
    set((s) => {
      const rest = s.campaigns.filter((x) => x.id !== c.id);
      return { campaigns: [c, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
    }),
}));

export function useDbCampaigns() {
  const { campaigns, loading, loaded, load } = useCampaignStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { campaigns, loading: loading || !loaded };
}

export function useDbCampaign(id: string): Campaign | undefined {
  const campaigns = useCampaignStore((s) => s.campaigns);
  return useMemo(() => campaigns.find((c) => c.id === id), [campaigns, id]);
}

/** Carrega os destinatários de uma campanha sob demanda (RLS garante o escopo).
 *  `refreshKey`: mude o valor para forçar um recarregamento (usado no auto-refresh). */
export function useCampaignRecipients(
  campaignId: string | null,
  refreshKey = 0,
): {
  recipients: Recipient[];
  loading: boolean;
} {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!campaignId) {
      setRecipients([]);
      return;
    }
    let active = true;
    setLoading(true);
    const supabase = createClient();
    supabase
      .from("email_campaign_recipients")
      .select("id, contact_id, email, status, sent_at, delivered_at, opened_at, clicked_at, error")
      .eq("campaign_id", campaignId)
      .order("created_at")
      .then(({ data }) => {
        if (!active) return;
        setRecipients((data ?? []).map(mapRecipient));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [campaignId, refreshKey]);

  return { recipients, loading };
}

export interface CampaignInput {
  name: string;
  subject: string;
  fromEmail?: string;
  replyTo?: string | null;
  bodyHtml: string;
  bodyText: string;
  audience: Audience;
  accentColor?: string | null;
  /** Colunas da 202610271000 — ver `semColunasNovas`. */
  attachments?: AnexoEmail[];
  design?: DesignEmail;
}

/**
 * ⚠️ O código chega à produção ANTES da migração, e mandar uma coluna que não
 * existe faz o PostgREST recusar o salvamento INTEIRO (PGRST204/42703). Nesse
 * caso o repo grava de novo sem `attachments`/`design` — a campanha salva, só
 * a parte nova espera a migração — e avisa no console.
 */
function colunaInexistente(error: { code?: string } | null): boolean {
  return !!error && (error.code === "PGRST204" || error.code === "42703");
}
function semColunasNovas(row: Record<string, unknown>) {
  const { attachments: _a, design: _d, ...resto } = row;
  void _a;
  void _d;
  console.warn("[campanhas] migração 202610271000 pendente: design/anexos não foram gravados");
  return resto;
}

export const campaignActions = {
  async create(input: CampaignInput): Promise<string | null> {
    const locationId = useDbStore.getState().locationId;
    if (!locationId) return null;
    const supabase = createClient();
    const linha: Record<string, unknown> = {
      location_id: locationId,
      name: input.name,
      subject: input.subject,
      ...(input.fromEmail ? { from_email: input.fromEmail } : {}),
      reply_to: input.replyTo ?? null,
      body_html: input.bodyHtml,
      body_text: input.bodyText,
      audience: input.audience,
      accent_color: input.accentColor ?? null,
      ...(input.attachments ? { attachments: input.attachments } : {}),
      ...(input.design ? { design: input.design } : {}),
    };
    const inserir = (r: Record<string, unknown>) =>
      supabase.from("email_campaigns").insert(r).select().single();
    let { data, error } = await inserir(linha);
    if (colunaInexistente(error)) ({ data, error } = await inserir(semColunasNovas(linha)));
    if (error || !data) return null;
    useCampaignStore.getState().upsert(mapCampaign(data));
    return data.id;
  },

  async update(id: string, patch: Partial<CampaignInput>): Promise<boolean> {
    const supabase = createClient();
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.subject !== undefined) row.subject = patch.subject;
    if (patch.fromEmail !== undefined) row.from_email = patch.fromEmail;
    if (patch.replyTo !== undefined) row.reply_to = patch.replyTo;
    if (patch.bodyHtml !== undefined) row.body_html = patch.bodyHtml;
    if (patch.bodyText !== undefined) row.body_text = patch.bodyText;
    if (patch.audience !== undefined) row.audience = patch.audience;
    if (patch.accentColor !== undefined) row.accent_color = patch.accentColor;
    if (patch.attachments !== undefined) row.attachments = patch.attachments;
    if (patch.design !== undefined) row.design = patch.design;
    const gravar = (r: Record<string, unknown>) =>
      supabase.from("email_campaigns").update(r).eq("id", id).select().single();
    let { data, error } = await gravar(row);
    if (colunaInexistente(error)) ({ data, error } = await gravar(semColunasNovas(row)));
    if (error || !data) return false;
    useCampaignStore.getState().upsert(mapCampaign(data));
    return true;
  },

  /**
   * Reenviar = nova campanha em RASCUNHO com o mesmo conteúdo e público. Não
   * reaproveita a original: os destinatários dela (status, aberturas, motivo
   * de falha) são o histórico daquele envio, e reabrir a mesma campanha
   * misturaria dois envios nos mesmos números. Nada sai sem passar pelo
   * composer — o público é recalculado ao enviar, então quem se descadastrou
   * no envio anterior fica de fora.
   */
  async duplicate(id: string): Promise<string | null> {
    const origem = useCampaignStore.getState().campaigns.find((c) => c.id === id);
    if (!origem) return null;
    return campaignActions.create({
      name: `${origem.name} (reenvio)`,
      subject: origem.subject,
      fromEmail: origem.fromEmail ?? undefined,
      replyTo: origem.replyTo,
      bodyHtml: origem.bodyHtml,
      bodyText: origem.bodyText,
      audience: origem.audience,
      accentColor: origem.accentColor,
      attachments: origem.attachments,
      design: origem.design,
    });
  },

  async remove(id: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("email_campaigns").delete().eq("id", id);
    if (error) return false;
    const s = useCampaignStore.getState();
    s.patch(s.campaigns.filter((c) => c.id !== id));
    return true;
  },

  async pause(id: string): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("email_campaigns")
      .update({ status: "paused", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error || !data) return false;
    useCampaignStore.getState().upsert(mapCampaign(data));
    return true;
  },

  /** Retoma uma campanha pausada: volta para 'sending' e o cron continua o envio
   *  (se não sobrar pendente, o próprio tick marca como 'sent'). */
  async resume(id: string): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("email_campaigns")
      .update({ status: "sending", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error || !data) return false;
    useCampaignStore.getState().upsert(mapCampaign(data));
    return true;
  },

  /** Cancela o agendamento: volta a campanha para rascunho e limpa a data.
   *  O motor só processa status 'sending', então uma agendada cancelada não dispara. */
  async cancelSchedule(id: string): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("email_campaigns")
      .update({ status: "draft", scheduled_at: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error || !data) return false;
    useCampaignStore.getState().upsert(mapCampaign(data));
    return true;
  },

  /** Recarrega uma campanha do banco (após publicar/enviar via rota). */
  async refresh(id: string): Promise<void> {
    const supabase = createClient();
    const { data } = await supabase.from("email_campaigns").select("*").eq("id", id).maybeSingle();
    if (data) useCampaignStore.getState().upsert(mapCampaign(data));
  },
};
