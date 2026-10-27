"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditor, useEditorState, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { BackgroundColor, Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  MousePointerClick,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { enviarMidiaDeEmail } from "@/lib/data/repos/db/email-midia";
import { cssDaFonte, DESIGN_PADRAO, type DesignEmail } from "@/lib/email/design";
import { cn } from "@/lib/utils";
import {
  BotaoEmail,
  ImagemEmail,
  type Alinhamento,
  type AtributosBotao,
  type LarguraImagem,
} from "./editor-extensoes";
import { SeletorCor } from "./seletor-cor";

const CONTENT_CLASS =
  "min-h-[340px] p-5 leading-relaxed focus:outline-none " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1 " +
  "[&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 " +
  "[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 " +
  "[&_a]:underline [&_p]:my-1.5 [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_blockquote]:text-slate-500 " +
  "[&_hr]:my-4 [&_hr]:border-slate-200 " +
  "[&_.ProseMirror-selectednode]:outline [&_.ProseMirror-selectednode]:outline-2 [&_.ProseMirror-selectednode]:outline-indigo-400";

const TAMANHOS = ["12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px", "40px"];

/**
 * Editor rico (Tiptap) → HTML de e-mail.
 *
 * Imagem entra do COMPUTADOR (botão, colar ou arrastar) e vai para o bucket
 * público `email-midia`; antes só aceitava URL, o que obrigava a hospedar a
 * imagem em outro lugar. A área de escrita usa fonte e cores do design da
 * campanha, para o que se vê aqui ser o que chega.
 */
export function RichTextEditor({
  value,
  onChange,
  onEditorReady,
  design = DESIGN_PADRAO,
  sugestoesCor = [],
}: {
  value: string;
  onChange: (html: string) => void;
  onEditorReady?: (editor: Editor) => void;
  design?: DesignEmail;
  sugestoesCor?: string[];
}) {
  const editorRef = useRef<Editor | null>(null);
  const [enviando, setEnviando] = useState(0);

  /** Sobe as imagens e as insere no cursor (ou onde soltou), em série. */
  const inserirImagens = async (files: File[], pos?: number) => {
    const imagens = files.filter((f) => f.type.startsWith("image/"));
    if (imagens.length === 0) return false;
    setEnviando((n) => n + imagens.length);
    for (const f of imagens) {
      const r = await enviarMidiaDeEmail(f, "imagem");
      setEnviando((n) => n - 1);
      if (!r.ok) {
        toast.error(`Imagem não enviada: ${r.erro}`);
        continue;
      }
      const ed = editorRef.current;
      if (!ed) continue;
      const node = { type: "image", attrs: { src: r.arquivo.url, alt: f.name } };
      if (pos != null) ed.chain().focus().insertContentAt(pos, node).run();
      else ed.chain().focus().insertContent(node).run();
    }
    return true;
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // O StarterKit v3 já traz Link e Underline; o Link é configurado à parte.
      StarterKit.configure({ link: false }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      TextStyle,
      Color,
      FontSize,
      BackgroundColor,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      ImagemEmail,
      BotaoEmail,
    ],
    content: value || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: CONTENT_CLASS },
      // Colar/arrastar arquivo de imagem sobe para o Storage em vez de virar
      // base64 dentro do e-mail (que o Gmail corta e o Outlook bloqueia).
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.some((f) => f.type.startsWith("image/"))) return false;
        event.preventDefault();
        void inserirImagens(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.some((f) => f.type.startsWith("image/"))) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void inserirImagens(files, pos);
        return true;
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  if (!editor) {
    return <div className="min-h-[400px] rounded-lg border bg-white" />;
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <Barra
        editor={editor}
        design={design}
        sugestoesCor={sugestoesCor}
        enviando={enviando}
        inserirImagens={inserirImagens}
      />
      <div style={{ backgroundColor: design.corFundo }} className="p-3">
        <div
          className="mx-auto"
          style={{
            maxWidth: design.largura,
            backgroundColor: design.corConteudo,
            color: design.corTexto,
            fontFamily: cssDaFonte(design.fonte),
            fontSize: design.tamanhoFonte,
            borderRadius: design.cantos,
          }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- barra --- */

function Barra({
  editor,
  design,
  sugestoesCor,
  enviando,
  inserirImagens,
}: {
  editor: Editor;
  design: DesignEmail;
  sugestoesCor: string[];
  enviando: number;
  inserirImagens: (files: File[]) => Promise<boolean>;
}) {
  // Reage à seleção: sem isso a barra não acende o botão ativo nem mostra a
  // barra contextual da imagem/botão selecionado.
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      link: e.isActive("link"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      align: (["left", "center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
      cor: (e.getAttributes("textStyle").color as string | undefined) ?? null,
      fundo: (e.getAttributes("textStyle").backgroundColor as string | undefined) ?? null,
      tamanho: (e.getAttributes("textStyle").fontSize as string | undefined) ?? "",
      imagem: e.isActive("image") ? e.getAttributes("image") : null,
      botao: e.isActive("botaoEmail") ? (e.getAttributes("botaoEmail") as AtributosBotao) : null,
      podeDesfazer: e.can().undo(),
      podeRefazer: e.can().redo(),
    }),
  });

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [imgOpen, setImgOpen] = useState(false);
  const [imgUrl, setImgUrl] = useState("");
  const [botao, setBotao] = useState<{ attrs: AtributosBotao; editando: boolean } | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const c = () => editor.chain().focus();
  const bloco = st.h1 ? "h1" : st.h2 ? "h2" : st.h3 ? "h3" : "p";
  const sugestoes = [design.corDestaque, design.corTitulo, design.corTexto, ...sugestoesCor];

  const applyLink = () => {
    const url = linkUrl.trim();
    if (url === "") c().extendMarkRange("link").unsetLink().run();
    else c().extendMarkRange("link").setLink({ href: url }).run();
    setLinkOpen(false);
  };
  const applyImage = () => {
    const url = imgUrl.trim();
    if (/^https?:\/\//i.test(url)) c().setImage({ src: url }).run();
    else if (url) return toast.error("O link da imagem precisa começar com https://");
    setImgOpen(false);
  };
  const novoBotao = (): AtributosBotao => ({
    href: "https://",
    texto: "Quero saber mais",
    cor: design.corDestaque,
    corTexto: "#ffffff",
    alinhamento: "center",
    raio: 8,
    largo: false,
  });
  const salvarBotao = () => {
    if (!botao) return;
    if (!/^(https?:\/\/.+|mailto:.+|tel:.+)/i.test(botao.attrs.href.trim())) {
      return toast.error("O link do botão precisa começar com https://, mailto: ou tel:");
    }
    if (botao.editando) c().updateAttributes("botaoEmail", botao.attrs).run();
    else c().insertContent({ type: "botaoEmail", attrs: botao.attrs }).run();
    setBotao(null);
  };

  return (
    <>
      <div className="sticky top-0 z-10 border-b bg-white">
        <div className="flex flex-wrap items-center gap-0.5 p-1.5">
          <Tb title="Desfazer" disabled={!st.podeDesfazer} onClick={() => c().undo().run()}>
            <Undo2 className="size-3.5" />
          </Tb>
          <Tb title="Refazer" disabled={!st.podeRefazer} onClick={() => c().redo().run()}>
            <Redo2 className="size-3.5" />
          </Tb>
          <Sep />
          <select
            value={bloco}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "p") c().setParagraph().run();
              else c().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
            }}
            className="h-7 rounded border bg-white px-1.5 text-xs text-slate-700"
            aria-label="Estilo do parágrafo"
          >
            <option value="p">Texto</option>
            <option value="h1">Título grande</option>
            <option value="h2">Título</option>
            <option value="h3">Subtítulo</option>
          </select>
          <select
            value={st.tamanho}
            onChange={(e) =>
              e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run()
            }
            className="h-7 rounded border bg-white px-1.5 text-xs text-slate-700"
            aria-label="Tamanho da letra"
          >
            <option value="">Tamanho</option>
            {TAMANHOS.map((t) => (
              <option key={t} value={t}>
                {t.replace("px", "")}
              </option>
            ))}
          </select>
          <Sep />
          <Tb title="Negrito" active={st.bold} onClick={() => c().toggleBold().run()}>
            <Bold className="size-3.5" />
          </Tb>
          <Tb title="Itálico" active={st.italic} onClick={() => c().toggleItalic().run()}>
            <Italic className="size-3.5" />
          </Tb>
          <Tb title="Sublinhado" active={st.underline} onClick={() => c().toggleUnderline().run()}>
            <Underline className="size-3.5" />
          </Tb>
          <Tb title="Tachado" active={st.strike} onClick={() => c().toggleStrike().run()}>
            <Strikethrough className="size-3.5" />
          </Tb>
          <SeletorCor
            titulo="Cor do texto"
            value={st.cor}
            sugestoes={sugestoes}
            onChange={(cor) => c().setColor(cor).run()}
            limpar={() => c().unsetColor().run()}
            trigger={
              <span className="flex flex-col items-center" title="Cor do texto">
                <Baseline className="size-3.5" />
                <span className="-mt-0.5 h-1 w-3.5 rounded-sm" style={{ backgroundColor: st.cor ?? "#0f172a" }} />
              </span>
            }
          />
          <SeletorCor
            titulo="Fundo do texto (marca-texto)"
            value={st.fundo}
            sugestoes={["#fef08a", "#bbf7d0", "#bfdbfe", "#fbcfe8", ...sugestoes]}
            onChange={(cor) => c().setBackgroundColor(cor).run()}
            limpar={() => c().unsetBackgroundColor().run()}
            trigger={
              <span className="flex flex-col items-center" title="Marca-texto">
                <Highlighter className="size-3.5" />
                <span className="-mt-0.5 h-1 w-3.5 rounded-sm" style={{ backgroundColor: st.fundo ?? "transparent" }} />
              </span>
            }
          />
          <Sep />
          {(
            [
              ["left", AlignLeft, "Alinhar à esquerda"],
              ["center", AlignCenter, "Centralizar"],
              ["right", AlignRight, "Alinhar à direita"],
              ["justify", AlignJustify, "Justificar"],
            ] as const
          ).map(([a, Icon, t]) => (
            <Tb key={a} title={t} active={st.align === a} onClick={() => c().setTextAlign(a).run()}>
              <Icon className="size-3.5" />
            </Tb>
          ))}
          <Sep />
          <Tb title="Lista" active={st.bullet} onClick={() => c().toggleBulletList().run()}>
            <List className="size-3.5" />
          </Tb>
          <Tb title="Lista numerada" active={st.ordered} onClick={() => c().toggleOrderedList().run()}>
            <ListOrdered className="size-3.5" />
          </Tb>
          <Tb title="Citação" active={st.quote} onClick={() => c().toggleBlockquote().run()}>
            <Quote className="size-3.5" />
          </Tb>
          <Tb title="Linha divisória" onClick={() => c().setHorizontalRule().run()}>
            <Minus className="size-3.5" />
          </Tb>
          <Sep />
          <Tb
            title="Link"
            active={st.link}
            onClick={() => {
              setLinkUrl((editor.getAttributes("link").href as string) ?? "https://");
              setLinkOpen(true);
            }}
          >
            <Link2 className="size-3.5" />
          </Tb>
          <Tb
            title="Imagem"
            onClick={() => {
              setImgUrl("");
              setImgOpen(true);
            }}
          >
            <ImageIcon className="size-3.5" />
          </Tb>
          <button
            type="button"
            onClick={() => setBotao({ attrs: novoBotao(), editando: false })}
            className="flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
            title="Inserir botão"
          >
            <MousePointerClick className="size-3.5" /> Botão
          </button>
          <Sep />
          <Tb title="Limpar formatação" onClick={() => c().unsetAllMarks().clearNodes().run()}>
            <RemoveFormatting className="size-3.5" />
          </Tb>
          {enviando > 0 && (
            <span className="ml-auto flex items-center gap-1 pr-1 text-[11px] text-slate-500">
              <Loader2 className="size-3 animate-spin" /> Enviando {enviando} imagem(ns)…
            </span>
          )}
        </div>

        {/* Barra contextual: só aparece com imagem ou botão selecionado. */}
        {st.imagem && (
          <div className="flex flex-wrap items-center gap-1 border-t bg-indigo-50/60 px-2 py-1.5 text-xs">
            <span className="mr-1 font-medium text-indigo-700">Imagem:</span>
            {(
              [
                ["pequena", "Pequena"],
                ["media", "Média"],
                ["inteira", "Largura total"],
              ] as [LarguraImagem, string][]
            ).map(([k, l]) => (
              <Chip
                key={k}
                active={(st.imagem?.largura ?? "inteira") === k}
                onClick={() => c().updateAttributes("image", { largura: k }).run()}
              >
                {l}
              </Chip>
            ))}
            <span className="mx-1 h-4 w-px bg-indigo-200" />
            {(
              [
                ["left", AlignLeft],
                ["center", AlignCenter],
                ["right", AlignRight],
              ] as [Alinhamento, typeof AlignLeft][]
            ).map(([k, Icon]) => (
              <Tb
                key={k}
                active={(st.imagem?.alinhamento ?? "center") === k}
                onClick={() => c().updateAttributes("image", { alinhamento: k }).run()}
              >
                <Icon className="size-3.5" />
              </Tb>
            ))}
            <span className="mx-1 h-4 w-px bg-indigo-200" />
            <Tb title="Remover imagem" onClick={() => c().deleteSelection().run()}>
              <Trash2 className="size-3.5 text-red-500" />
            </Tb>
          </div>
        )}
        {st.botao && (
          <div className="flex items-center gap-2 border-t bg-indigo-50/60 px-2 py-1.5 text-xs">
            <span className="font-medium text-indigo-700">Botão “{st.botao.texto}”</span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[11px]"
              onClick={() => setBotao({ attrs: { ...novoBotao(), ...st.botao! }, editando: true })}
            >
              Editar botão
            </Button>
            <Tb title="Remover botão" onClick={() => c().deleteSelection().run()}>
              <Trash2 className="size-3.5 text-red-500" />
            </Tb>
          </div>
        )}
      </div>

      {/* Link */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Inserir link</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">URL</Label>
            <Input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              className="h-8 text-xs"
              placeholder="https://…"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && applyLink()}
            />
            <p className="text-[11px] text-slate-400">Selecione o texto antes. Vazio + Aplicar remove o link.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setLinkOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={applyLink}>
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Imagem: do computador (principal) ou por link */}
      <Dialog open={imgOpen} onOpenChange={setImgOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Inserir imagem</DialogTitle>
          </DialogHeader>
          <button
            type="button"
            onClick={() => arquivoRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              setImgOpen(false);
              await inserirImagens(Array.from(e.dataTransfer.files));
            }}
            className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-6 text-center hover:border-indigo-300 hover:bg-indigo-50/40"
          >
            <Upload className="size-6 text-indigo-500" />
            <span className="text-sm font-medium text-slate-700">Escolher do computador</span>
            <span className="text-[11px] text-slate-400">ou arraste aqui · PNG, JPG, GIF ou WEBP até 5 MB</span>
          </button>
          <input
            ref={arquivoRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              setImgOpen(false);
              await inserirImagens(files);
            }}
          />
          <div className="space-y-1.5">
            <Label className="text-xs">Ou cole o link de uma imagem já hospedada</Label>
            <div className="flex gap-2">
              <Input
                value={imgUrl}
                onChange={(e) => setImgUrl(e.target.value)}
                className="h-8 text-xs"
                placeholder="https://…"
                onKeyDown={(e) => e.key === "Enter" && applyImage()}
              />
              <Button size="sm" className="h-8 text-xs" disabled={!imgUrl.trim()} onClick={applyImage}>
                Inserir
              </Button>
            </div>
            <p className="text-[11px] text-slate-400">
              Dica: você também pode colar (Ctrl+V) ou arrastar a imagem direto no texto.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Botão */}
      <Dialog open={!!botao} onOpenChange={(o) => !o && setBotao(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{botao?.editando ? "Editar botão" : "Inserir botão"}</DialogTitle>
          </DialogHeader>
          {botao && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Texto do botão</Label>
                <Input
                  value={botao.attrs.texto}
                  onChange={(e) => setBotao({ ...botao, attrs: { ...botao.attrs, texto: e.target.value } })}
                  className="h-8 text-xs"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Link (para onde o botão leva)</Label>
                <Input
                  value={botao.attrs.href}
                  onChange={(e) => setBotao({ ...botao, attrs: { ...botao.attrs, href: e.target.value } })}
                  className="h-8 text-xs"
                  placeholder="https://… · mailto: · tel:"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Cor do botão</Label>
                  <SeletorCor
                    value={botao.attrs.cor}
                    sugestoes={sugestoes}
                    onChange={(cor) => setBotao({ ...botao, attrs: { ...botao.attrs, cor } })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Cor do texto</Label>
                  <SeletorCor
                    value={botao.attrs.corTexto}
                    sugestoes={["#ffffff", "#0f172a", ...sugestoes]}
                    onChange={(cor) => setBotao({ ...botao, attrs: { ...botao.attrs, corTexto: cor } })}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-500">Posição:</span>
                {(
                  [
                    ["left", "Esquerda"],
                    ["center", "Centro"],
                    ["right", "Direita"],
                  ] as [Alinhamento, string][]
                ).map(([k, l]) => (
                  <Chip
                    key={k}
                    active={botao.attrs.alinhamento === k}
                    onClick={() => setBotao({ ...botao, attrs: { ...botao.attrs, alinhamento: k } })}
                  >
                    {l}
                  </Chip>
                ))}
                <Chip
                  active={botao.attrs.largo}
                  onClick={() => setBotao({ ...botao, attrs: { ...botao.attrs, largo: !botao.attrs.largo } })}
                >
                  Largura total
                </Chip>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-500">Cantos:</span>
                {(
                  [
                    [0, "Retos"],
                    [8, "Arredondados"],
                    [40, "Pílula"],
                  ] as [number, string][]
                ).map(([k, l]) => (
                  <Chip
                    key={k}
                    active={botao.attrs.raio === k}
                    onClick={() => setBotao({ ...botao, attrs: { ...botao.attrs, raio: k } })}
                  >
                    {l}
                  </Chip>
                ))}
              </div>
              <div className="rounded-lg border bg-slate-50 p-4" style={{ textAlign: botao.attrs.alinhamento }}>
                <span
                  style={{
                    display: botao.attrs.largo ? "block" : "inline-block",
                    backgroundColor: botao.attrs.cor,
                    color: botao.attrs.corTexto,
                    padding: "12px 28px",
                    borderRadius: botao.attrs.raio,
                    fontWeight: 700,
                    fontSize: 14,
                    textAlign: "center",
                  }}
                >
                  {botao.attrs.texto || "Saiba mais"}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBotao(null)}>
              Cancelar
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={salvarBotao}>
              {botao?.editando ? "Salvar" : "Inserir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Sep() {
  return <span className="mx-0.5 h-5 w-px bg-slate-200" />;
}

function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-6 rounded-full px-2.5 text-[11px] font-medium ring-1",
        active ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

function Tb({
  children,
  active,
  onClick,
  title,
  disabled,
}: {
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 disabled:opacity-30",
        active && "bg-indigo-100 text-indigo-700",
      )}
    >
      {children}
    </button>
  );
}
