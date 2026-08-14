import { createClient } from "@/lib/supabase/server";
import { uploadMedia, sendMediaMessage } from "@/lib/whatsapp/client";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { writeFile, readFile, unlink, copyFile, chmod, access, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";
// spawn/fs precisam do runtime Node (não edge) — deixamos explícito.
export const runtime = "nodejs";
const DAY_MS = 24 * 60 * 60 * 1000;

let cachedFfmpeg: string | null = null;
/** No Vercel o node_modules é read-only e o binário do ffmpeg-static perde a
 *  permissão de execução no bundle serverless — copiamos p/ /tmp e damos chmod. */
async function ffmpegBin(): Promise<string> {
  if (cachedFfmpeg) return cachedFfmpeg;
  const src = ffmpegPath as unknown as string;
  if (!src) throw new Error("ffmpeg-static não resolveu o caminho do binário");
  const dst = join(tmpdir(), "ffmpeg-bin");
  try {
    await access(dst);
  } catch {
    // Cópia ATÔMICA: escreve num arquivo único e renomeia (rename é atômico), pra
    // duas invocações concorrentes no mesmo container não gerarem um binário truncado.
    const tmp = join(tmpdir(), `ffmpeg-${randomUUID()}`);
    await copyFile(src, tmp); // node_modules é read-only no Vercel → copia p/ /tmp
    await chmod(tmp, 0o755); // garante permissão de execução
    await rename(tmp, dst).catch(async () => {
      await unlink(tmp).catch(() => {});
    });
  }
  cachedFfmpeg = dst;
  return dst;
}

/** Converte áudio webm (gravado pelo navegador) para ogg/opus — o único
 *  formato de áudio que a Cloud API do WhatsApp aceita. */
async function webmToOgg(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const inPath = join(tmpdir(), `a-${randomUUID()}.webm`);
  const outPath = join(tmpdir(), `a-${randomUUID()}.ogg`);
  await writeFile(inPath, Buffer.from(bytes));
  try {
    const bin = await ffmpegBin();
    await new Promise<void>((resolve, reject) => {
      const p = spawn(bin, [
        "-i",
        inPath,
        "-vn",
        "-c:a",
        "libopus",
        "-f",
        "ogg",
        "-y",
        outPath,
      ]);
      // Timeout defensivo: não deixa um ffmpeg travado pendurar a request.
      const timer = setTimeout(() => p.kill("SIGKILL"), 20000);
      p.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      p.on("close", (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(`ffmpeg saiu ${code}`));
      });
    });
    const out = await readFile(outPath);
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "payload inválido" }, { status: 400 });
  }
  const { conversationId, channelId, messageId, mediaPath, mime, caption } = body ?? {};
  const kind = body?.kind as "image" | "audio" | "video";
  if (!conversationId || !messageId || !mediaPath || !["image", "audio", "video"].includes(kind)) {
    return Response.json({ error: "parâmetros ausentes" }, { status: 400 });
  }

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, contact_id, location_id, channel_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return Response.json({ error: "Conversa não encontrada" }, { status: 404 });

  const { data: channel } = await supabase
    .from("whatsapp_channels")
    .select("*")
    .eq("id", channelId ?? conv.channel_id)
    .maybeSingle();
  if (!channel || !channel.active) {
    return Response.json({ error: "Canal inválido ou inativo" }, { status: 400 });
  }

  const { data: contact } = await supabase
    .from("contacts")
    .select("phone")
    .eq("id", conv.contact_id)
    .maybeSingle();
  const to = (contact?.phone ?? "").replace(/\D/g, "");
  if (!to) return Response.json({ error: "Contato sem telefone" }, { status: 400 });

  // limite diário
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channel.id)
    .eq("direction", "out")
    .gte("created_at", startOfDay.toISOString());
  if ((count ?? 0) >= channel.daily_limit) {
    return Response.json({ error: "Limite diário do canal atingido" }, { status: 429 });
  }

  // janela de 24h (mídia é texto livre — precisa da janela aberta)
  const { data: lastIn } = await supabase
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const within24h = !!lastIn && Date.now() - new Date(lastIn.created_at).getTime() < DAY_MS;
  if (!within24h) {
    return Response.json(
      { error: "Janela de 24h fechada — só dá para enviar template", needsTemplate: true },
      { status: 409 },
    );
  }

  // lê o arquivo do nosso Storage (RLS: membro lê a pasta da própria empresa)
  const { data: blob, error: dlErr } = await supabase.storage
    .from("conversation-media")
    .download(mediaPath);
  if (dlErr || !blob) return Response.json({ error: "Mídia não encontrada" }, { status: 400 });
  const bytes = await blob.arrayBuffer();

  let sendBytes = bytes;
  let sendMime = mime || blob.type || "application/octet-stream";
  if (kind === "audio" && /webm/i.test(sendMime)) {
    try {
      sendBytes = await webmToOgg(bytes);
      sendMime = "audio/ogg";
    } catch (e) {
      await supabase.from("messages").update({ status: "failed" }).eq("id", messageId);
      return Response.json(
        { error: "Falha ao converter o áudio: " + (e instanceof Error ? e.message : String(e)) },
        { status: 502 },
      );
    }
  }

  let waResp: any;
  try {
    const ext = (String(sendMime || "application/octet-stream").split("/")[1] || "bin").split(";")[0];
    const mediaId = await uploadMedia(channel.phone_number_id, sendBytes, sendMime, `media.${ext}`);
    waResp = await sendMediaMessage(channel.phone_number_id, to, kind, mediaId, caption);
  } catch (e) {
    await supabase.from("messages").update({ status: "failed" }).eq("id", messageId);
    return Response.json(
      { error: e instanceof Error ? e.message : "Falha na Cloud API" },
      { status: 502 },
    );
  }

  const waMessageId = waResp?.messages?.[0]?.id ?? null;
  await supabase
    .from("messages")
    .update({ wa_message_id: waMessageId, status: "sent" })
    .eq("id", messageId);

  return Response.json({ ok: true, waMessageId });
}
