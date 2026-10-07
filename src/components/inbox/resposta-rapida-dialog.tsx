"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { snippetActions } from "@/lib/data/repos/db/conversations";
import { useConfirm } from "@/components/shared/confirm";

/**
 * Criar ou editar uma resposta rápida, sem sair da conversa.
 *
 * ⚠️ **Um diálogo para os dois casos**, distinguidos por `item.id` vazio. Dois
 * componentes separados teriam duas cópias da validação e da mensagem de erro,
 * que divergiriam na primeira mudança — e a única diferença real entre criar e
 * editar aqui é qual ação do repo é chamada.
 *
 * ⚠️ **Os campos nascem do `item` e o componente é REMONTADO por `key`** no
 * ponto de uso. O inicializador do `useState` só vale na primeira montagem, então
 * sem a `key` abrir o diálogo para uma segunda resposta rápida mostraria o texto
 * da primeira — o mesmo defeito que a transcrição de áudio já teve aqui. A saída
 * óbvia seria um `useEffect` semeando os campos, mas isso é `setState` dentro de
 * efeito (renderização em cascata, e o lint acusa); a `key` resolve sem efeito
 * nenhum.
 */
export function RespostaRapidaDialog({
  item,
  pessoal = false,
  onOpenChange,
}: {
  item: { id: string; name: string; content: string };
  /** "Minhas respostas": grava com dono e só quem criou vê. */
  pessoal?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(item.name);
  const [content, setContent] = useState(item.content);
  const [saving, setSaving] = useState(false);
  const editando = !!item.id;
  const confirm = useConfirm();

  // Excluir mora aqui porque as pessoais NÃO aparecem na aba "Respostas
  // rápidas" (que lista o acervo da empresa) — sem este botão não haveria onde
  // apagar uma resposta pessoal.
  const excluir = async () => {
    if (
      !(await confirm({
        title: `Excluir "${item.name}"?`,
        description: pessoal ? "Ela some só da sua lista." : "Ela some para toda a equipe.",
        confirmLabel: "Excluir",
        destructive: true,
      }))
    )
      return;
    setSaving(true);
    const ok = await snippetActions.remove(item.id);
    setSaving(false);
    if (!ok) {
      toast.error("Não foi possível excluir");
      return;
    }
    toast.success("Resposta excluída");
    onOpenChange(false);
  };

  const salvar = async () => {
    const n = name.trim();
    const c = content.trim();
    if (!n || !c) {
      toast.error("Preencha o nome e o texto");
      return;
    }
    setSaving(true);
    const ok = editando
      ? await snippetActions.update(item.id, n, c)
      : await snippetActions.add(n, c, { pessoal });
    setSaving(false);
    if (!ok) {
      toast.error(
        editando
          ? "Não foi possível salvar a alteração"
          : pessoal
            ? "Não foi possível criar — peça ao administrador para aplicar a atualização de \"Minhas respostas\""
            : "Não foi possível criar a resposta rápida"
      );
      return;
    }
    toast.success(editando ? "Resposta atualizada" : `"${n}" criada`);
    onOpenChange(false);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {pessoal
              ? editando
                ? "Editar minha resposta"
                : "Nova resposta pessoal"
              : editando
                ? "Editar resposta rápida"
                : "Nova resposta rápida"}
          </DialogTitle>
        </DialogHeader>
        {pessoal && (
          <p className="-mt-2 text-xs text-slate-500">
            Só você vê esta resposta. Ela não aparece para o resto da equipe.
          </p>
        )}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rr-nome" className="text-xs">
              Nome
            </Label>
            {/* O nome é o que aparece no menu; sem ele a lista viraria uma pilha
                de parágrafos e ninguém acharia a resposta certa com pressa. */}
            <Input
              id="rr-nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Valores Piloto Privado"
              className="h-9 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rr-texto" className="text-xs">
              Texto
            </Label>
            <Textarea
              id="rr-texto"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              placeholder="O texto que será inserido na conversa."
              className="text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          {editando && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto h-8 text-xs text-red-600 hover:bg-red-50"
              onClick={() => void excluir()}
              disabled={saving}
            >
              Excluir
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="sm" className="h-8 text-xs" onClick={() => void salvar()} disabled={saving}>
            {saving ? "Salvando..." : editando ? "Salvar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
