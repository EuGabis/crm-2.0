import { extrairCodigo, origemDaMeta, plataformaDoClique, type ReferralMeta } from "./origem";

/**
 * Grava a origem do lead a partir da mensagem recebida (webhook, service role).
 *
 * - `referral` da Meta (anúncio click-to-WhatsApp) → plataforma meta;
 * - código "(cód. XXXXXX)" do botão do site → o clique gravado por
 *   `/api/whatsapp/clique` (gclid → google; fbclid/UTM → conforme a fonte).
 *
 * ⚠️ Best-effort: chamado DEPOIS de a mensagem estar gravada, e qualquer erro só
 * vira log — perder a origem é ruim, perder a mensagem do cliente é pior.
 * ⚠️ Uma linha por conversa e origem: reenvio da Meta ou o cliente repetindo o
 * código não duplicam.
 */
export async function registrarOrigem(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente service role, mesmo padrão do webhook
  db: any,
  args: {
    locationId: string;
    contactId: string;
    conversationId: string;
    referral?: ReferralMeta | null;
    texto?: string | null;
  },
): Promise<void> {
  try {
    const meta = origemDaMeta(args.referral);
    if (meta) {
      const { data: ja } = await db
        .from("lead_origens")
        .select("id")
        .eq("conversation_id", args.conversationId)
        .eq("via", "anuncio_whatsapp")
        .eq("meta_source_id", meta.meta_source_id ?? "")
        .limit(1);
      if (!ja?.length) {
        await db.from("lead_origens").insert({
          location_id: args.locationId,
          contact_id: args.contactId,
          conversation_id: args.conversationId,
          ...meta,
        });
      }
      return;
    }

    const codigo = extrairCodigo(args.texto);
    if (!codigo) return;
    const { data: clique } = await db
      .from("lead_cliques")
      .select("*")
      .eq("location_id", args.locationId)
      .eq("codigo", codigo)
      .maybeSingle();
    if (!clique) {
      console.warn(`[origem] código ${codigo} sem clique registrado`);
      return;
    }
    const { data: ja } = await db
      .from("lead_origens")
      .select("id")
      .eq("conversation_id", args.conversationId)
      .eq("clique_id", clique.id)
      .limit(1);
    if (ja?.length) return;
    await db.from("lead_origens").insert({
      location_id: args.locationId,
      contact_id: args.contactId,
      conversation_id: args.conversationId,
      plataforma: plataformaDoClique(clique),
      via: "botao_site",
      clique_id: clique.id,
      gclid: clique.gclid ?? clique.gbraid ?? clique.wbraid ?? null,
      utm_source: clique.utm_source,
      utm_medium: clique.utm_medium,
      utm_campaign: clique.utm_campaign,
      utm_term: clique.utm_term,
      utm_content: clique.utm_content,
      pagina: clique.pagina,
      // Até a API do Google resolver os nomes, a campanha da UTM é o melhor que há.
      campanha: clique.utm_campaign,
    });
  } catch (e) {
    console.warn("[origem] não registrada:", e);
  }
}
