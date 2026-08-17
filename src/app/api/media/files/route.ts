import { createClient } from "@/lib/supabase/server";
import { getAccessToken, type MediaProvider } from "@/lib/integrations/media-oauth";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

/**
 * Lista arquivos do Google Drive ou designs do Canva da empresa.
 *
 * Duas etapas, como nas rotas da Guru: a SESSÃO autoriza (membership) e a
 * SERVICE ROLE lê o token. `media_connections` é admin-only (0045) — ler com a
 * sessão do usuário faria a tela responder "não conectado" para todo mundo que
 * não fosse administrador. O token não sai daqui.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") as MediaProvider | null;
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (provider !== "google_drive" && provider !== "canva") {
    return Response.json({ error: "provider inválido" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const { data: membership } = await supabase
    .from("location_members")
    .select("location_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return Response.json({ error: "Empresa não encontrada" }, { status: 404 });

  let token: string | null;
  try {
    token = await getAccessToken((membership as any).location_id, provider);
  } catch {
    return Response.json({ error: "Servidor sem credenciais" }, { status: 503 });
  }
  if (!token) return Response.json({ error: "não conectado", connected: false }, { status: 409 });

  try {
    const items =
      provider === "google_drive" ? await listDrive(token, query) : await listCanva(token, query);
    return Response.json({ items, connected: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "falha ao consultar" },
      { status: 502 }
    );
  }
}

export interface ExternalItem {
  id: string;
  name: string;
  mime: string | null;
  thumbnail: string | null;
  url: string | null;
  updatedAt: string | null;
}

async function listDrive(token: string, query: string): Promise<ExternalItem[]> {
  const params = new URLSearchParams({
    pageSize: "40",
    fields: "files(id,name,mimeType,thumbnailLink,webViewLink,modifiedTime)",
    orderBy: "modifiedTime desc",
    // Lixeira de fora: arquivo apagado não deveria aparecer como disponível.
    q: query ? `trashed = false and name contains '${query.replace(/'/g, "")}'` : "trashed = false",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.files ?? []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mime: f.mimeType ?? null,
    thumbnail: f.thumbnailLink ?? null,
    url: f.webViewLink ?? null,
    updatedAt: f.modifiedTime ?? null,
  }));
}

async function listCanva(token: string, query: string): Promise<ExternalItem[]> {
  const params = new URLSearchParams({ limit: "40" });
  if (query) params.set("query", query);
  const res = await fetch(`https://api.canva.com/rest/v1/designs?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Canva ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.items ?? []).map((d: any) => ({
    id: d.id,
    name: d.title || "Design sem título",
    mime: "canva/design",
    thumbnail: d.thumbnail?.url ?? null,
    url: d.urls?.edit_url ?? d.urls?.view_url ?? null,
    updatedAt: d.updated_at ? new Date(Number(d.updated_at) * 1000).toISOString() : null,
  }));
}
