"use client";

import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, Loader2, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { enviarMidiaDeEmail } from "@/lib/data/repos/db/email-midia";
import {
  DESIGN_PADRAO,
  FONTES,
  LIMITES,
  TEMAS,
  normalizarDesign,
  type DesignEmail,
} from "@/lib/email/design";
import { cn } from "@/lib/utils";
import { SeletorCor } from "./seletor-cor";

/**
 * Painel "Design do e-mail" do composer: tema pronto, cores, cabeçalho/logo,
 * letra, layout e rodapé. Tudo grava em `email_campaigns.design` e passa por
 * `normalizarDesign` antes de virar CSS (`lib/email/design.ts`).
 */
export function PainelDesign({
  design,
  onChange,
  sugestoesCor,
  logoEmpresa,
}: {
  design: DesignEmail;
  onChange: (d: DesignEmail) => void;
  sugestoesCor: string[];
  logoEmpresa: string | null;
}) {
  const set = (p: Partial<DesignEmail>) => onChange(normalizarDesign({ ...design, ...p }));
  const sug = [...sugestoesCor, design.corDestaque, design.corCabecalho];
  const [subindoLogo, setSubindoLogo] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);

  const subirLogo = async (f: File | undefined) => {
    if (!f) return;
    setSubindoLogo(true);
    const r = await enviarMidiaDeEmail(f, "imagem");
    setSubindoLogo(false);
    if (!r.ok) return toast.error(`Logo não enviado: ${r.erro}`);
    set({ logoUrl: r.arquivo.url, cabecalho: "logo" });
  };

  return (
    <div className="rounded-xl border bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-xs font-semibold text-slate-800">Design do e-mail</p>
        <button
          type="button"
          onClick={() => onChange(DESIGN_PADRAO)}
          className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800"
          title="Voltar ao visual padrão"
        >
          <RotateCcw className="size-3" /> Restaurar
        </button>
      </div>

      <Secao titulo="Tema" aberta>
        <div className="grid grid-cols-3 gap-1.5">
          {TEMAS.map((t) => {
            const d = normalizarDesign({ ...DESIGN_PADRAO, ...t.design });
            return (
              <button
                key={t.key}
                type="button"
                onClick={() =>
                  // O tema troca o visual mas preserva o que é CONTEÚDO da
                  // campanha (logo, textos de cabeçalho e rodapé).
                  onChange(
                    normalizarDesign({
                      ...d,
                      logoUrl: design.logoUrl,
                      textoCabecalho: design.textoCabecalho,
                      textoRodape: design.textoRodape,
                      cabecalho: t.design.cabecalho ?? (design.logoUrl ? design.cabecalho : d.cabecalho),
                    }),
                  )
                }
                className="overflow-hidden rounded-lg border text-left hover:border-indigo-300"
                title={t.label}
              >
                <div className="h-9 p-1.5" style={{ backgroundColor: d.corFundo }}>
                  <div
                    className="h-full overflow-hidden"
                    style={{ backgroundColor: d.corConteudo, borderRadius: Math.min(d.cantos, 6) }}
                  >
                    {d.cabecalho !== "nenhum" && <div className="h-2" style={{ backgroundColor: d.corCabecalho }} />}
                    <div className="mx-1 mt-1 h-1 w-3/4 rounded" style={{ backgroundColor: d.corTitulo }} />
                    <div className="mx-1 mt-0.5 h-1.5 w-1/3 rounded" style={{ backgroundColor: d.corDestaque }} />
                  </div>
                </div>
                <p className="truncate px-1.5 py-1 text-[10px] font-medium text-slate-600">{t.label}</p>
              </button>
            );
          })}
        </div>
      </Secao>

      <Secao titulo="Cores" aberta>
        <div className="grid grid-cols-2 gap-2">
          <Campo label="Destaque (links, botões)">
            <SeletorCor value={design.corDestaque} sugestoes={sug} onChange={(c) => set({ corDestaque: c })} />
          </Campo>
          <Campo label="Fundo da página">
            <SeletorCor value={design.corFundo} sugestoes={sug} onChange={(c) => set({ corFundo: c })} />
          </Campo>
          <Campo label="Fundo do conteúdo">
            <SeletorCor value={design.corConteudo} sugestoes={sug} onChange={(c) => set({ corConteudo: c })} />
          </Campo>
          <Campo label="Texto">
            <SeletorCor value={design.corTexto} sugestoes={sug} onChange={(c) => set({ corTexto: c })} />
          </Campo>
          <Campo label="Títulos">
            <SeletorCor value={design.corTitulo} sugestoes={sug} onChange={(c) => set({ corTitulo: c })} />
          </Campo>
          <Campo label="Rodapé">
            <SeletorCor value={design.corRodape} sugestoes={sug} onChange={(c) => set({ corRodape: c })} />
          </Campo>
        </div>
        <Linha label="Faixa colorida no topo">
          <Switch checked={design.faixaDestaque} onCheckedChange={(v) => set({ faixaDestaque: !!v })} />
        </Linha>
      </Secao>

      <Secao titulo="Cabeçalho">
        <div className="flex gap-1">
          {(
            [
              ["marca", "Nome"],
              ["logo", "Logo"],
              ["nenhum", "Sem cabeçalho"],
            ] as const
          ).map(([k, l]) => (
            <Opcao
              key={k}
              active={design.cabecalho === k}
              onClick={() => {
                if (k === "logo" && !design.logoUrl) {
                  if (logoEmpresa) set({ cabecalho: "logo", logoUrl: logoEmpresa });
                  else logoRef.current?.click();
                  return;
                }
                set({ cabecalho: k });
              }}
            >
              {l}
            </Opcao>
          ))}
        </div>
        {design.cabecalho === "logo" && design.logoUrl && (
          <div className="flex items-center gap-2 rounded-lg border p-2" style={{ backgroundColor: design.corCabecalho }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={design.logoUrl} alt="Logo" className="h-8 max-w-[120px] object-contain" />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => logoRef.current?.click()}
            className="flex items-center gap-1 text-[11px] text-indigo-600 hover:underline"
          >
            {subindoLogo ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
            Enviar logo
          </button>
          {logoEmpresa && design.logoUrl !== logoEmpresa && (
            <button
              type="button"
              onClick={() => set({ logoUrl: logoEmpresa, cabecalho: "logo" })}
              className="text-[11px] text-indigo-600 hover:underline"
            >
              Usar logo da empresa
            </button>
          )}
        </div>
        <input
          ref={logoRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            void subirLogo(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {design.cabecalho !== "nenhum" && (
          <>
            {design.cabecalho === "marca" && (
              <Campo label="Nome no cabeçalho">
                <input
                  value={design.textoCabecalho}
                  onChange={(e) => set({ textoCabecalho: e.target.value })}
                  placeholder="Lito CRM"
                  className="h-8 w-full rounded-md border px-2 text-xs"
                />
              </Campo>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Campo label="Fundo do cabeçalho">
                <SeletorCor value={design.corCabecalho} sugestoes={sug} onChange={(c) => set({ corCabecalho: c })} />
              </Campo>
              {design.cabecalho === "marca" ? (
                <Campo label="Texto do cabeçalho">
                  <SeletorCor
                    value={design.corTextoCabecalho}
                    sugestoes={["#ffffff", "#0f172a", ...sug]}
                    onChange={(c) => set({ corTextoCabecalho: c })}
                  />
                </Campo>
              ) : (
                <Faixa
                  label="Altura do logo"
                  valor={design.alturaLogo}
                  faixa={LIMITES.alturaLogo}
                  sufixo="px"
                  onChange={(v) => set({ alturaLogo: v })}
                />
              )}
            </div>
            <div className="flex gap-1">
              <Opcao active={design.alinhamentoCabecalho === "esquerda"} onClick={() => set({ alinhamentoCabecalho: "esquerda" })}>
                À esquerda
              </Opcao>
              <Opcao active={design.alinhamentoCabecalho === "centro"} onClick={() => set({ alinhamentoCabecalho: "centro" })}>
                Centralizado
              </Opcao>
            </div>
          </>
        )}
      </Secao>

      <Secao titulo="Letra">
        <Campo label="Fonte">
          <select
            value={design.fonte}
            onChange={(e) => set({ fonte: e.target.value as DesignEmail["fonte"] })}
            className="h-8 w-full rounded-md border bg-white px-2 text-xs"
          >
            {FONTES.map((f) => (
              <option key={f.key} value={f.key} style={{ fontFamily: f.css }}>
                {f.label}
              </option>
            ))}
          </select>
        </Campo>
        <p className="text-[10px] leading-snug text-slate-400">
          Só fontes que funcionam em todo programa de e-mail — fonte da web o Outlook ignora.
        </p>
        <Faixa
          label="Tamanho do texto"
          valor={design.tamanhoFonte}
          faixa={LIMITES.tamanhoFonte}
          sufixo="px"
          onChange={(v) => set({ tamanhoFonte: v })}
        />
      </Secao>

      <Secao titulo="Layout">
        <Faixa label="Largura" valor={design.largura} faixa={LIMITES.largura} passo={20} sufixo="px" onChange={(v) => set({ largura: v })} />
        <Faixa label="Margem interna" valor={design.espacamento} faixa={LIMITES.espacamento} passo={4} sufixo="px" onChange={(v) => set({ espacamento: v })} />
        <Faixa label="Arredondamento" valor={design.cantos} faixa={LIMITES.cantos} sufixo="px" onChange={(v) => set({ cantos: v })} />
      </Secao>

      <Secao titulo="Rodapé">
        <Campo label="Texto extra (assinatura, contato, redes)">
          <textarea
            value={design.textoRodape}
            onChange={(e) => set({ textoRodape: e.target.value })}
            rows={3}
            placeholder={"Lito Aviation · (11) 0000-0000\ncontato@litoaviation.com"}
            className="w-full rounded-md border px-2 py-1.5 text-xs"
          />
        </Campo>
        <Linha label="Mostrar endereço da empresa">
          <Switch checked={design.mostrarEndereco} onCheckedChange={(v) => set({ mostrarEndereco: !!v })} />
        </Linha>
        <p className="text-[10px] leading-snug text-slate-400">
          O link de descadastro fica sempre no rodapé — é exigência legal (LGPD) e do provedor de envio.
        </p>
      </Secao>
    </div>
  );
}

function Secao({ titulo, aberta = false, children }: { titulo: string; aberta?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(aberta);
  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        {titulo}
        <ChevronDown className={cn("size-3.5 text-slate-400 transition", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-2.5 px-4 pb-4">{children}</div>}
    </div>
  );
}

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-normal text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

function Linha({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-slate-600">{label}</span>
      {children}
    </div>
  );
}

function Opcao({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 flex-1 rounded-md px-2 text-[11px] font-medium ring-1",
        active ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

function Faixa({
  label,
  valor,
  faixa,
  passo = 1,
  sufixo,
  onChange,
}: {
  label: string;
  valor: number;
  faixa: readonly [number, number];
  passo?: number;
  sufixo: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500">{label}</span>
        <span className="font-mono text-[11px] text-slate-600">
          {valor}
          {sufixo}
        </span>
      </div>
      <input
        type="range"
        min={faixa[0]}
        max={faixa[1]}
        step={passo}
        value={valor}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-indigo-600"
      />
    </div>
  );
}
