import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Reenvia a MESMA campanha a todos os destinatários dela, sem criar campanha
 * nova: os destinatários voltam para `pending` e o tique de marketing os
 * dispara de novo. Os contadores da campanha passam a descrever o reenvio.
 *
 * ⚠️ Admin-only: reenviar é mandar e-mail outra vez para milhares de pessoas.
 * A sessão AUTORIZA (papel admin na empresa da campanha) e a service role
 * EXECUTA — `claim_recipients` é service-only e o UPDATE nos destinatários não
 * tem policy para o usuário.
 *
 * ⚠️ Quem se descadastrou (`contacts.marketing_opt_out`) vira `skipped`, não
 * `pending`: `claim_recipients` não confere o opt-out, então sem isto o
 * reenvio iria justamente para quem pediu para sair.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const db = createAdminClient();
  const { data: camp } = await db
    .from("email_campaigns")
    .select("id, location_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!camp) return Response.json({ error: "Campanha não encontrada" }, { status: 404 });

  const { data: membro } = await db
    .from("location_members")
    .select("role")
    .eq("location_id", camp.location_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membro?.role !== "admin") {
    return Response.json({ error: "Só administrador pode reenviar campanha" }, { status: 403 });
  }
  if (camp.status === "sending") {
    return Response.json({ error: "A campanha ainda está enviando" }, { status: 409 });
  }

  // Destinatários e quem pediu para sair, em páginas (o PostgREST corta em 1000).
  const contatos: string[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db
      .from("email_campaign_recipients")
      .select("contact_id")
      .eq("campaign_id", id)
      .order("id")
      .range(de, de + 999);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    for (const r of data ?? []) if (r.contact_id) contatos.push(r.contact_id);
    if (!data || data.length < 1000) break;
  }
  const saiu = new Set<string>();
  for (let i = 0; i < contatos.length; i += 200) {
    const { data } = await db
      .from("contacts")
      .select("id")
      .in("id", contatos.slice(i, i + 200))
      .eq("marketing_opt_out", true);
    for (const c of data ?? []) saiu.add(c.id);
  }

  const agora = new Date().toISOString();
  const { error: e1 } = await db
    .from("email_campaign_recipients")
    .update({
      status: "pending",
      claimed_at: null,
      sent_at: null,
      delivered_at: null,
      opened_at: null,
      clicked_at: null,
      resend_id: null,
      error: null,
    })
    .eq("campaign_id", id);
  if (e1) return Response.json({ error: e1.message }, { status: 500 });

  const fora = [...saiu];
  for (let i = 0; i < fora.length; i += 200) {
    await db
      .from("email_campaign_recipients")
      .update({ status: "skipped", error: "descadastrado" })
      .eq("campaign_id", id)
      .in("contact_id", fora.slice(i, i + 200));
  }

  const { error: e2 } = await db
    .from("email_campaigns")
    .update({
      status: "sending",
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      failed: 0,
      updated_at: agora,
    })
    .eq("id", id);
  if (e2) return Response.json({ error: e2.message }, { status: 500 });

  return Response.json({ reenviando: contatos.length - fora.length, descadastrados: fora.length });
}
