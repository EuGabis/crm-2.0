"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ChevronRight,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  Music,
  Palette,
  Pencil,
  Plug,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMyMembership } from "@/lib/data/repos/db/team";
import {
  formatBytes,
  mediaActions,
  MEDIA_MAX_BYTES,
  useMedia,
  useMediaUsage,
  type MediaFile,
} from "@/lib/data/repos/db/media";
import {
  mediaConnectionActions,
  useMediaConnections,
  type ExternalItem,
  type MediaProvider,
} from "@/lib/data/repos/db/media-connections";
import { cn } from "@/lib/utils";

/**
 * `useSearchParams` obriga um limite de Suspense — o callback do OAuth volta
 * com `?connected=` / `?error=` e sem a casca o build falha ao pré-renderizar.
 */
export default function MidiaPage() {
  return (
    <Suspense fallback={null}>
      <MidiaPageInner />
    </Suspense>
  );
}

type Tab = "arquivos" | "google_drive" | "canva";

function iconFor(mime: string | null, name: string) {
  const m = mime ?? "";
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (m.startsWith("image/")) return ImageIcon;
  if (m.startsWith("video/")) return Video;
  if (m.startsWith("audio/")) return Music;
  if (m.includes("csv") || ext === "csv" || ext === "xlsx") return FileSpreadsheet;
  return FileText;
}

function MidiaPageInner() {
  const params = useSearchParams();
  const { isAdmin } = useMyMembership();
  const { folders, files, loading } = useMedia();
  const usage = useMediaUsage();
  const { connections, reload: reloadConnections } = useMediaConnections();
  const [tab, setTab] = useState<Tab>("arquivos");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const connected = (p: MediaProvider) => connections.some((c) => c.provider === p);

  // Volta do OAuth: o callback redireciona para /midia?connected=... | error=...
  useEffect(() => {
    const ok = params.get("connected");
    const err = params.get("error");
    if (ok) {
      toast.success(ok === "canva" ? "Canva conectado" : "Google Drive conectado");
      void reloadConnections();
      setTab(ok === "canva" ? "canva" : "google_drive");
    } else if (err) {
      toast.error(`Não foi possível conectar: ${err}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const currentFolders = useMemo(
    () => folders.filter((f) => f.parentId === folderId),
    [folders, folderId]
  );
  const currentFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files
      .filter((f) => f.folderId === folderId)
      .filter((f) => !q || f.name.toLowerCase().includes(q));
  }, [files, folderId, query]);

  // Trilha até a pasta atual (uma pasta pode ter pai, e o caminho precisa
  // aparecer para dar como voltar).
  const trail = useMemo(() => {
    const path: { id: string; name: string }[] = [];
    let cursor = folderId;
    while (cursor) {
      const found = folders.find((f) => f.id === cursor);
      if (!found) break;
      path.unshift({ id: found.id, name: found.name });
      cursor = found.parentId;
    }
    return path;
  }, [folderId, folders]);

  const upload = async (list: FileList) => {
    setUploading(true);
    let sent = 0;
    const failures: string[] = [];
    for (const file of Array.from(list)) {
      const res = await mediaActions.upload(file, folderId);
      if (res.ok) sent++;
      else failures.push(`${file.name}: ${res.error ?? "falha"}`);
    }
    setUploading(false);
    if (sent > 0) toast.success(`${sent} arquivo${sent > 1 ? "s" : ""} carregado${sent > 1 ? "s" : ""}`);
    if (failures.length > 0) {
      toast.error(failures.slice(0, 4).join("\n"), { duration: 10000 });
    }
  };

  const open = async (file: MediaFile) => {
    const url = await mediaActions.signedUrl(file.path);
    if (!url) {
      toast.error("Não foi possível abrir o arquivo");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Armazenamento de mídia</h1>
          <p className="text-xs text-slate-500">
            Arquivos da empresa no CRM, mais Google Drive e Canva conectados
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            <HardDrive className="size-3" /> {formatBytes(usage)} usados
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={async () => {
              const name = window.prompt("Nome da nova pasta:");
              if (!name?.trim()) return;
              (await mediaActions.createFolder(name, folderId))
                ? toast.success(`Pasta "${name.trim()}" criada`)
                : toast.error("Não foi possível criar a pasta");
            }}
          >
            <FolderPlus className="size-3.5" /> Nova pasta
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {uploading ? "Carregando..." : "Carregar"}
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1 border-b">
        {(
          [
            ["arquivos", `Meus arquivos${files.length ? ` (${files.length})` : ""}`],
            ["google_drive", "Google Drive"],
            ["canva", "Canva"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-xs font-medium",
              tab === key
                ? "border-indigo-500 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            {label}
            {key !== "arquivos" && connected(key as MediaProvider) && (
              <span className="ml-1.5 inline-block size-1.5 rounded-full bg-emerald-500" />
            )}
          </button>
        ))}
      </div>

      {tab === "arquivos" ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <button
                onClick={() => setFolderId(null)}
                className={cn("hover:text-indigo-600", !folderId && "font-semibold text-slate-700")}
              >
                Todos os arquivos
              </button>
              {trail.map((t) => (
                <span key={t.id} className="flex items-center gap-1">
                  <ChevronRight className="size-3 text-slate-300" />
                  <button
                    onClick={() => setFolderId(t.id)}
                    className={cn(
                      "hover:text-indigo-600",
                      t.id === folderId && "font-semibold text-slate-700"
                    )}
                  >
                    {t.name}
                  </button>
                </span>
              ))}
            </div>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar arquivo"
              className="h-8 w-48 text-xs"
            />
          </div>

          {loading ? (
            <p className="rounded-xl border bg-white p-8 text-center text-xs text-slate-400">
              Carregando arquivos...
            </p>
          ) : currentFolders.length === 0 && currentFiles.length === 0 ? (
            <p className="rounded-xl border bg-white p-8 text-center text-xs text-slate-400">
              {query
                ? `Nenhum arquivo com “${query}” nesta pasta.`
                : "Nada aqui ainda. Use “Carregar” para subir imagens, vídeos, PDFs ou planilhas."}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {currentFolders.map((f) => (
                <div
                  key={f.id}
                  className="group rounded-xl border bg-white p-3 hover:border-indigo-300"
                >
                  <button
                    onClick={() => setFolderId(f.id)}
                    className="flex w-full items-center gap-2 text-left"
                  >
                    <span className="flex size-9 items-center justify-center rounded-lg bg-amber-50">
                      <Folder className="size-4 text-amber-500" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-700">
                        {f.name}
                      </span>
                      <span className="block text-[10px] text-slate-400">
                        {files.filter((x) => x.folderId === f.id).length} arquivo(s)
                      </span>
                    </span>
                  </button>
                  <div className="mt-2 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={async () => {
                        const name = window.prompt("Novo nome da pasta:", f.name);
                        if (!name?.trim() || name.trim() === f.name) return;
                        (await mediaActions.renameFolder(f.id, name))
                          ? toast.success("Pasta renomeada")
                          : toast.error("Não foi possível renomear");
                      }}
                      title="Renomear pasta"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `Excluir a pasta "${f.name}"? Os arquivos dela voltam para a raiz.`
                          )
                        )
                          return;
                        (await mediaActions.removeFolder(f.id))
                          ? toast.success("Pasta excluída — arquivos mantidos")
                          : toast.error("Não foi possível excluir");
                      }}
                      title="Excluir pasta"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              ))}

              {currentFiles.map((file) => {
                const Icon = iconFor(file.mime, file.name);
                return (
                  <div
                    key={file.id}
                    className="group flex flex-col rounded-xl border bg-white p-3 hover:border-indigo-300"
                  >
                    <button
                      onClick={() => void open(file)}
                      title="Abrir arquivo"
                      className="flex h-24 items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200"
                    >
                      <Icon className="size-8 text-slate-400" />
                    </button>
                    <p className="mt-2 truncate text-xs font-medium text-slate-700" title={file.name}>
                      {file.name}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {file.size !== null ? formatBytes(file.size) : "—"} ·{" "}
                      {format(new Date(file.createdAt), "dd MMM yyyy", { locale: ptBR })}
                    </p>
                    <div className="mt-2 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => void open(file)}
                        title="Baixar / abrir"
                        className="rounded p-1 text-slate-400 hover:bg-slate-100"
                      >
                        <Download className="size-3" />
                      </button>
                      {folders.length > 0 && (
                        <select
                          value={file.folderId ?? ""}
                          onChange={async (e) => {
                            const next = e.target.value || null;
                            (await mediaActions.move(file.id, next))
                              ? toast.success("Arquivo movido")
                              : toast.error("Não foi possível mover");
                          }}
                          title="Mover para pasta"
                          className="max-w-24 rounded border px-1 py-0.5 text-[10px] text-slate-500"
                        >
                          <option value="">Raiz</option>
                          {folders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        onClick={async () => {
                          const name = window.prompt("Novo nome do arquivo:", file.name);
                          if (!name?.trim() || name.trim() === file.name) return;
                          (await mediaActions.rename(file.id, name))
                            ? toast.success("Arquivo renomeado")
                            : toast.error("Não foi possível renomear");
                        }}
                        title="Renomear"
                        className="rounded p-1 text-slate-400 hover:bg-slate-100"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm(`Excluir "${file.name}"? Não tem desfazer.`)) return;
                          (await mediaActions.remove(file))
                            ? toast.success("Arquivo excluído")
                            : toast.error("Não foi possível excluir");
                        }}
                        title="Excluir"
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-[10px] text-slate-400">
            Até {formatBytes(MEDIA_MAX_BYTES)} por arquivo. Os arquivos ficam num bucket privado —
            os links de visualização expiram em 1 hora.
          </p>
        </>
      ) : (
        <ExternalTab
          provider={tab}
          isAdmin={isAdmin}
          connection={connections.find((c) => c.provider === tab) ?? null}
          onChanged={reloadConnections}
        />
      )}
    </div>
  );
}

const PROVIDER_LABEL: Record<MediaProvider, string> = {
  google_drive: "Google Drive",
  canva: "Canva",
};

function ExternalTab({
  provider,
  isAdmin,
  connection,
  onChanged,
}: {
  provider: MediaProvider;
  isAdmin: boolean;
  connection: { accountLabel: string | null; connectedAt: string } | null;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<ExternalItem[]>([]);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ loading: boolean; error?: string }>({ loading: false });

  useEffect(() => {
    if (!connection) {
      setItems([]);
      return;
    }
    let active = true;
    setState({ loading: true });
    void mediaConnectionActions.list(provider, query).then((res) => {
      if (!active) return;
      setItems(res.items);
      setState({ loading: false, error: res.error });
    });
    return () => {
      active = false;
    };
    // Busca só quando o termo assenta (a lista vem da API do provedor).
  }, [provider, connection, query]);

  if (!connection) {
    return (
      <div className="rounded-xl border bg-white p-8 text-center">
        <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-slate-100">
          {provider === "canva" ? (
            <Palette className="size-5 text-slate-500" />
          ) : (
            <Plug className="size-5 text-slate-500" />
          )}
        </span>
        <p className="text-sm font-semibold text-slate-800">
          {PROVIDER_LABEL[provider]} não conectado
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
          {provider === "canva"
            ? "Conecte para listar seus designs e abrir no editor do Canva sem sair do CRM."
            : "Conecte para listar e abrir os arquivos do Drive da empresa. Somente leitura — o CRM nunca altera nada lá."}
        </p>
        {isAdmin ? (
          <a href={mediaConnectionActions.startPath(provider)}>
            <Button size="sm" className="mt-4 h-8 gap-1.5 text-xs">
              <Plug className="size-3.5" /> Conectar {PROVIDER_LABEL[provider]}
            </Button>
          </a>
        ) : (
          <p className="mt-4 text-[11px] text-amber-600">
            Apenas administradores conectam integrações.
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2">
        <p className="text-[11px] text-slate-500">
          <span className="font-semibold text-slate-700">{PROVIDER_LABEL[provider]}</span> ·{" "}
          {connection.accountLabel ?? "conta conectada"} · desde{" "}
          {format(new Date(connection.connectedAt), "dd MMM yyyy", { locale: ptBR })}
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar"
            className="h-7 w-40 text-xs"
          />
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] text-red-600 hover:text-red-700"
              onClick={async () => {
                if (!window.confirm(`Desconectar o ${PROVIDER_LABEL[provider]}?`)) return;
                const res = await mediaConnectionActions.disconnect(provider);
                if (res.ok) {
                  toast.success(`${PROVIDER_LABEL[provider]} desconectado`);
                  onChanged();
                } else {
                  toast.error(res.error ?? "Não foi possível desconectar");
                }
              }}
            >
              Desconectar
            </Button>
          )}
        </div>
      </div>

      {state.loading ? (
        <p className="rounded-xl border bg-white p-8 text-center text-xs text-slate-400">
          Carregando de {PROVIDER_LABEL[provider]}...
        </p>
      ) : state.error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-xs text-red-600">
          {state.error}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border bg-white p-8 text-center text-xs text-slate-400">
          Nada encontrado em {PROVIDER_LABEL[provider]}.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => {
            const Icon = iconFor(item.mime, item.name);
            return (
              <a
                key={item.id}
                href={item.url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col rounded-xl border bg-white p-3 hover:border-indigo-300"
              >
                <span className="flex h-24 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                  {item.thumbnail ? (
                    // Miniatura vem do provedor (Drive/Canva). `img` cru em vez
                    // de next/image: são hosts externos e variáveis, e a lista
                    // muda a cada busca.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnail}
                      alt={item.name}
                      className="size-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Icon className="size-8 text-slate-400" />
                  )}
                </span>
                <span className="mt-2 flex items-center gap-1 truncate text-xs font-medium text-slate-700">
                  <span className="truncate">{item.name}</span>
                  <ExternalLink className="size-3 shrink-0 text-slate-300" />
                </span>
                {item.updatedAt && (
                  <span className="text-[10px] text-slate-400">
                    {format(new Date(item.updatedAt), "dd MMM yyyy", { locale: ptBR })}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}
