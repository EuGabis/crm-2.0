"use client";

/**
 * Seletor de figurinhas do composer.
 *
 * O WhatsApp não deixa o CRM ler as figurinhas salvas no celular, então o
 * acervo é o que já passou pela empresa: toda figurinha RECEBIDA ou ENVIADA
 * fica guardada como imagem `sticker.webp` (webhook / envio), e reaparece aqui.
 * Sem tabela nova: o acervo se monta sozinho conforme os clientes mandam.
 * Também dá para enviar um `.webp` do computador.
 */
import { useEffect, useRef, useState } from "react";
import { Sticker, Upload } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "conversation-media";
/** Limite da Meta para figurinha animada; a estática é 100 KB. */
export const MAX_FIGURINHA = 500 * 1024;

interface Item {
  path: string;
  url: string;
}

async function carregarAcervo(): Promise<Item[]> {
  const supabase = createClient();
  // consulta-ok: limit explícito; o acervo mostra as 120 mais recentes.
  const { data, error } = await supabase
    .from("messages")
    .select("media_path, media_size, created_at")
    .eq("type", "image")
    .like("media_name", "sticker.%")
    .not("media_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(120);
  if (error || !data) return [];
  // A mesma figurinha recebida várias vezes vira vários arquivos: tamanho em
  // bytes idêntico é um bom sinal de que é a mesma, e evita repetir no acervo.
  const vistos = new Set<string>();
  const paths: string[] = [];
  for (const m of data) {
    const chave = String(m.media_size ?? m.media_path);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    paths.push(m.media_path as string);
    if (paths.length >= 48) break;
  }
  if (!paths.length) return [];
  const { data: urls } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  return (urls ?? [])
    .filter((u) => u.signedUrl && u.path)
    .map((u) => ({ path: u.path as string, url: u.signedUrl as string }));
}

export function StickerPicker({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (file: File) => void;
}) {
  const [open, setOpen] = useState(false);
  const [itens, setItens] = useState<Item[] | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || itens) return;
    let vivo = true;
    carregarAcervo().then((r) => vivo && setItens(r));
    return () => {
      vivo = false;
    };
  }, [open, itens]);

  const escolher = async (item: Item) => {
    setBaixando(item.path);
    try {
      const blob = await (await fetch(item.url)).blob();
      onPick(new File([blob], "sticker.webp", { type: "image/webp" }));
      setOpen(false);
    } finally {
      setBaixando(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            title="Figurinha"
            disabled={disabled}
            className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
          />
        }
      >
        <Sticker className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-72 overflow-y-auto p-2">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Figurinhas
          </p>
          <button
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-indigo-600 hover:bg-indigo-50"
          >
            <Upload className="size-3" /> Enviar .webp
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/webp,.webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              onPick(new File([f], "sticker.webp", { type: "image/webp" }));
              setOpen(false);
            }}
          />
        </div>
        {itens === null ? (
          <p className="py-6 text-center text-xs text-slate-400">Carregando…</p>
        ) : itens.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">
            Nenhuma figurinha ainda. As que os clientes mandarem aparecem aqui — ou envie um
            arquivo .webp.
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-1">
            {itens.map((it) => (
              <button
                key={it.path}
                onClick={() => escolher(it)}
                disabled={baixando !== null}
                className="rounded p-1 hover:bg-slate-100 disabled:opacity-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.url} alt="figurinha" className="size-14 object-contain" />
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
