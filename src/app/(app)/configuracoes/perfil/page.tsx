"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brand } from "@/lib/config/brand";
import { accountActions, useAccount } from "@/lib/data/repos/db/account";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { cn } from "@/lib/utils";

export default function PerfilEmpresaPage() {
  const { company, loaded } = useAccount();
  const { isAdmin } = useMyMembership();
  const [form, setForm] = useState({ name: "", city: "" });
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    if (company) setForm({ name: company.name, city: company.city });
  }, [company]);

  const onLogoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-selecionar o mesmo arquivo
    if (!file) return;
    setUploadingLogo(true);
    const res = await accountActions.uploadCompanyLogo(file);
    setUploadingLogo(false);
    res.ok ? toast.success("Logo atualizado") : toast.error(res.error ?? "Não foi possível enviar");
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("O nome da empresa é obrigatório");
      return;
    }
    setSaving(true);
    const res = await accountActions.updateCompany({
      name: form.name.trim(),
      city: form.city.trim(),
    });
    setSaving(false);
    res.ok
      ? toast.success("Perfil da empresa atualizado")
      : toast.error(res.error ?? "Não foi possível salvar");
  };

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="size-4 animate-spin" /> Carregando...
      </div>
    );
  }

  const initial = (form.name[0] ?? company?.name?.[0] ?? "?").toUpperCase();

  return (
    <div className="max-w-xl">
      <h1 className="text-lg font-bold text-slate-900">Perfil da empresa</h1>
      <p className="mb-5 text-xs text-slate-500">
        Esses dados aparecem na barra lateral e nos convites enviados pelo {brand.name}.
      </p>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        {/* Faixa da marca + logo sobreposto */}
        <div className="relative h-24 bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={onLogoPick}
          />
          <button
            type="button"
            onClick={() => isAdmin && fileInputRef.current?.click()}
            disabled={!isAdmin || uploadingLogo}
            title={isAdmin ? "Alterar logo" : undefined}
            className={cn(
              "group absolute -bottom-10 left-6 block size-20 overflow-hidden rounded-2xl border-4 border-white bg-indigo-500 shadow-md",
              isAdmin ? "cursor-pointer" : "cursor-default",
            )}
          >
            {company?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoUrl} alt="Logo da empresa" className="size-full object-cover" />
            ) : (
              <span className="flex size-full items-center justify-center text-2xl font-black text-white">
                {initial}
              </span>
            )}
            {isAdmin && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition group-hover:opacity-100">
                {uploadingLogo ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Camera className="size-5" />
                )}
              </span>
            )}
          </button>
        </div>

        {/* Campos */}
        <div className="space-y-4 px-6 pb-6 pt-14">
          {isAdmin && (
            <p className="text-[11px] text-slate-400">
              Clique no logo para trocar a imagem — PNG, JPG, WEBP ou SVG, até 2 MB.
            </p>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600">Nome da empresa *</Label>
            <Input value={form.name} onChange={set("name")} disabled={!isAdmin} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600">Cidade / Estado</Label>
            <Input
              value={form.city}
              onChange={set("city")}
              disabled={!isAdmin}
              placeholder="São Gonçalo, RJ"
              className="h-9 text-sm"
            />
          </div>
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-between gap-3 border-t bg-slate-50 px-6 py-3">
          <p className="text-[11px] text-slate-400">
            {isAdmin
              ? "As alterações aparecem na barra lateral na hora."
              : "Somente administradores podem editar os dados da empresa."}
          </p>
          {isAdmin && (
            <Button size="sm" className="h-8 shrink-0 text-xs" onClick={save} disabled={saving}>
              {saving ? "Salvando..." : "Salvar alterações"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
