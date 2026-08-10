import { createClient } from "@/lib/supabase/server";

interface SendBody {
  mode?: "now" | "scheduled";
  scheduledAt?: string | null;
  /** Lista inteligente: ids já filtrados no client (mesmo matchesConditions da tela de Contatos). */
  contactIds?: string[];
}

/**
 * Publica ou agenda uma campanha.
 *
 * Sessão validada no servidor; a RLS + os wrappers `security definer`
 * (`add_campaign_recipients`, `publish_campaign`) garantem que só um membro
 * da location da campanha consegue disparar.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  let body: SendBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const mode = body.mode === "scheduled" ? "scheduled" : "now";
  const scheduledAt = mode === "scheduled" ? (body.scheduledAt ?? null) : null;
  if (mode === "scheduled" && !scheduledAt) {
    return Response.json({ error: "Informe a data de agendamento" }, { status: 400 });
  }

  // Lista inteligente: insere os destinatários pré-filtrados antes de publicar.
  if (body.contactIds?.length) {
    const { error } = await supabase.rpc("add_campaign_recipients", {
      p_campaign_id: id,
      p_ids: body.contactIds,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("publish_campaign", {
    p_id: id,
    p_mode: mode,
    p_at: scheduledAt,
  });
  if (error) {
    const message =
      error.code === "42P01"
        ? "Aplique a migração 0010 no Supabase para habilitar campanhas"
        : error.message;
    return Response.json({ error: message }, { status: 400 });
  }

  return Response.json({ campaign: data });
}
