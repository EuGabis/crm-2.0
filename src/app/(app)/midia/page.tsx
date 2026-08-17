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
import { driveActions, useDriveItems } from "@/lib/data/repos/db/media-drive";
import { DrivePicker } from "@/components/media/drive-picker";
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

type Tab = "arquivos" | "google_drive";

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
  const { folders, files, loading } = useMedia();
  const usage = useMediaUsage();
  const [tab, setTab] = useState<Tab>("arquivos");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // O Google Drive é escolhido pelo Picker, no navegador — não há mais volta de
  // OAuth para tratar aqui. Fica só o erro, que a URL ainda pode trazer.
  useEffect(() => {
    const err = params.get("error");
    if (err) toast.error(`Não foi possível conectar: ${err}`);
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
            Arquivos da empresa no CRM, mais os arquivos do Google Drive
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
        <DriveTab />
      )}
    </div>
  );
}

/**
 * Aba do Google Drive. Não lista o Drive inteiro: a pessoa ESCOLHE arquivos no
 * Google Picker e o CRM guarda a referência.
 *
 * É o caminho recomendado pela doc do Drive — `drive.file` + Picker dá acesso
 * só ao que foi escolhido, enquanto `drive.readonly` (listar tudo) é escopo
 * RESTRITO e exigiria verificação de segurança do Google para funcionar fora
 * dos test users.
 */
function DriveTab() {
  const { items, loaded, reload } = useDriveItems();
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
  }, [items, query]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          Arquivos vinculados do Google Drive. O CRM guarda só o atalho — o arquivo continua no
          Drive de quem escolheu.
        </p>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar"
              className="h-8 w-40 text-xs"
            />
          )}
          <DrivePicker onPicked={reload} />
        </div>
      </div>

      {!loaded ? (
        <p className="rounded-xl border bg-white p-8 text-center text-xs text-slate-400">
          Carregando...
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border bg-white p-8 text-center text-xs text-slate-400">
          {items.length === 0
            ? "Nenhum arquivo do Drive vinculado. Use “Escolher no Google Drive”."
            : `Nenhum arquivo com “${query}”.`}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {visible.map((item) => {
            const Icon = iconFor(item.mime, item.name);
            return (
              <div
                key={item.id}
                className="group flex flex-col rounded-xl border bg-white p-3 hover:border-indigo-300"
              >
                <a
                  href={item.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-24 items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200"
                >
                  <Icon className="size-8 text-slate-400" />
                </a>
                <p className="mt-2 flex items-center gap-1 text-xs font-medium text-slate-700">
                  <span className="truncate" title={item.name}>
                    {item.name}
                  </span>
                  <ExternalLink className="size-3 shrink-0 text-slate-300" />
                </p>
                <p className="text-[10px] text-slate-400">
                  Vinculado em {format(new Date(item.createdAt), "dd MMM yyyy", { locale: ptBR })}
                </p>
                <div className="mt-2 flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Remover o atalho de "${item.name}"? O arquivo no Drive não é apagado.`
                        )
                      )
                        return;
                      if (await driveActions.remove(item.id)) {
                        toast.success("Atalho removido");
                        void reload();
                      } else {
                        toast.error("Não foi possível remover");
                      }
                    }}
                    title="Remover atalho (não apaga no Drive)"
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
    </>
  );
}
