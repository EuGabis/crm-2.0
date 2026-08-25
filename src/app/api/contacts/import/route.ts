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
 * Mesma chave canônica de `private.phone_key` (0047): só dígitos, sem o 55,
 * DDD + últimos 8 (une "com" e "sem" o 9º dígito). Replicada aqui para comparar
 * com as chaves que a função `existing_contact_keys` devolve.
 */
function phoneKey(raw?: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  const n = digits.length >= 12 && digits.startsWith("55") ? digits.slice(2) : digits;
  return n.length < 10 ? n : n.slice(0, 2) + n.slice(-8);
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
  let skipped = 0;
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
    const chunk = payload.slice(i, i + CHUNK);

    // Deduplicação NO SERVIDOR (migração 0078): pergunta quais chaves já existem
    // na empresa e pula essas linhas. Sem isso, reimportar duplicava contatos.
    const { data: ex, error: exErr } = await supabase.rpc("existing_contact_keys", {
      p_phones: chunk.map((r) => r.phone).filter(Boolean),
      p_emails: chunk.map((r) => r.email).filter(Boolean),
      p_docs: chunk.map((r) => r.doc ?? "").filter(Boolean),
    });
    if (exErr) {
      // A função não existe (migração 0078 não aplicada) ou falhou. Aborta em vez
      // de inserir SEM deduplicar — duplicar de novo é pior do que parar.
      return Response.json(
        {
          inserted,
          failed,
          skipped,
          error:
            "Deduplicação indisponível (aplique a migração 0078 no Supabase). " +
            `Detalhe: ${exErr.message}`,
        },
        { status: 503 },
      );
    }

    const existPhones = new Set<string>((ex?.phones ?? []) as string[]);
    const existEmails = new Set<string>((ex?.emails ?? []) as string[]);
    const existDocs = new Set<string>((ex?.docs ?? []) as string[]);

    const fresh = chunk.filter((r) => {
      const pk = phoneKey(r.phone);
      const em = (r.email ?? "").trim().toLowerCase();
      const dk = (r.doc ?? "").replace(/\D/g, "");
      if (pk && existPhones.has(pk)) return false;
      if (em.includes("@") && existEmails.has(em)) return false;
      if (dk.length >= 11 && existDocs.has(dk)) return false;
      return true;
    });
    skipped += chunk.length - fresh.length;
    if (fresh.length) await push(fresh);
  }

  return Response.json({ inserted, failed, skipped, error: firstError });
}
