"use client";

import { useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Bold, Heading2, Image as ImageIcon, Italic, Link2, List } from "lucide-react";
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
import { cn } from "@/lib/utils";

const CONTENT_CLASS =
  "min-h-[260px] p-4 text-sm leading-relaxed focus:outline-none " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 " +
  "[&_a]:text-indigo-600 [&_a]:underline [&_p]:my-1.5 " +
  "[&_img]:max-w-full [&_img]:rounded-lg";

/**
 * Editor rico (Tiptap) → HTML. `onEditorReady` entrega a instância para o composer
 * inserir variáveis/trechos no cursor. Link e imagem usam modais próprios (não os
 * prompts nativos do navegador). `immediatelyRender:false` evita hydration mismatch.
 */
export function RichTextEditor({
  value,
  onChange,
  onEditorReady,
}: {
  value: string;
  onChange: (html: string) => void;
  onEditorReady?: (editor: Editor) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Image,
    ],
    content: value || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: { attributes: { class: CONTENT_CLASS } },
  });

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [imgOpen, setImgOpen] = useState(false);
  const [imgUrl, setImgUrl] = useState("");

  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  if (!editor) {
    return <div className="min-h-[300px] rounded-lg border bg-white" />;
  }

  const applyLink = () => {
    const url = linkUrl.trim();
    if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    setLinkOpen(false);
  };
  const applyImage = () => {
    const url = imgUrl.trim();
    if (url) editor.chain().focus().setImage({ src: url }).run();
    setImgOpen(false);
  };

  return (
    <>
      <div className="rounded-lg border bg-white">
        <div className="flex flex-wrap items-center gap-1 border-b p-1.5">
          <Tb active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold className="size-3.5" />
          </Tb>
          <Tb active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic className="size-3.5" />
          </Tb>
          <Tb
            active={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="size-3.5" />
          </Tb>
          <Tb active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List className="size-3.5" />
          </Tb>
          <Tb
            active={editor.isActive("link")}
            onClick={() => {
              setLinkUrl((editor.getAttributes("link").href as string) ?? "https://");
              setLinkOpen(true);
            }}
          >
            <Link2 className="size-3.5" />
          </Tb>
          <Tb
            onClick={() => {
              setImgUrl("https://");
              setImgOpen(true);
            }}
          >
            <ImageIcon className="size-3.5" />
          </Tb>
        </div>
        <EditorContent editor={editor} />
      </div>

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
            <p className="text-[11px] text-slate-400">Deixe vazio e clique Aplicar para remover o link.</p>
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

      <Dialog open={imgOpen} onOpenChange={setImgOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Inserir imagem</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">URL da imagem</Label>
            <Input
              value={imgUrl}
              onChange={(e) => setImgUrl(e.target.value)}
              className="h-8 text-xs"
              placeholder="https://…"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && applyImage()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setImgOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={applyImage}>
              Inserir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Tb({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100",
        active && "bg-indigo-100 text-indigo-700",
      )}
    >
      {children}
    </button>
  );
}
