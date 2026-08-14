"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { whatsappActions } from "@/lib/data/repos/db/whatsapp";

interface Template {
  name: string;
  language: string;
  category: string;
  components: unknown[];
}

/** Conta as variáveis {{n}} do componente BODY do template. */
function bodyVarCount(components: unknown[] | undefined): number {
  const body = (components ?? []).find(
    (c) => String((c as { type?: unknown })?.type || "").toUpperCase() === "BODY",
  ) as { text?: string } | undefined;
  const text = body?.text;
  if (!text) return 0;
  const nums = (text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) =>
    parseInt(m.replace(/\D/g, ""), 10),
  );
  return nums.length ? Math.max(...nums) : 0;
}

function bodyText(components: unknown[] | undefined): string {
  const body = (components ?? []).find(
    (c) => String((c as { type?: unknown })?.type || "").toUpperCase() === "BODY",
  ) as { text?: string } | undefined;
  return body?.text ?? "";
}

export function TemplatePicker({
  open,
  onOpenChange,
  channelId,
  onPick,
  /**
   * true quando o seletor abriu porque o envio bateu no 409 da janela de 24h.
   * Aberto pelo atalho do composer (dentro da janela), a explicação seria
   * falsa — daí a mensagem mudar.
   */
  outsideWindow = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channelId: string | null;
  onPick: (t: { name: string; language: string; components?: unknown[] }) => void;
  outsideWindow?: boolean;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Template | null>(null);
  const [params, setParams] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !channelId) return;
    setLoading(true);
    void whatsappActions.templates(channelId).then((t) => {
      setTemplates(t);
      setLoading(false);
    });
  }, [open, channelId]);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setParams([]);
    }
  }, [open]);

  function handlePick(t: Template) {
    const count = bodyVarCount(t.components);
    if (count === 0) {
      onPick({ name: t.name, language: t.language });
      onOpenChange(false);
      return;
    }
    setSelected(t);
    setParams(Array(count).fill(""));
  }

  function handleSend() {
    if (!selected) return;
    onPick({
      name: selected.name,
      language: selected.language,
      components: [
        { type: "body", parameters: params.map((p) => ({ type: "text", text: p })) },
      ],
    });
    onOpenChange(false);
  }

  const allFilled = params.length > 0 && params.every((p) => p.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{selected ? `Variáveis — ${selected.name}` : "Escolher template"}</DialogTitle>
        </DialogHeader>

        {!selected && (
          <>
            <p className="text-xs text-slate-500">
              {outsideWindow
                ? "A janela de 24h fechou — fora dela, o WhatsApp só permite iniciar com um template aprovado."
                : "Templates aprovados na Meta. Enviam mesmo fora da janela de 24h."}
            </p>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {loading && <p className="p-4 text-center text-xs text-slate-400">Carregando…</p>}
              {!loading && templates.length === 0 && (
                <p className="p-4 text-center text-xs text-slate-400">
                  Nenhum template aprovado nesta WABA.
                </p>
              )}
              {templates.map((t) => (
                <button
                  key={`${t.name}-${t.language}`}
                  onClick={() => handlePick(t)}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs hover:bg-slate-50"
                >
                  <span className="font-semibold text-slate-800">{t.name}</span>
                  <span className="text-[10px] text-slate-400">
                    {t.language} · {t.category}
                  </span>
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          </>
        )}

        {selected && (
          <>
            <p className="rounded-md border bg-slate-50 p-2 text-xs text-slate-600">
              {bodyText(selected.components)}
            </p>
            <div className="max-h-72 space-y-3 overflow-y-auto">
              {params.map((value, i) => (
                <div key={i} className="space-y-1">
                  <Label htmlFor={`tpl-var-${i}`} className="text-xs">
                    Variável {i + 1}
                  </Label>
                  <Input
                    id={`tpl-var-${i}`}
                    className="h-8 text-xs"
                    value={value}
                    onChange={(e) => {
                      const next = [...params];
                      next[i] = e.target.value;
                      setParams(next);
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setSelected(null);
                  setParams([]);
                }}
              >
                Voltar
              </Button>
              <Button
                size="sm"
                className="h-8 flex-1 text-xs"
                disabled={!allFilled}
                onClick={handleSend}
              >
                Enviar
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
