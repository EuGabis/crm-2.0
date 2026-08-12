"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileText, Plus, Copy, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { useForms, formActions, embedSnippet } from "@/lib/data/repos/db/forms";
import { FormEditor } from "./form-editor";
import type { LeadForm } from "@/lib/data/types";

export function FormsTab() {
  const { forms, ready } = useForms();
  const [editing, setEditing] = useState<LeadForm | null>(null);
  const [creating, setCreating] = useState(false);

  const create = async () => {
    setCreating(true);
    const res = await formActions.create({ name: "Novo formulário" });
    setCreating(false);
    if (res.ok) toast.success("Formulário criado — edite os campos");
    else toast.error(res.error ?? "Falha ao criar");
  };

  const copyEmbed = (slug: string) => {
    void navigator.clipboard.writeText(embedSnippet(slug));
    toast.success("Embed copiado — cole no HTML da sua página");
  };

  if (ready && forms.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={FileText}
          title="Nenhum formulário ainda"
          description="Crie um formulário de captação, cole o embed no seu site e os leads caem no CRM."
          cta={
            <Button size="sm" className="h-8 text-xs" onClick={create} disabled={creating}>
              <Plus className="size-3.5" /> Novo formulário
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-900">Formulários</h1>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={create} disabled={creating}>
          <Plus className="size-3.5" /> Novo formulário
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-[11px] text-slate-400">
              {["Nome", "Tag / Lista", "Status", "Ações"].map((h) => (
                <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {forms.map((f) => (
              <tr key={f.id} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-medium text-slate-800">{f.name}</td>
                <td className="px-4 py-2.5 text-slate-500">{f.tag}</td>
                <td className="px-4 py-2.5">
                  <span className={f.active ? "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700" : "rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500"}>
                    {f.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2 text-slate-400">
                    <button title="Copiar embed" onClick={() => copyEmbed(f.slug)} className="hover:text-indigo-600"><Copy className="size-4" /></button>
                    <button title="Editar" onClick={() => setEditing(f)} className="hover:text-indigo-600"><Pencil className="size-4" /></button>
                    <button
                      title="Excluir"
                      onClick={async () => { if (await formActions.remove(f.id)) toast.success("Formulário excluído"); }}
                      className="hover:text-rose-600"
                    ><Trash2 className="size-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <FormEditor form={editing} open={!!editing} onOpenChange={(v) => !v && setEditing(null)} />}
    </div>
  );
}
