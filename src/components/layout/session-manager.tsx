"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { hasBrowserSession, clearBrowserSession } from "@/lib/auth/session-marker";

const PRESENCE_MS = 5 * 60 * 1000; // online (distribuição) = ativo nos últimos 5 min
const IDLE_LOGOUT_MS = 10 * 60 * 1000; // desloga por inatividade após 10 min (papel "user")
const WARN_BEFORE_MS = 60 * 1000; // avisa na tela 1 min antes de deslogar
const ACTIVITY = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];

/**
 * Gestão de sessão no cliente (montado só dentro de (app)):
 *
 * 1) Fechar o navegador → login: se o marcador de sessão do navegador sumiu (navegador
 *    fechado e reaberto) mas ainda há sessão Supabase válida, desloga. Refresh, nova aba
 *    e navegação mantêm o marcador, então não deslogam.
 * 2) Idle 10 min → login: SÓ para papel "user", com aviso na tela 1 min antes. Admin
 *    (ou papel ainda desconhecido) nunca cai por inatividade.
 * 3) Presença: carimba last_seen_at enquanto ativo (online = ≤ 5 min) para o rodízio.
 */
export function SessionManager() {
  const { me } = useMyMembership();
  const lastActivity = useRef(Date.now());
  const done = useRef(false);
  const [warnSeconds, setWarnSeconds] = useState<number | null>(null);

  const logout = async (reason: "idle" | "expired") => {
    if (done.current) return;
    done.current = true;
    try {
      // scope "local": só esta sessão/dispositivo — não derruba o mesmo usuário
      // logado no celular/outro navegador.
      await createClient().auth.signOut({ scope: "local" });
    } catch {
      // best-effort — mesmo se falhar, limpamos o marcador e mandamos pro login
    }
    clearBrowserSession();
    window.location.href = `/login?reason=${reason}`;
  };

  // Parte 2 — marcador de sessão do navegador
  useEffect(() => {
    if (!hasBrowserSession()) void logout("expired");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Parte 3 — presença: carimba last_seen_at enquanto o usuário está ativo. É o que
  // define quem está "online" para receber leads no rodízio (visto ≤ 5 min).
  useEffect(() => {
    const supabase = createClient();
    let lastAct = Date.now();
    const bump = () => {
      lastAct = Date.now();
    };
    ACTIVITY.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    // IMPORTANTE: o builder do supabase é lazy — precisa de await/.then() para a
    // chamada REALMENTE ir ao banco. Sem isso o last_seen_at nunca era gravado e
    // todo mundo aparecia offline (a distribuição caía sempre no "todos offline").
    const ping = async () => {
      if (Date.now() - lastAct <= PRESENCE_MS) {
        try {
          await supabase.rpc("touch_presence");
        } catch {
          // best-effort (ex.: rede oscilando)
        }
      }
    };
    void ping(); // marca presença já ao abrir
    const interval = window.setInterval(() => void ping(), 60000);
    return () => {
      ACTIVITY.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(interval);
    };
  }, []);

  // Parte 1 — inatividade (só papel "user"): avisa 1 min antes e desloga em 10 min.
  useEffect(() => {
    if (me?.role !== "user") return; // admin / desconhecido → não arma o timer
    lastActivity.current = Date.now(); // zera o relógio quando o timer realmente arma
    const bump = () => {
      lastActivity.current = Date.now();
      setWarnSeconds((w) => (w === null ? w : null)); // some com o aviso ao interagir
    };
    ACTIVITY.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const interval = window.setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= IDLE_LOGOUT_MS) {
        void logout("idle");
      } else if (idle >= IDLE_LOGOUT_MS - WARN_BEFORE_MS) {
        setWarnSeconds(Math.max(1, Math.ceil((IDLE_LOGOUT_MS - idle) / 1000)));
      } else {
        setWarnSeconds((w) => (w === null ? w : null));
      }
    }, 1000);
    return () => {
      ACTIVITY.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.role]);

  if (warnSeconds === null) return null;
  return (
    <div className="fixed inset-x-0 bottom-4 z-[200] flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg">
        <span className="text-sm text-amber-800">
          Você será desconectado por inatividade em <strong>{warnSeconds}s</strong>.
        </span>
        <button
          onClick={() => {
            lastActivity.current = Date.now();
            setWarnSeconds(null);
          }}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
        >
          Continuar conectado
        </button>
      </div>
    </div>
  );
}
