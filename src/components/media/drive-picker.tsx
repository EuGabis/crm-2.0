"use client";

import { useEffect, useState } from "react";
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

interface GoogleConfig {
  clientId: string;
  apiKey: string;
  clientIdSource: string | null;
  apiKeySource: string | null;
}

export function DrivePicker({ onPicked }: { onPicked: () => void }) {
  const [busy, setBusy] = useState(false);
  const [originError, setOriginError] = useState<string | null>(null);
  // Vem do SERVIDOR, não de process.env.NEXT_PUBLIC_* aqui: variável
  // `NEXT_PUBLIC_` é embutida no bundle durante o build, então defini-la na
  // Vercel sem refazer o deploy não mudava nada e a tela seguia dizendo "falta
  // configurar" — foi o que aconteceu em produção. Ver /api/media/google-config.
  const [config, setConfig] = useState<GoogleConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/media/google-config")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((c: GoogleConfig) => active && setConfig(c))
      .catch((e: unknown) => {
        if (active) setConfigError(e instanceof Error ? e.message : "falha ao consultar");
      });
    return () => {
      active = false;
    };
  }, []);

  const clientId = config?.clientId ?? "";
  const apiKey = config?.apiKey ?? "";
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
      const msg = e instanceof Error ? e.message : "Não foi possível abrir o Google Drive";
      // "no registered origin" / invalid_client = a ORIGEM desta página não está
      // cadastrada no client OAuth. Dizer qual origem é resolve em um passo; sem
      // isso a pessoa fica adivinhando entre localhost, produção e preview.
      const originIssue = /origin|invalid_client/i.test(msg);
      setOriginError(originIssue ? window.location.origin : null);
      toast.error(
        originIssue
          ? `${msg} — cadastre a origem ${window.location.origin} no client OAuth do Google.`
          : msg,
        { duration: originIssue ? 12000 : 6000 }
      );
    }
  };

  if (!config && !configError) {
    return <p className="text-[11px] text-slate-400">Verificando configuração…</p>;
  }

  if (missing) {
    return (
      <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-3 text-left">
        <p className="text-[11px] font-semibold text-amber-800">Falta configurar no servidor</p>
        {configError ? (
          <p className="mt-1 text-[11px] text-amber-700">
            Não foi possível consultar a configuração ({configError}).
          </p>
        ) : (
          <>
            {/* Dizer O QUE falta, e não os dois nomes sempre: metade das vezes
                só uma das duas está de fora. */}
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-amber-700">
              {!clientId && (
                <li>
                  Client id — defina <code>GOOGLE_PICKER_CLIENT_ID</code> (ou{" "}
                  <code>NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID</code>)
                </li>
              )}
              {!apiKey && (
                <li>
                  Chave de API — defina <code>GOOGLE_API_KEY</code> (ou{" "}
                  <code>NEXT_PUBLIC_GOOGLE_API_KEY</code>)
                </li>
              )}
            </ul>
            <p className="mt-1.5 text-[11px] text-amber-700">
              Na Vercel (production + preview + development) e no{" "}
              <code>.env.local</code>. Na Vercel, variável nova só passa a valer
              no <strong>próximo deploy</strong> — salvar não muda o deploy que
              já está no ar (use Redeploy no painel, ou mescle algo na{" "}
              <code>main</code>). No local, basta reiniciar o{" "}
              <code>npm run dev</code>.
            </p>
            <p className="mt-1.5 text-[11px] text-amber-700">
              No client OAuth, cadastre a <strong>origem JavaScript</strong> do CRM
              (<code>{typeof window === "undefined" ? "" : window.location.origin}</code>) — o
              Picker não usa URI de redirecionamento.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={busy} onClick={open}>
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <FolderOpen className="size-3.5" />
        )}
        {busy ? "Abrindo o Drive..." : "Escolher no Google Drive"}
      </Button>
      {originError && (
        <div className="max-w-sm rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-left">
          <p className="text-[11px] font-semibold text-amber-800">Origem não cadastrada</p>
          <p className="mt-1 text-[11px] text-amber-700">
            No client OAuth do Google, em <strong>Origens JavaScript autorizadas</strong>,
            adicione exatamente:
          </p>
          <code className="mt-1 block break-all text-[11px] font-semibold text-amber-900">
            {originError}
          </code>
          <p className="mt-1 text-[10px] text-amber-600">
            Sem barra no fim e sem caminho. Cada endereço é uma origem diferente — localhost,
            produção e cada preview da Vercel precisam estar na lista.
          </p>
          {/* Qual client está sendo usado: "origem não cadastrada" com o client
              ERRADO é indistinguível de "origem não cadastrada" com o certo — e
              já se perdeu uma sessão inteira nessa confusão. */}
          <p className="mt-1.5 break-all text-[10px] text-amber-600">
            Client em uso ({config?.clientIdSource ?? "?"}): <strong>{clientId}</strong>
          </p>
        </div>
      )}
    </div>
  );
}
