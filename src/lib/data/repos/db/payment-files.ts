"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

const BUCKET = "payment-files";
export const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

/** Só PDF e DOCX, por extensão e mime. */
export const ALLOWED_FILES: { ext: string; mime: string; label: string }[] = [
  { ext: "pdf", mime: "application/pdf", label: "PDF" },
  {
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "DOCX",
  },
];

export interface PaymentFile {
  id: string;
  name: string;
  path: string;
  size: number | null;
  mime: string | null;
  createdAt: string;
}

function mapRow(row: any): PaymentFile {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    size: row.size === null || row.size === undefined ? null : Number(row.size),
    mime: row.mime ?? null,
    createdAt: row.created_at,
  };
}

interface FilesState {
  loaded: boolean;
  loading: boolean;
  files: PaymentFile[];
  load: () => Promise<void>;
  set: (files: PaymentFile[]) => void;
}

const useFilesStore = create<FilesState>((setState, get) => ({
  loaded: false,
  loading: false,
  files: [],
  set: (files) => setState({ files }),
  load: async () => {
    if (get().loaded || get().loading) return;
    setState({ loading: true });
    await useDbStore.getState().ensureSession();
    const locationId = useDbStore.getState().locationId;
    if (!locationId) {
      setState({ loading: false, loaded: true });
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("payment_files")
      .select("*")
      .eq("location_id", locationId)
      .order("created_at", { ascending: false });
    setState({ loaded: true, loading: false, files: (data ?? []).map(mapRow) });
  },
}));

export function usePaymentFiles() {
  const { files, loaded, loading, load } = useFilesStore();
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { files, ready: loaded && !loading };
}

/** Detecta o tipo permitido a partir do arquivo; null se não for PDF/DOCX. */
function detectAllowed(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return (
    ALLOWED_FILES.find((a) => a.ext === ext) ??
    ALLOWED_FILES.find((a) => a.mime === file.type) ??
    null
  );
}

export const paymentFilesActions = {
  async upload(file: File): Promise<{ ok: boolean; error?: string }> {
    const locationId = useDbStore.getState().locationId;
    const userId = useDbStore.getState().userId;
    if (!locationId) return { ok: false, error: "Empresa não encontrada" };

    const allowed = detectAllowed(file);
    if (!allowed) return { ok: false, error: "Apenas arquivos PDF ou DOCX são aceitos" };
    if (file.size > MAX_FILE_BYTES) {
      return { ok: false, error: "Arquivo maior que 15 MB" };
    }

    const supabase = createClient();
    const path = `${locationId}/${crypto.randomUUID()}.${allowed.ext}`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: allowed.mime, upsert: false });
    if (upErr) return { ok: false, error: `Falha no upload: ${upErr.message}` };

    const { data, error } = await supabase
      .from("payment_files")
      .insert({
        location_id: locationId,
        name: file.name,
        path,
        size: file.size,
        mime: allowed.mime,
        uploaded_by: userId,
      })
      .select()
      .single();

    if (error || !data) {
      // metadado falhou — não deixa o binário órfão no bucket
      await supabase.storage.from(BUCKET).remove([path]);
      return { ok: false, error: error?.message ?? "Não foi possível salvar o arquivo" };
    }

    const s = useFilesStore.getState();
    s.set([mapRow(data), ...s.files]);
    return { ok: true };
  },

  async remove(fileId: string, path: string): Promise<boolean> {
    const supabase = createClient();
    const { error } = await supabase.from("payment_files").delete().eq("id", fileId);
    if (error) return false;
    await supabase.storage.from(BUCKET).remove([path]);
    const s = useFilesStore.getState();
    s.set(s.files.filter((f) => f.id !== fileId));
    return true;
  },

  /** URL assinada temporária pra baixar/abrir (bucket é privado). */
  async signedUrl(path: string): Promise<string | null> {
    const supabase = createClient();
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
    return data?.signedUrl ?? null;
  },
};
