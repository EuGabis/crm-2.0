/**
 * Cliente da Meta Cloud API (Graph). SERVER-ONLY: usa WHATSAPP_TOKEN, que
 * nunca pode ir pro cliente. Todas as rotas /api/whatsapp/* passam por aqui.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildBodyComponents } from "./templates";

const VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

function token(): string {
  const t = process.env.WHATSAPP_TOKEN;
  if (!t) throw new Error("WHATSAPP_TOKEN ausente no servidor");
  return t;
}

/**
 * Formata o erro da Meta com TODO o contexto de diagnóstico: código, subcódigo,
 * tipo e status HTTP. A mensagem crua ("Authentication Error") não diz o motivo;
 * o código (190 = token, 10/200 = permissão, 100 = parâmetro) é o que resolve.
 */
function graphError(status: number, json: any, where: string): Error {
  const e = json?.error ?? {};
  const parts = [
    e.message || "erro desconhecido",
    e.code != null ? `#${e.code}` : null,
    e.error_subcode != null ? `sub ${e.error_subcode}` : null,
    e.type ? e.type : null,
    `HTTP ${status}`,
    `em ${where}`,
  ].filter(Boolean);
  return new Error(parts.join(" · "));
}

async function graph(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw graphError(res.status, json, `graph ${path.split("/")[1] ?? path}`);
  }
  return json;
}

export function sendText(phoneNumberId: string, to: string, body: string) {
  return graph(`${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body, preview_url: false },
    }),
  });
}

export function sendTemplate(
  phoneNumberId: string,
  to: string,
  name: string,
  lang: string,
  components?: unknown[],
) {
  return graph(`${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name,
        language: { code: lang },
        ...(components && components.length ? { components } : {}),
      },
    }),
  });
}

export async function listTemplates(wabaId: string, opts?: { all?: boolean }) {
  const statusFilter = opts?.all ? "" : "&status=APPROVED";
  const json = await graph(
    `${wabaId}/message_templates?limit=100${statusFilter}`,
    { method: "GET" },
  );
  return (json.data ?? []) as Array<{
    id?: string;
    name: string;
    language: string;
    status: string;
    category: string;
    components: unknown[];
  }>;
}

export async function createTemplate(
  wabaId: string,
  input: { name: string; category: string; language: string; bodyText: string; examples: string[] },
): Promise<{ id: string; status: string }> {
  const json = await graph(`${wabaId}/message_templates`, {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      category: input.category,
      language: input.language,
      components: buildBodyComponents(input.bodyText, input.examples),
    }),
  });
  return { id: json?.id ?? "", status: json?.status ?? "PENDING" };
}

export async function deleteTemplate(wabaId: string, name: string): Promise<void> {
  await graph(`${wabaId}/message_templates?name=${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export function getNumberInfo(phoneNumberId: string) {
  return graph(
    `${phoneNumberId}?fields=verified_name,quality_rating,display_phone_number,code_verification_status`,
    { method: "GET" },
  );
}

export function markRead(phoneNumberId: string, messageId: string) {
  return graph(`${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  });
}

/** Metadados da mídia recebida: a Meta entrega só o ID; isto devolve a URL temporária. */
export async function getMediaInfo(
  mediaId: string,
): Promise<{ url: string; mime: string; size: number }> {
  const json = await graph(`${mediaId}`, { method: "GET" });
  return { url: json.url, mime: json.mime_type ?? "", size: json.file_size ?? 0 };
}

/** Baixa o binário da mídia (a URL da Meta exige o Bearer). */
export async function downloadMedia(url: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error(`Falha ao baixar mídia (${res.status})`);
  return {
    bytes: await res.arrayBuffer(),
    mime: res.headers.get("content-type") || "application/octet-stream",
  };
}

/** Sobe um binário para a Cloud API e devolve o media id para enviar. */
export async function uploadMedia(
  phoneNumberId: string,
  bytes: ArrayBuffer,
  mime: string,
  filename: string,
): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([bytes], { type: mime }), filename);
  // Token no query string (não no header). Numa requisição multipart (FormData) o
  // header Authorization estava sendo descartado, e a Meta respondia #190/HTTP 401
  // "Authentication Error" como se não houvesse token. O access_token na URL é o
  // método documentado da Meta pro upload de mídia e é imune a esse detalhe do
  // fetch+FormData. Chamada server->Meta (o token nunca vai pro cliente).
  const url = `${BASE}/${phoneNumberId}/media?access_token=${encodeURIComponent(token())}`;
  const res = await fetch(url, {
    method: "POST",
    // NÃO setar Content-Type: o FormData define o boundary sozinho.
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw graphError(res.status, json, "upload /media");
  return json.id as string;
}

export function sendMediaMessage(
  phoneNumberId: string,
  to: string,
  kind: "image" | "audio" | "video",
  mediaId: string,
  caption?: string,
) {
  const media: Record<string, unknown> = { id: mediaId };
  if (caption && kind !== "audio") media.caption = caption; // áudio não leva caption
  return graph(`${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: kind, [kind]: media }),
  });
}
