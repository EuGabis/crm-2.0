import { createAdminClient } from "@/lib/supabase/admin";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

function json(body: any, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "payload inválido" }, 400);
  }

  // honeypot: bot preencheu → descarta silenciosamente
  if (typeof body?._hp === "string" && body._hp.trim() !== "") {
    return json({ ok: true, action: "message", value: "Obrigado!" });
  }

  let db;
  try {
    db = createAdminClient();
  } catch {
    return json({ error: "servidor sem credenciais" }, 503);
  }

  const { data: form } = await db
    .from("forms")
    .select("id, location_id, fields, tag, active, success_action, success_value")
    .eq("slug", slug)
    .maybeSingle();
  if (!form) return json({ error: "formulário não encontrado" }, 404);
  if (!form.active) return json({ error: "formulário inativo" }, 409);

  const fields: any[] = form.fields ?? [];
  // mapeia os campos recebidos pelos mapsTo
  let firstName = "";
  let lastName = "";
  let email = "";
  let phone = "";
  let company: string | null = null;
  const custom: Record<string, string> = {};
  for (const f of fields) {
    const raw = (body?.[f.key] ?? "").toString().trim();
    if (!raw) continue;
    if (f.mapsTo === "name") {
      const parts = raw.split(/\s+/);
      firstName = parts.shift() ?? raw;
      lastName = parts.join(" ");
    } else if (f.mapsTo === "email") email = raw;
    else if (f.mapsTo === "phone") phone = raw;
    else if (f.mapsTo === "company") company = raw;
    else if (typeof f.mapsTo === "string" && f.mapsTo.startsWith("custom:")) {
      custom[f.mapsTo.slice(7)] = raw;
    }
  }

  // dedup: por email (senão por telefone) na location
  let contactId: string | null = null;
  let existing: any = null;
  if (email) {
    const { data } = await db
      .from("contacts")
      .select("id, tags, custom_fields")
      .eq("location_id", form.location_id)
      .eq("email", email)
      .maybeSingle();
    existing = data;
  }
  if (!existing && phone) {
    const { data } = await db
      .from("contacts")
      .select("id, tags, custom_fields")
      .eq("location_id", form.location_id)
      .eq("phone", phone)
      .maybeSingle();
    existing = data;
  }

  const nowIso = new Date().toISOString();
  if (existing) {
    const tags = Array.from(new Set([...(existing.tags ?? []), form.tag]));
    const mergedCustom = { ...(existing.custom_fields ?? {}), ...custom };
    await db
      .from("contacts")
      .update({
        tags,
        custom_fields: mergedCustom,
        ...(company ? { company } : {}),
        last_activity_at: nowIso,
      })
      .eq("id", existing.id);
    contactId = existing.id;
  } else {
    const { data: created } = await db
      .from("contacts")
      .insert({
        location_id: form.location_id,
        first_name: firstName || email || phone || "Lead",
        last_name: lastName,
        email,
        phone,
        company,
        tags: [form.tag],
        custom_fields: custom,
        last_activity_at: nowIso,
      })
      .select("id")
      .single();
    contactId = created?.id ?? null;
  }

  await db.from("form_submissions").insert({
    location_id: form.location_id,
    form_id: form.id,
    contact_id: contactId,
    payload: body,
  });

  return json({ ok: true, action: form.success_action, value: form.success_value });
}
