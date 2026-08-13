"use client";

import { useState } from "react";
import { Copy, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { aiActions } from "@/lib/data/repos/db/ai";

const FORMATS: Record<string, string> = {
  "Post Instagram":
    "um post para Instagram: curto, com emojis e hashtags relevantes ao final",
  "E-mail": "um e-mail de marketing: comece com uma linha 'Assunto:' e depois o corpo",
  Anúncio: "um anúncio curto e persuasivo, com uma chamada para ação (CTA) clara",
};

export function ContentAiTab() {
  const [format, setFormat] = useState("Post Instagram");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    const p = prompt.trim();
    if (!p) return toast.error("Descreva o que você quer criar");
    setLoading(true);
    setResult(null);
    const system = `Você é redator de marketing e vendas do Lito CRM. Escreva em português do Brasil, tom persuasivo e claro. Formato: ${FORMATS[format]}. Devolva apenas o texto final, pronto para publicar, sem comentários seus.`;
    const res = await aiActions.generate({ feature: "content", system, prompt: p });
    setLoading(false);
    if (res.ok) setResult(res.text ?? "");
    else toast.error(res.error ?? "Falha ao gerar");
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      toast.success("Copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  return (
    <>
      <h1 className="mb-1 text-lg font-bold text-slate-900">Content AI</h1>
      <p className="mb-4 text-xs text-slate-500">
        Gere textos de marketing e vendas prontos para usar nos seus canais.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">O que você quer criar?</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ex.: um texto convidando leads para testar o CRM por 7 dias grátis"
                className="min-h-24 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Formato</Label>
              <Select value={format} onValueChange={(v) => v && setFormat(v)}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue>{format}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(FORMATS).map((f) => (
                    <SelectItem key={f} value={f} className="text-xs">
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" className="h-8 text-xs" onClick={generate} disabled={loading}>
              <Sparkles className="size-3.5" /> {loading ? "Gerando..." : "Gerar"}
            </Button>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Resultado</h2>
            {result && (
              <button onClick={copy} className="flex items-center gap-1 text-[11px] text-indigo-600 hover:underline">
                <Copy className="size-3" /> Copiar
              </button>
            )}
          </div>
          {result ? (
            <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{result}</p>
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-center text-xs text-slate-400">
              {loading ? "Gerando conteúdo..." : "O conteúdo gerado aparecerá aqui."}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
