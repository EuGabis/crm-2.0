"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brand } from "@/lib/config/brand";
import { accountActions, useAccount } from "@/lib/data/repos/db/account";
import { useMyMembership } from "@/lib/data/repos/db/team";

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

  return (
    <div className="max-w-xl">
      <h1 className="text-lg font-bold text-slate-900">Perfil da empresa</h1>
      <p className="mb-5 text-xs text-slate-500">
        Esses dados aparecem na barra lateral e nos convites enviados pelo {brand.name}.
      </p>
      <div className="space-y-4 rounded-xl border bg-white p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-14 items-center justify-center overflow-hidden rounded-xl bg-indigo-500 text-xl font-black text-white">
            {company?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoUrl} alt="Logo" className="size-full object-cover" />
            ) : (
              (form.name[0] ?? "?").toUpperCase()
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={onLogoPick}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={!isAdmin || uploadingLogo}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadingLogo ? "Enviando..." : "Alterar logo"}
          </Button>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Nome da empresa *</Label>
          <Input
            value={form.name}
            onChange={set("name")}
            disabled={!isAdmin}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Cidade / Estado</Label>
          <Input
            value={form.city}
            onChange={set("city")}
            disabled={!isAdmin}
            placeholder="São Gonçalo, RJ"
            className="h-8 text-sm"
          />
        </div>

        {isAdmin ? (
          <Button size="sm" className="text-xs" onClick={save} disabled={saving}>
            {saving ? "Salvando..." : "Salvar alterações"}
          </Button>
        ) : (
          <p className="text-[11px] text-slate-400">
            Somente administradores podem editar os dados da empresa.
          </p>
        )}
      </div>
    </div>
  );
}
