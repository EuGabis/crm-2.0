import { createClient } from "@/lib/supabase/server";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RawRow {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  doc?: string;
  company?: string;
  tags?: string[];
}

/**
 * Importação em massa de contatos — feita no SERVIDOR. O cliente envia os dados
 * em blocos (poucas requisições curtas), e AQUI os inserts são feitos em lotes;
 * assim a aba do navegador não trava nem é suspensa no meio de 50 mil inserts
 * (era o que dava ERR_NETWORK_IO_SUSPENDED). RLS de contacts continua valendo.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "não autenticado" }, { status: 401 });

  const { data: membership } = await supabase
    .from("location_members")
    .select("location_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return Response.json({ error: "empresa não encontrada" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const rows = body?.rows as RawRow[] | undefined;
  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json({ error: "nada para importar" }, { status: 400 });
  }
  if (rows.length > 20000) {
    return Response.json({ error: "bloco grande demais (máx. 20 mil por vez)" }, { status: 413 });
  }

  const payload = rows.map((r) => ({
    location_id: membership.location_id,
    first_name: (r.firstName ?? "").slice(0, 200),
    last_name: (r.lastName ?? "").slice(0, 200),
    email: (r.email ?? "").slice(0, 320),
    phone: (r.phone ?? "").slice(0, 60),
    doc: r.doc?.trim() ? r.doc.trim().slice(0, 32) : null,
    company: r.company?.trim() ? r.company.trim().slice(0, 200) : null,
    tags: Array.isArray(r.tags) ? r.tags.slice(0, 30) : [],
    owner_id: user.id,
  }));

  let inserted = 0;
  let failed = 0;
  let firstError: string | null = null;

  // Insere um lote; se falhar, reparte ao meio até isolar a(s) linha(s) ruim(ns).
  const push = async (batch: typeof payload, attempt = 0): Promise<void> => {
    const { error } = await supabase.from("contacts").insert(batch);
    if (!error) {
      inserted += batch.length;
      return;
    }
    if (attempt === 0 && batch.length > 1) {
      await new Promise((r) => setTimeout(r, 300));
      return push(batch, 1);
    }
    if (batch.length > 1) {
      const mid = Math.ceil(batch.length / 2);
      await push(batch.slice(0, mid));
      await push(batch.slice(mid));
      return;
    }
    failed += 1;
    firstError ??= error.message;
  };

  const CHUNK = 1000;
  for (let i = 0; i < payload.length; i += CHUNK) {
    await push(payload.slice(i, i + CHUNK));
  }

  return Response.json({ inserted, failed, error: firstError });
}
