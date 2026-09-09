"use client";

import { useState } from "react";
import { Pencil, Plus, Tag as TagIcon, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/shared/confirm";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { tagActions, useContactTags } from "@/lib/data/repos/db/tags";

/**
 * Configurações → Etiquetas.
 *
 * A lista que o vendedor vê no seletor (composer, contato, ação em massa) e no
 * filtro da caixa de entrada. Curada de propósito: quem cria é o admin.
 *
 * ⚠️ Esconder os botões para não-admin NÃO é o controle de acesso — quem barra é
 * a RLS de `contact_tags`. A tela só evita oferecer o que vai ser recusado.
 */
export default function EtiquetasPage() {
  const confirm = useConfirm();
  const { isAdmin } = useMyMembership();
  const { tags, loaded } = useContactTags();
  const [novo, setNovo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);

  const criar = async () => {
    setSalvando(true);
    const r = await tagActions.create(novo);
    setSalvando(false);
    if (!r.ok) return toast.error(r.erro ?? "Não foi possível criar a etiqueta");
    toast.success(`Etiqueta "${novo.trim()}" criada`);
    setNovo("");
  };

  const renomear = async () => {
    if (!editando) return;
    const r = await tagActions.rename(editando.id, editando.nome);
    if (!r.ok) return toast.error(r.erro ?? "Não foi possível renomear");
    toast.success("Etiqueta renomeada");
    setEditando(null);
  };

  const excluir = async (id: string, nome: string) => {
    const ok = await confirm({
      title: `Excluir a etiqueta "${nome}"?`,
      description:
        "Ela sai da lista de escolha. Os contatos que já estão marcados CONTINUAM marcados, e as listas inteligentes que usam essa etiqueta seguem funcionando.",
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    const r = await tagActions.remove(id);
    if (!r.ok) return toast.error(r.erro ?? "Não foi possível excluir");
    toast.success("Etiqueta excluída da lista");
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-bold text-slate-900">Etiquetas</h1>
      <p className="mt-1 text-xs text-slate-500">
        A lista que a equipe usa para marcar contatos e filtrar a caixa de entrada. Marcar é
        de todos; criar e editar, só de administradores.
      </p>

      {isAdmin && (
        <div className="mt-4 flex gap-1.5">
          <Input
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && novo.trim() && void criar()}
            placeholder="Nome da etiqueta. Ex.: INTERESSADO MMA"
            className="h-8 text-xs"
          />
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => void criar()}
            disabled={!novo.trim() || salvando}
          >
            <Plus className="size-3.5" /> Criar
          </Button>
        </div>
      )}

      <div className="mt-4 rounded-xl border bg-white">
        {!loaded ? (
          <p className="p-4 text-xs text-slate-400">Carregando...</p>
        ) : tags.length === 0 ? (
          <p className="p-4 text-xs text-slate-400">
            Nenhuma etiqueta ainda.{" "}
            {isAdmin ? "Crie a primeira acima." : "Peça a um administrador para criar."}
          </p>
        ) : (
          <ul className="divide-y">
            {tags.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                <TagIcon className="size-3.5 shrink-0 text-slate-400" />
                {editando?.id === t.id ? (
                  <>
                    <Input
                      value={editando.nome}
                      onChange={(e) => setEditando({ id: t.id, nome: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && void renomear()}
                      className="h-7 flex-1 text-xs"
                      autoFocus
                    />
                    <Button size="sm" className="h-7 text-xs" onClick={() => void renomear()}>
                      Salvar
                    </Button>
                    <button
                      onClick={() => setEditando(null)}
                      className="flex size-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
                      title="Cancelar"
                    >
                      <X className="size-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 break-words text-xs text-slate-700">
                      {t.name}
                    </span>
                    {isAdmin && (
                      <>
                        <button
                          onClick={() => setEditando({ id: t.id, nome: t.name })}
                          className="flex size-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          title="Renomear"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={() => void excluir(t.id, t.name)}
                          className="flex size-7 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="Excluir da lista"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        ⚠️ Renomear aqui muda a lista, e não os contatos já marcados — eles continuam com o
        nome antigo gravado. Para trocar em massa, use a ação de etiqueta na tela de Contatos.
      </p>
    </div>
  );
}
