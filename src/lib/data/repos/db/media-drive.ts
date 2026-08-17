"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "./contacts";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Arquivos do Google Drive escolhidos pelo Picker (migração 0046).
 *
 * Guardamos só o PONTEIRO (id, nome, tipo, link) — o arquivo continua no Drive
 * de quem escolheu. Sem esta tabela, a escolha valeria só até fechar a aba.
 *
 * Por que Picker e não listagem: `drive.readonly` é escopo RESTRITO (exige
 * verificação de segurança do Google). `drive.file` + Picker dá acesso apenas
 * ao que o usuário escolheu, sem verificação — é a recomendação da doc oficial.
 */

export interface DriveItem {
  id: string;
  fileId: string;
  name: string;
  mime: string | null;
  iconUrl: string | null;
  url: string | null;
  createdAt: string;
}

const map = (r: any): DriveItem => ({
  id: r.id,
  fileId: r.file_id,
  name: r.name,
  mime: r.mime ?? null,
  iconUrl: r.icon_url ?? null,
  url: r.url ?? null,
  createdAt: r.created_at,
});

export function useDriveItems() {
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const locationId = useDbStore((s) => s.locationId);

  const load = useCallback(async () => {
    await useDbStore.getState().load();
    const loc = useDbStore.getState().locationId;
    if (!loc) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("media_drive_items")
      .select("*")
      .eq("location_id", loc)
      .order("created_at", { ascending: false });
    if (error) {
      // Migração 0046 ainda não aplicada, por exemplo — não trava a tela.
      console.warn("[midia] media_drive_items indisponível:", error.message);
      setLoaded(true);
      return;
    }
    setItems((data ?? []).map(map));
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load, locationId]);

  return { items, loaded, reload: load };
}

export interface PickedFile {
  fileId: string;
  name: string;
  mime?: string | null;
  iconUrl?: string | null;
  url?: string | null;
}

export const driveActions = {
  /** Grava as escolhas do Picker. Reescolher o mesmo arquivo não duplica. */
  async savePicked(files: PickedFile[]): Promise<{ saved: number; error?: string }> {
    const loc = useDbStore.getState().locationId;
    const userId = useDbStore.getState().userId;
    if (!loc) return { saved: 0, error: "Empresa não encontrada" };
    if (files.length === 0) return { saved: 0 };
    const supabase = createClient();
    const { data, error } = await supabase
      .from("media_drive_items")
      .upsert(
        files.map((f) => ({
          location_id: loc,
          file_id: f.fileId,
          name: f.name,
          mime: f.mime ?? null,
          icon_url: f.iconUrl ?? null,
          url: f.url ?? null,
          picked_by: userId,
        })),
        { onConflict: "location_id,file_id" }
      )
      .select("id");
    if (error) return { saved: 0, error: error.message };
    return { saved: data?.length ?? 0 };
  },

  /** Remove só a referência daqui — o arquivo no Drive fica intacto. */
  async remove(id: string): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("media_drive_items")
      .delete()
      .eq("id", id)
      .select("id");
    return !error && !!data?.length;
  },
};
