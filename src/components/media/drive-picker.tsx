"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { driveActions, type PickedFile } from "@/lib/data/repos/db/media-drive";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Botão "Escolher no Google Drive" — abre o Google Picker.
 *
 * Caminho recomendado pela doc do Drive: escopo `drive.file` + Picker. O app
 * recebe acesso APENAS aos arquivos que a pessoa escolher, e por isso não cai
 * na verificação de segurança que o `drive.readonly` (restrito) exigiria.
 *
 * Consequência de arquitetura: o token do Drive é pedido NO NAVEGADOR, pelo
 * Google Identity Services, e vive só durante a escolha — não passa pelo nosso
 * servidor e não é guardado em lugar nenhum. Isso também elimina o
 * redirect_uri: o que o client OAuth precisa ter cadastrado aqui é a ORIGEM
 * JavaScript (ex.: https://lito-crm.vercel.app), não uma URI de callback.
 */

const GSI_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SRC = "https://apis.google.com/js/api.js";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") return reject(new Error("sem DOM"));
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error(`falha ao carregar ${src}`)));
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => {
      el.dataset.loaded = "1";
      resolve();
    };
    el.onerror = () => reject(new Error(`falha ao carregar ${src}`));
    document.head.appendChild(el);
  });
}

/** Pede um token de acesso ao usuário, só para esta escolha. */
function requestToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const google = (window as any).google;
    if (!google?.accounts?.oauth2) return reject(new Error("Google Identity não carregou"));
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (res: any) => {
        if (res?.access_token) resolve(res.access_token);
        else reject(new Error(res?.error_description || res?.error || "permissão negada"));
      },
      error_callback: (err: any) => reject(new Error(err?.message || "janela fechada")),
    });
    client.requestAccessToken();
  });
}

function loadPicker(): Promise<void> {
  return new Promise((resolve, reject) => {
    const gapi = (window as any).gapi;
    if (!gapi) return reject(new Error("gapi não carregou"));
    gapi.load("picker", { callback: () => resolve(), onerror: () => reject(new Error("picker")) });
  });
}

export function DrivePicker({ onPicked }: { onPicked: () => void }) {
  const [busy, setBusy] = useState(false);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? "";
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
  // O appId do Picker é o NÚMERO DO PROJETO, que é justamente o prefixo do
  // client id (`281501150929-xxxx.apps.googleusercontent.com`). Derivar daqui
  // evita uma env a mais para errar.
  const appId = clientId.split("-")[0] ?? "";

  const missing = !clientId || !apiKey;

  const open = async () => {
    setBusy(true);
    try {
      await Promise.all([loadScript(GSI_SRC), loadScript(GAPI_SRC)]);
      const token = await requestToken(clientId);
      await loadPicker();
      const google = (window as any).google;

      const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);

      const picker = new google.picker.PickerBuilder()
        .setOAuthToken(token)
        .setDeveloperKey(apiKey)
        .setAppId(appId)
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .addView(view)
        .addView(new google.picker.DocsUploadView())
        .setCallback(async (data: any) => {
          if (data.action !== google.picker.Action.PICKED) {
            if (data.action === google.picker.Action.CANCEL) setBusy(false);
            return;
          }
          const files: PickedFile[] = (data.docs ?? []).map((d: any) => ({
            fileId: d.id,
            name: d.name ?? "Arquivo do Drive",
            mime: d.mimeType ?? null,
            iconUrl: d.iconUrl ?? null,
            url: d.url ?? null,
          }));
          const res = await driveActions.savePicked(files);
          setBusy(false);
          if (res.error) {
            toast.error(`Não foi possível salvar: ${res.error}`);
            return;
          }
          toast.success(
            `${res.saved} arquivo${res.saved === 1 ? "" : "s"} do Drive ${
              res.saved === 1 ? "vinculado" : "vinculados"
            }`
          );
          onPicked();
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir o Google Drive");
    }
  };

  if (missing) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-left">
        <p className="text-[11px] font-semibold text-amber-800">Falta configurar no servidor</p>
        <p className="mt-1 text-[11px] text-amber-700">
          Defina <code>NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID</code> e{" "}
          <code>NEXT_PUBLIC_GOOGLE_API_KEY</code> (Vercel + .env.local). No client OAuth,
          cadastre a <strong>origem JavaScript</strong> do CRM — o Picker não usa URI de
          redirecionamento.
        </p>
      </div>
    );
  }

  return (
    <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={busy} onClick={open}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}
      {busy ? "Abrindo o Drive..." : "Escolher no Google Drive"}
    </Button>
  );
}
