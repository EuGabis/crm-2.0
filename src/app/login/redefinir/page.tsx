"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brand } from "@/lib/config/brand";
import { createClient } from "@/lib/supabase/client";
import { markBrowserSession } from "@/lib/auth/session-marker";

type Etapa = "verificando" | "pronto" | "invalido";

/**
 * Destino do link de redefinição (`lib/auth/recovery.ts`). Troca o
 * `token_hash` por uma sessão com `verifyOtp` e pede a senha nova.
 */
export default function RedefinirSenhaPage() {
  const router = useRouter();
  const [etapa, setEtapa] = useState<Etapa>("verificando");
  const [motivo, setMotivo] = useState("");
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [salvando, setSalvando] = useState(false);
  // ⚠️ O token é de USO ÚNICO: no StrictMode o efeito roda duas vezes e a
  // segunda chamada daria "link inválido" com a sessão já criada.
  const tentou = useRef(false);

  useEffect(() => {
    if (tentou.current) return;
    tentou.current = true;
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    const supabase = createClient();
    (async () => {
      if (!tokenHash) {
        // Sem token: só segue se já houver sessão (ex.: recarregou a página).
        const { data } = await supabase.auth.getUser();
        if (data.user) setEtapa("pronto");
        else {
          setMotivo("O link está incompleto.");
          setEtapa("invalido");
        }
        return;
      }
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
      if (error) {
        setMotivo(
          /expired|invalid/i.test(error.message)
            ? "O link expirou ou já foi usado."
            : error.message
        );
        setEtapa("invalido");
        return;
      }
      markBrowserSession();
      // Tira o token da barra de endereço: não fica no histórico nem é reenviado.
      window.history.replaceState(null, "", window.location.pathname);
      setEtapa("pronto");
    })();
  }, []);

  const salvar = async () => {
    if (senha.length < 8) return toast.error("A senha precisa ter pelo menos 8 caracteres");
    if (senha !== confirma) return toast.error("As senhas não conferem");
    setSalvando(true);
    const { error } = await createClient().auth.updateUser({ password: senha });
    setSalvando(false);
    if (error) {
      toast.error(
        /different from the old/i.test(error.message)
          ? "A nova senha precisa ser diferente da atual"
          : error.message
      );
      return;
    }
    toast.success("Senha alterada");
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--lito-sidebar)] p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h1 className="text-lg font-bold text-slate-900">Redefinir senha</h1>
        <p className="mb-5 text-xs text-slate-500">{brand.name}</p>

        {etapa === "verificando" && (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="size-4 animate-spin" /> Conferindo o link...
          </p>
        )}

        {etapa === "invalido" && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              {motivo} Peça um novo link em &quot;Esqueci minha senha&quot; na tela de login.
            </p>
            <Button className="h-8 w-full text-xs" onClick={() => router.push("/login")}>
              Voltar ao login
            </Button>
          </div>
        )}

        {etapa === "pronto" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nova senha</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Confirme a nova senha</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={confirma}
                onChange={(e) => setConfirma(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && salvar()}
                className="h-8 text-sm"
              />
            </div>
            <p className="text-[11px] text-slate-400">Mínimo de 8 caracteres.</p>
            <Button className="h-8 w-full text-xs" onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar nova senha"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
