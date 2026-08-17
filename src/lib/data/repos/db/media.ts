"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Mídia Drive real (migração 0044): pastas e arquivos da empresa, com os
 * binários num bucket privado do Supabase Storage.
 *
 * O caminho no bucket é `{location_id}/{uuid}.{ext}` — sem a hierarquia de
 * pastas dentro do nome. Quem organiza é `folder_id`: renomear pasta seria
 * mover N objetos no storage, e pasta vazia não existiria.
 */

export const MEDIA_BUCKET = "media-drive";
/** 50 MB por arquivo: acima disso o upload pelo navegador fica frágil. */
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;

export interface MediaFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

export interface MediaFile {
  id: string;
  folderId: string | null;
  name: string;
  path: string;
  size: number | null;
  mime: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

const mapFolder = (r: any): MediaFolder => ({
  id: r.id,
  name: r.name,
  parentId: r.parent_id ?? null,
  createdAt: r.created_at,
});

const mapFile = (r: any): MediaFile => ({
  id: r.id,
  folderId: r.folder_id ?? null,
  name: r.name,
  path: r.path,
  size: r.size === null || r.size === undefined ? null : Number(r.size),
  mime: r.mime ?? null,
  uploadedBy: r.uploaded_by ?? null,
  createdAt: r.created_at,
});

interface MediaState {
  loaded: boolean;
  loading: boolean;
  folders: MediaFolder[];
  files: MediaFile[];
  load: (force?: boolean) => Promise<void>;
  patch: (p: Partial<Pick<MediaState, "folders" | "files">>) => void;
}

export const useMediaStore = create<MediaState>((set, get) => ({
  loaded: false,
  loading: false,
  folders: [],
  files: [],
  patch: (p) => set(p),
  load: async (force = false) => {
    if ((get().loaded && !force) || get().loading) return;
    set({ loading: true });
    await useDbStore.getState().load();
    const locationId = useDbStore.getState().locationId;
    if (!locationId) {
      // Não marca `loaded`: cachear vazio antes da empresa chegar prenderia a
      // tela em "nenhum arquivo" para sempre.
      set({ loading: false });
      return;
    }
    const supabase = createClient();
    const [folders, files] = await Promise.all([
      supabase.from("media_folders").select("*").eq("location_id", locationId).order("name"),
      supabase
        .from("media_files")
        .select("*")
        .eq("location_id", locationId)
        .order("created_at", { ascending: false }),
    ]);
    set({
      loaded: true,
      loading: false,
      folders: (folders.data ?? []).map(mapFolder),
      files: (files.data ?? []).map(mapFile),
    });
  },
}));

export function useMedia() {
  const { folders, files, loaded, loading, load } = useMediaStore();
  const locationId = useDbStore((s) => s.locationId);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);
  return { folders, files, loading: loading || !loaded, loaded };
}

/** Soma dos bytes de todos os arquivos — é o "X usados" do topo da tela. */
export function useMediaUsage(): number {
  const { files } = useMediaStore();
  return files.reduce((sum, f) => sum + (f.size ?? 0), 0);
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : value >= 100 ? 0 : 2).replace(".", ",")} ${units[i]}`;
}

const loc = () => useDbStore.getState().locationId;
const uid = () => useDbStore.getState().userId;

export const mediaActions = {
  async createFolder(name: string, parentId: string | null): Promise<boolean> {
    const locationId = loc();
    if (!locationId || !name.trim()) return false;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("media_folders")
      .insert({
        location_id: locationId,
        name: name.trim(),
        parent_id: parentId,
        created_by: uid(),
      })
      .select()
      .single();
    if (error || !data) return false;
    const s = useMediaStore.getState();
    s.patch({
      folders: [...s.folders, mapFolder(data)].sort((a, b) => a.name.localeCompare(b.name)),
    });
    return true;
  },

  async renameFolder(id: string, name: string): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("media_folders")
      .update({ name: name.trim() })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error || !data) return false;
    const s = useMediaStore.getState();
    s.patch({
      folders: s.folders
        .map((f) => (f.id === id ? { ...f, name: name.trim() } : f))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
    return true;
  },

  /**
   * Exclui a pasta. Os arquivos NÃO vão embora: o `on delete set null` da 0044
   * devolve todos para a raiz. Perder um vídeo por causa de uma pasta excluída
   * não teria desfazer.
   */
  async removeFolder(id: string): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("media_folders")
      .delete()
      .eq("id", id)
      .select("id");
    if (error || !data?.length) return false;
    const s = useMediaStore.getState();
    s.patch({
      folders: s.folders.filter((f) => f.id !== id && f.parentId !== id),
      files: s.files.map((f) => (f.folderId === id ? { ...f, folderId: null } : f)),
    });
    return true;
  },

  async upload(file: File, folderId: string | null): Promise<{ ok: boolean; error?: string }> {
    const locationId = loc();
    if (!locationId) return { ok: false, error: "Empresa não encontrada" };
    if (file.size > MEDIA_MAX_BYTES) {
      return { ok: false, error: `Arquivo maior que ${formatBytes(MEDIA_MAX_BYTES)}` };
    }
    const supabase = createClient();
    const ext = file.name.includes(".") ? file.name.split(".").pop() : null;
    const path = `${locationId}/${crypto.randomUUID()}${ext ? `.${ext}` : ""}`;

    const up = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (up.error) return { ok: false, error: up.error.message };

    const { data, error } = await supabase
      .from("media_files")
      .insert({
        location_id: locationId,
        folder_id: folderId,
        name: file.name,
        path,
        size: file.size,
        mime: file.type || null,
        uploaded_by: uid(),
      })
      .select()
      .single();
    if (error || !data) {
      // Metadado falhou: o binário órfão no bucket contaria no espaço usado e
      // não apareceria em tela nenhuma. Desfaz.
      await supabase.storage.from(MEDIA_BUCKET).remove([path]);
      return { ok: false, error: error?.message ?? "Falha ao registrar o arquivo" };
    }
    const s = useMediaStore.getState();
    s.patch({ files: [mapFile(data), ...s.files] });
    return { ok: true };
  },

  async move(fileId: string, folderId: string | null): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("media_files")
      .update({ folder_id: folderId })
      .eq("id", fileId)
      .select()
      .maybeSingle();
    if (error || !data) return false;
    const s = useMediaStore.getState();
    s.patch({ files: s.files.map((f) => (f.id === fileId ? { ...f, folderId } : f)) });
    return true;
  },

  async rename(fileId: string, name: string): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("media_files")
      .update({ name: name.trim() })
      .eq("id", fileId)
      .select()
      .maybeSingle();
    if (error || !data) return false;
    const s = useMediaStore.getState();
    s.patch({ files: s.files.map((f) => (f.id === fileId ? { ...f, name: name.trim() } : f)) });
    return true;
  },

  /** Apaga o binário e o metadado. O binário primeiro seria pior: falha no
   * meio deixaria o card na tela apontando para um arquivo que não existe. */
  async remove(file: MediaFile): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("media_files")
      .delete()
      .eq("id", file.id)
      .select("id");
    if (error || !data?.length) return false;
    await supabase.storage.from(MEDIA_BUCKET).remove([file.path]);
    const s = useMediaStore.getState();
    s.patch({ files: s.files.filter((f) => f.id !== file.id) });
    return true;
  },

  /** URL temporária (1h) para ver/baixar — o bucket é privado. */
  async signedUrl(path: string): Promise<string | null> {
    const supabase = createClient();
    const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  },
};
