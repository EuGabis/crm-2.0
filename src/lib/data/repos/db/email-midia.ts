"use client";

import { createClient } from "@/lib/supabase/client";
import {
  ANEXO_MAX_BYTES,
  IMAGEM_MAX_BYTES,
  TIPOS_DE_IMAGEM,
  formatarTamanho,
  nomeSeguro,
  type AnexoEmail,
} from "@/lib/email/anexos";
import { useDbStore } from "./contacts";

const BUCKET = "email-midia";

export type ResultadoUpload = { ok: true; arquivo: AnexoEmail } | { ok: false; erro: string };

/**
 * Sobe imagem ou anexo de campanha para o bucket PÚBLICO `email-midia`
 * (202610271000). Público de propósito: quem abre o e-mail baixa a imagem sem
 * sessão no CRM. Caminho `{location_id}/{uuid}-{nome}` — a policy de escrita
 * confere a empresa pela primeira pasta.
 */
export async function enviarMidiaDeEmail(file: File, tipo: "imagem" | "anexo"): Promise<ResultadoUpload> {
  if (tipo === "imagem" && !TIPOS_DE_IMAGEM.includes(file.type)) {
    return { ok: false, erro: "Use uma imagem PNG, JPG, GIF ou WEBP" };
  }
  const teto = tipo === "imagem" ? IMAGEM_MAX_BYTES : ANEXO_MAX_BYTES;
  if (file.size > teto) {
    return { ok: false, erro: `${file.name} passa de ${formatarTamanho(teto)}` };
  }
  await useDbStore.getState().ensureSession();
  const loc = useDbStore.getState().locationId;
  if (!loc) return { ok: false, erro: "Sessão não carregada — recarregue a página" };

  const supabase = createClient();
  const caminho = `${loc}/${crypto.randomUUID()}-${nomeSeguro(file.name)}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (error) {
    // Bucket inexistente = migração não aplicada; dizer isso poupa a investigação.
    const msg = /bucket not found/i.test(error.message)
      ? "armazenamento de e-mail ainda não criado (migração 202610271000 pendente)"
      : error.message;
    return { ok: false, erro: msg };
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(caminho);
  return {
    ok: true,
    arquivo: { name: file.name, url: data.publicUrl, size: file.size, type: file.type },
  };
}
