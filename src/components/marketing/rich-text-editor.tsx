"use client";

import { useEffect } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Bold, Heading2, Image as ImageIcon, Italic, Link2, List } from "lucide-react";
import { cn } from "@/lib/utils";

const CONTENT_CLASS =
  "min-h-[260px] p-4 text-sm leading-relaxed focus:outline-none " +
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_h2]:text-lg [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1 " +
  "[&_a]:text-indigo-600 [&_a]:underline [&_p]:my-1.5 " +
  "[&_img]:max-w-full [&_img]:rounded-lg";

/**
 * Editor rico (Tiptap) → HTML. `onEditorReady` entrega a instância para o composer
 * inserir variáveis/trechos no cursor. `immediatelyRender:false` evita hydration
 * mismatch no App Router.
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

  useEffect(() => {
    if (editor && onEditorReady) onEditorReady(editor);
  }, [editor, onEditorReady]);

  if (!editor) {
    return <div className="min-h-[300px] rounded-lg border bg-white" />;
  }

  return (
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
            const prev = editor.getAttributes("link").href as string | undefined;
            const url = window.prompt("URL do link", prev ?? "https://");
            if (url === null) return;
            if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
            else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
          }}
        >
          <Link2 className="size-3.5" />
        </Tb>
        <Tb
          onClick={() => {
            const url = window.prompt("URL da imagem", "https://");
            if (url) editor.chain().focus().setImage({ src: url }).run();
          }}
        >
          <ImageIcon className="size-3.5" />
        </Tb>
      </div>
      <EditorContent editor={editor} />
    </div>
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
