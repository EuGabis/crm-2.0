/**
 * Cliente da Meta Cloud API (Graph). SERVER-ONLY: usa WHATSAPP_TOKEN, que
 * nunca pode ir pro cliente. Todas as rotas /api/whatsapp/* passam por aqui.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildBodyComponents } from "./templates";

const VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

/**
 * Versão da Graph API que ESTÁ em uso, para diagnóstico.
 *
 * ⚠️ Não é segredo — ela aparece no caminho da URL de toda chamada à Meta. E era
 * a última variável do lado do CRM que a investigação do áudio recusado nunca
 * conseguiu MEDIR: `v21.0` é o padrão do código, mas a Vercel pode ter outro
 * valor em `WHATSAPP_GRAPH_VERSION`, e as duas situações eram indistinguíveis
 * sem abrir o painel. Este projeto já perdeu rodadas inteiras por deduzir o que
 * dava para conferir em dois segundos.
 */
export function graphVersion(): string {
  return VERSION;
}
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

export function sendText(
  phoneNumberId: string,
  to: string,
  body: string,
  replyToWaId?: string,
) {
  return graph(`${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      // Responder (0077): cita a mensagem original — o cliente vê a citação
      // nativa do WhatsApp. Só entra quando temos o id da mensagem na Meta.
      ...(replyToWaId ? { context: { message_id: replyToWaId } } : {}),
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

/**
 * Estado COMPLETO do número, para diagnóstico.
 *
 * ⚠️ Difere de `getNumberInfo` justamente nos campos que a investigação do áudio
 * precisava e nunca pediu:
 *   - **`platform_type`** — revela COEXISTÊNCIA (número servindo o aplicativo
 *     WhatsApp Business E a Cloud API ao mesmo tempo). É a única hipótese que
 *     explica "pelo celular o áudio é enviado normalmente": um número 100%
 *     migrado para a Cloud API não funciona no aplicativo;
 *   - `status` — CONNECTED ou não;
 *   - `throughput`, `messaging_limit_tier` — capacidade;
 *   - `is_official_business_account`, `name_status`.
 *
 * Campos que a conta não expõe simplesmente não vêm no JSON — e a AUSÊNCIA é
 * dado, não erro.
 */
export function numberDiagnostics(phoneNumberId: string) {
  const campos = [
    "verified_name",
    "display_phone_number",
    "quality_rating",
    "code_verification_status",
    "platform_type",
    "status",
    "throughput",
    "messaging_limit_tier",
    "is_official_business_account",
    "name_status",
  ].join(",");
  return graph(`${phoneNumberId}?fields=${campos}`, { method: "GET" });
}

/**
 * Estado da conta (WABA). Revisão pendente ou negócio não verificado limita o que
 * a conta pode fazer — e é o tipo de coisa que não aparece como erro na chamada
 * de envio, só como recusa genérica depois.
 */
export function wabaDiagnostics(wabaId: string) {
  const campos = [
    "name",
    "account_review_status",
    "business_verification_status",
    "country",
    "ownership_type",
    "message_template_namespace",
  ].join(",");
  return graph(`${wabaId}?fields=${campos}`, { method: "GET" });
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
  /*
   * ⚠️ **O mime é limpo AQUI, e não só em quem chama.** A Cloud API compara o
   * tipo declarado com uma lista SEM parâmetros; recebendo
   * `audio/ogg; codecs=opus` ela não reconhece o arquivo, cai em
   * `application/octet-stream` e recusa com #131053 — a falha que voltou quatro
   * vezes neste projeto.
   *
   * Já existe normalização na rota (`mimeParaUpload`), e ainda assim vale
   * repetir na fronteira: esta é a única função que fala com o endpoint de
   * mídia da Meta, então é aqui que o contrato dela pode ser garantido para
   * QUALQUER chamador — inclusive o próximo, que não vai lembrar da regra.
   */
  const mimeLimpo = mime.split(";")[0]!.trim().toLowerCase() || "application/octet-stream";
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeLimpo);
  form.append("file", new Blob([bytes], { type: mimeLimpo }), filename);
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

/**
 * Envia mídia já hospedada na Meta (`id`) ou por URL pública (`link`).
 *
 * ⚠️ **O `link` existe aqui para tirar o NOSSO upload da equação.** O áudio
 * gerado pelo CRM se provou um Ogg/Opus impecável — mono, `pre-skip` correto,
 * OpusTags, EOS, CRC de todas as páginas conferindo — e a Meta seguiu recusando
 * com #131053 ("on processing it is of type application/octet-stream"). Depois
 * de oito hipóteses sobre o ARQUIVO, todas erradas, a pergunta que faltava era
 * outra: o problema é o arquivo ou a nossa transmissão dele?
 *
 * Com `link`, a Meta baixa o arquivo direto do nosso Storage e o multipart sai
 * do caminho. Ou funciona — e o problema era o upload —, ou falha igual, e aí a
 * causa não está em nada que o CRM controla.
 */
export function sendMediaMessage(
  phoneNumberId: string,
  to: string,
  kind: "image" | "audio" | "video" | "document",
  /** `{ id }` para mídia já subida, `{ link }` para a Meta buscar sozinha. */
  origem: { id: string } | { link: string },
  caption?: string,
  filename?: string,
) {
  const media: Record<string, unknown> = "id" in origem ? { id: origem.id } : { link: origem.link };
  if (caption && kind !== "audio") media.caption = caption; // áudio não leva caption
  if (kind === "document" && filename) media.filename = filename; // nome do arquivo p/ o cliente
  return graph(`${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: kind, [kind]: media }),
  });
}

/** Opção de lista/botão do bot. `id` volta no webhook quando o cliente clica. */
export interface InteractiveOption {
  id: string;
  title: string;
  description?: string;
}

/**
 * Mensagem de LISTA (até 10 opções). O cliente abre a lista e escolhe; o webhook
 * recebe `interactive.list_reply.id`. Usada nas perguntas do bot com muitas opções.
 */
export function sendInteractiveList(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  buttonLabel: string,
  options: InteractiveOption[],
) {
  // A Meta rejeita a lista inteira se houver título vazio ou ids repetidos.
  const seen = new Set<string>();
  const rows = options.slice(0, 10).map((o, i) => {
    let id = (o.id || `opt_${i}`).slice(0, 200);
    let n = 1;
    while (seen.has(id)) id = `${(o.id || `opt_${i}`).slice(0, 190)}_${n++}`;
    seen.add(id);
    return {
      id,
      title: ((o.title || "").trim() || `Opção ${i + 1}`).slice(0, 24), // limite da Meta
      ...(o.description ? { description: o.description.slice(0, 72) } : {}),
    };
  });
  return graph(`${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText.slice(0, 1024) },
        action: {
          button: (buttonLabel || "Ver opções").slice(0, 20),
          sections: [{ title: "Opções", rows }],
        },
      },
    }),
  });
}

/** Mensagem com até 3 BOTÕES de resposta. Webhook recebe `interactive.button_reply.id`. */
export function sendInteractiveButtons(
  phoneNumberId: string,
  to: string,
  bodyText: string,
  options: InteractiveOption[],
) {
  const buttons = options.slice(0, 3).map((o) => ({
    type: "reply",
    reply: { id: o.id.slice(0, 256), title: o.title.slice(0, 20) },
  }));
  return graph(`${phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: { type: "button", body: { text: bodyText.slice(0, 1024) }, action: { buttons } },
    }),
  });
}
