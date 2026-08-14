"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Mail, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brand } from "@/lib/config/brand";
import { createClient } from "@/lib/supabase/client";
import { markBrowserSession } from "@/lib/auth/session-marker";

type Mode = "login" | "signup";

const STAGES = [
  { name: "NOVO LEAD", color: "#94a3b8" },
  { name: "NEGOCIANDO", color: "#6366f1" },
  { name: "ASSINOU", color: "#22c55e" },
];

function PipelineVignette() {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[#1d2436] p-5 shadow-2xl shadow-black/40">
      {/* Conversa que origina o lead */}
      <div className="mb-5 space-y-2">
        <div
          className="lito-bubble flex w-fit items-center gap-2 rounded-2xl rounded-bl-sm bg-white/[0.07] px-3 py-2"
          style={{ animationDelay: "0.4s" }}
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-[var(--lito-wa-green)]">
            <MessageCircle className="size-3 text-white" />
          </span>
          <span className="text-xs text-slate-200">Oi! Vi o anúncio de vocês 👋</span>
        </div>
        <div
          className="lito-bubble ml-auto flex w-fit items-center gap-2 rounded-2xl rounded-br-sm bg-indigo-500/90 px-3 py-2"
          style={{ animationDelay: "1.1s" }}
        >
          <span className="text-xs text-white">Fechado! Te mando o contrato 🎉</span>
          <Check className="size-3.5 text-indigo-200" />
        </div>
      </div>

      {/* Mini pipeline */}
      <div className="relative">
        <div className="grid grid-cols-3 gap-2.5">
          {STAGES.map((s) => (
            <div key={s.name} className="rounded-lg bg-black/20 p-2">
              <p
                className="mb-2 flex items-center gap-1.5 text-[9px] font-bold tracking-wide text-slate-400"
                style={{ color: undefined }}
              >
                <span className="size-1.5 rounded-full" style={{ background: s.color }} />
                {s.name}
              </p>
              <div className="space-y-1.5">
                <div className="h-7 rounded-md bg-white/[0.05]" />
                <div className="h-7 rounded-md bg-white/[0.05]" />
              </div>
            </div>
          ))}
        </div>
        {/* Card do lead em movimento */}
        <div className="lito-lead-card absolute top-7 w-[29%] rounded-md border border-indigo-400/40 bg-[#252d42] px-2 py-1.5 shadow-lg shadow-indigo-950/50">
          <p className="truncate text-[10px] font-semibold text-white">Maria Duarte</p>
          <p className="text-[9px] text-indigo-300">R$ 297/mês</p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [loading, setLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [form, setForm] = useState({ name: "", company: "", email: "", password: "" });

  // Aviso quando a pessoa chega deslogada (inatividade / fechou o navegador).
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "idle") {
      toast.info("Sessão encerrada por inatividade. Entre novamente.");
    } else if (reason === "expired") {
      toast.info("Faça login novamente para continuar.");
    }
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.email.trim() || form.password.length < 8) {
      toast.error("Informe e-mail válido e senha com pelo menos 8 caracteres");
      return;
    }
    setLoading(true);
    const supabase = createClient();

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email: form.email.trim(),
        password: form.password,
      });
      setLoading(false);
      if (error) {
        toast.error(
          error.message === "Invalid login credentials"
            ? "E-mail ou senha incorretos"
            : error.message
        );
        return;
      }
      markBrowserSession();
      router.push("/dashboard");
      router.refresh();
    } else {
      if (!form.name.trim()) {
        toast.error("Informe seu nome");
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          data: {
            name: form.name.trim(),
            company: form.company.trim() || undefined,
          },
        },
      });
      setLoading(false);
      if (error) {
        // O banco recusa cadastros sem convite (trigger handle_new_user)
        const inviteOnly =
          /database error|apenas por convite|unexpected_failure/i.test(error.message);
        toast.error(
          inviteOnly
            ? "Este e-mail não tem convite. Peça a um administrador para te convidar."
            : error.message,
          { duration: 7000 }
        );
        return;
      }
      if (data.session) {
        toast.success("Conta criada! Sua empresa e pipeline já estão prontos.");
        markBrowserSession();
        router.push("/dashboard");
        router.refresh();
      } else {
        setConfirmationSent(true);
      }
    }
  };

  return (
    <div className="flex min-h-screen bg-[var(--lito-sidebar)]">
      {/* ============ Painel do produto ============ */}
      <div className="relative hidden w-[52%] flex-col justify-between overflow-hidden p-10 lg:flex xl:p-14">
        {/* brilho ambiente */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-32 top-1/3 size-[480px] rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, #6366f1 0%, transparent 70%)" }}
        />

        <div className="relative flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-[var(--lito-sidebar-accent)] text-base font-black text-white">
            {brand.shortName[0]}
          </div>
          <span className="text-lg font-bold text-white">{brand.name}</span>
        </div>

        <div className="relative max-w-lg">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.25em] text-indigo-300">
            CRM completo para vender todo dia
          </p>
          <h1 className="text-[2.6rem] font-bold leading-[1.08] tracking-tight text-white">
            Do primeiro oi
            <br />
            no WhatsApp ao
            <br />
            <span className="text-indigo-400">contrato assinado.</span>
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
            Conversas, funil, automações e cobrança no mesmo lugar — sem limite de
            contatos, usuários ou pipelines.
          </p>

          <div className="mt-8">
            <PipelineVignette />
          </div>
        </div>

        <div className="relative flex items-center gap-2 text-[11px] text-slate-500">
          {["Conversas", "Pipeline", "Automações", "Relatórios"].map((m, i) => (
            <span key={m} className="flex items-center gap-2">
              {i > 0 && <span className="size-0.5 rounded-full bg-slate-600" />}
              {m}
            </span>
          ))}
        </div>
      </div>

      {/* ============ Formulário ============ */}
      <div className="flex flex-1 items-center justify-center rounded-none bg-slate-50 p-6 lg:my-2 lg:mr-2 lg:rounded-2xl">
        <div className="w-full max-w-[360px]">
          {/* marca no mobile */}
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--lito-sidebar-accent)] text-sm font-black text-white">
              {brand.shortName[0]}
            </div>
            <span className="text-base font-bold text-slate-900">{brand.name}</span>
          </div>

          {confirmationSent ? (
            <div>
              <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-emerald-100">
                <Check className="size-5 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900">
                Confirme seu e-mail
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Enviamos um link de confirmação para{" "}
                <span className="font-semibold text-slate-700">{form.email}</span>. Abra
                o link e depois entre com sua senha.
              </p>
              <Button
                variant="outline"
                className="mt-6"
                onClick={() => {
                  setConfirmationSent(false);
                  setMode("login");
                }}
              >
                Voltar para entrar
              </Button>
            </div>
          ) : (
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900">
                {mode === "login" ? "Entre na sua conta" : "Comece agora"}
              </h2>
              <p className="mb-7 mt-1 text-sm text-slate-500">
                {mode === "login"
                  ? "Bom te ver de novo."
                  : "Use o e-mail que recebeu o convite da sua equipe."}
              </p>

              {mode === "signup" && (
                <div className="mb-5 flex gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                  <Mail className="mt-0.5 size-4 shrink-0 text-indigo-500" />
                  <p className="text-[11px] leading-relaxed text-indigo-900">
                    O acesso é <strong>somente por convite</strong>. Cadastre-se com o mesmo
                    e-mail que recebeu o convite — assim você entra direto na empresa certa.
                  </p>
                </div>
              )}

              <div className="space-y-4">
                {mode === "signup" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-700">
                        Seu nome
                      </Label>
                      <Input
                        value={form.name}
                        onChange={set("name")}
                        placeholder="Como devemos te chamar"
                        className="h-10 bg-white"
                      />
                    </div>
                  </>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">E-mail</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    placeholder="voce@empresa.com.br"
                    className="h-10 bg-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Senha</Label>
                  <Input
                    type="password"
                    value={form.password}
                    onChange={set("password")}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                    placeholder="Mínimo 8 caracteres"
                    className="h-10 bg-white"
                  />
                </div>
                <Button className="h-10 w-full text-sm" disabled={loading} onClick={submit}>
                  {loading && <Loader2 className="size-4 animate-spin" />}
                  {mode === "login" ? "Entrar" : "Criar conta grátis"}
                </Button>
              </div>

              <div className="mt-7 border-t pt-5 text-center text-sm text-slate-500">
                {mode === "login" ? (
                  <>
                    Primeira vez aqui?{" "}
                    <button
                      onClick={() => setMode("signup")}
                      className="font-semibold text-indigo-600 hover:underline"
                    >
                      Criar conta grátis
                    </button>
                  </>
                ) : (
                  <>
                    Já usa o {brand.name}?{" "}
                    <button
                      onClick={() => setMode("login")}
                      className="font-semibold text-indigo-600 hover:underline"
                    >
                      Entrar
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
