import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Nomes oficiais de campanha / conjunto / anúncio da Meta para os leads de
 * anúncio (lead_origens, 202610221000).
 *
 * A mensagem do WhatsApp só traz o ID do anúncio (`meta_source_id`); os nomes
 * vêm da Marketing API: GET /{ad_id}?fields=name,adset{name},campaign{name}.
 * Exige `META_ADS_TOKEN` (usuário do sistema com `ads_read` e a conta de
 * anúncios atribuída) — ⚠️ NÃO o WHATSAPP_TOKEN: trocar um pelo outro derruba
 * todo envio de mensagem.
 *
 * Roda no tick de minuto. Sem o token, não faz nada (e não falha).
 * Um anúncio consultado preenche TODAS as linhas com o mesmo id. Anúncio que a
 * Meta recusa (sem acesso, apagado) ganha `anuncio = '(sem acesso)'` para não
 * ser consultado a cada minuto para sempre.
 */
const LOTE = 25;

export async function resolverNomesMeta(): Promise<{ resolvidos: number; motivo?: string }> {
  const token = process.env.META_ADS_TOKEN;
  if (!token) return { resolvidos: 0, motivo: "META_ADS_TOKEN ausente" };
  const versao = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
  const db = createAdminClient();

  const { data: pendentes } = await db
    .from("lead_origens")
    .select("meta_source_id")
    .eq("plataforma", "meta")
    .not("meta_source_id", "is", null)
    .is("campanha", null)
    .is("anuncio", null)
    .limit(500);
  const ids = [...new Set((pendentes ?? []).map((p) => p.meta_source_id as string))].slice(0, LOTE);

  let resolvidos = 0;
  for (const id of ids) {
    try {
      const url =
        `https://graph.facebook.com/${versao}/${encodeURIComponent(id)}` +
        `?fields=name,adset{name},campaign{name}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const j = (await r.json()) as {
        name?: string;
        adset?: { name?: string };
        campaign?: { name?: string };
        error?: { message?: string; code?: number };
      };
      if (!r.ok || j.error) {
        console.warn(`[origem] anúncio ${id} sem nome: ${j.error?.message ?? r.status}`);
        // Token inválido/expirado vale para todos: para a rodada inteira.
        if (r.status === 401 || j.error?.code === 190) return { resolvidos, motivo: j.error?.message };
        await db
          .from("lead_origens")
          .update({ anuncio: "(sem acesso ao anúncio)" })
          .eq("meta_source_id", id)
          .is("anuncio", null);
        continue;
      }
      await db
        .from("lead_origens")
        .update({
          anuncio: j.name ?? null,
          conjunto: j.adset?.name ?? null,
          campanha: j.campaign?.name ?? null,
        })
        .eq("meta_source_id", id);
      resolvidos++;
    } catch (e) {
      console.warn(`[origem] falha ao consultar anúncio ${id}:`, e);
    }
  }
  return { resolvidos };
}
