"use client";

import {
  Download,
  Mail,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Star,
  Tag,
  Trash2,
  Users,
  Workflow,
  X,
  Merge,
  KanbanSquare,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { dbContactActions } from "@/lib/data/repos/db/contacts";
import { logBulk } from "@/lib/data/repos/db/contacts-module";

import { useConfirm } from "@/components/shared/confirm";
export function BulkActions({ ids, clear }: { ids: string[]; clear: () => void }) {
  const confirm = useConfirm();
  const simulated = (label: string) => () =>
    toast.info(`${label} — ação simulada (chega em fase futura)`);

  const addTag = async () => {
    const tag = window.prompt("Nome da tag para adicionar:");
    if (!tag?.trim()) return;
    const ok = await dbContactActions.addTag(ids, tag.trim().toLowerCase());
    if (ok) {
      void logBulk(`Adicionar tag "${tag.trim().toLowerCase()}"`, ids.length);
      toast.success(`Tag "${tag.trim()}" adicionada a ${ids.length} contato(s)`);
      clear();
    } else {
      toast.error("Não foi possível adicionar a tag");
    }
  };

  const removeTag = async () => {
    const tag = window.prompt("Nome da tag para remover:");
    if (!tag?.trim()) return;
    const ok = await dbContactActions.removeTag(ids, tag.trim().toLowerCase());
    if (ok) {
      void logBulk(`Remover tag "${tag.trim().toLowerCase()}"`, ids.length);
      toast.success(`Tag "${tag.trim()}" removida de ${ids.length} contato(s)`);
      clear();
    } else {
      toast.error("Não foi possível remover a tag");
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: `Excluir ${ids.length} contato(s)?`,
      description:
        "O histórico de conversas e as oportunidades desses contatos vão junto. Não tem desfazer.", confirmLabel: "Excluir", destructive: true }))) {
      return;
    }
    const ok = await dbContactActions.remove(ids);
    if (ok) {
      void logBulk("Excluir contatos", ids.length);
      toast.success(`${ids.length} contato(s) excluído(s)`);
      clear();
    } else {
      toast.error("Não foi possível excluir");
    }
  };

  return (
    <>
      <span className="text-xs font-semibold text-indigo-700">
        {ids.length} selecionado{ids.length === 1 ? "" : "s"}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={simulated("Exportar")}>
          <Download className="size-3.5" /> Exportar
        </Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={simulated("Acionar automação")}>
          <Workflow className="size-3.5" /> Automação
        </Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={simulated("Enviar e-mail")}>
          <Mail className="size-3.5" /> E-mail
        </Button>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={addTag}>
          <Tag className="size-3.5" /> Tags
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-red-600 hover:text-red-700"
          onClick={remove}
        >
          <Trash2 className="size-3.5" /> Excluir
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" />}
          >
            <MoreHorizontal className="size-3.5" /> Mais
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={simulated("Enviar SMS")}>
              <MessageSquare className="size-4" /> Enviar SMS
            </DropdownMenuItem>
            <DropdownMenuItem onClick={simulated("Enviar e-mail")}>
              <Mail className="size-4" /> Enviar e-mail
            </DropdownMenuItem>
            <DropdownMenuItem onClick={simulated("Enviar WhatsApp")}>
              <MessageCircle className="size-4" /> Enviar WhatsApp
            </DropdownMenuItem>
            <DropdownMenuItem onClick={simulated("Solicitar avaliações")}>
              <Star className="size-4" /> Solicitar avaliações
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={simulated("Gerenciar empresas")}>
              <Users className="size-4" /> Gerenciar empresas
            </DropdownMenuItem>
            <DropdownMenuItem onClick={simulated("Gerenciar oportunidades")}>
              <KanbanSquare className="size-4" /> Gerenciar oportunidades
            </DropdownMenuItem>
            <DropdownMenuItem onClick={simulated("Acionar automação")}>
              <Workflow className="size-4" /> Acionar automação
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={addTag}>
              <Tag className="size-4" /> Adicionar tags
            </DropdownMenuItem>
            <DropdownMenuItem onClick={removeTag}>
              <Tag className="size-4" /> Remover tags
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={simulated("Exportar")}>
              <Download className="size-4" /> Exportar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={simulated("Mesclar contatos")}>
              <Merge className="size-4" /> Mesclar
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={remove}>
              <Trash2 className="size-4" /> Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon" className="size-7" onClick={clear}>
          <X className="size-3.5" />
        </Button>
      </div>
    </>
  );
}
