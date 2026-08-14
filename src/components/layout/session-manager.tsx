"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useMyMembership } from "@/lib/data/repos/db/team";
import { hasBrowserSession, clearBrowserSession } from "@/lib/auth/session-marker";

const IDLE_MS = 5 * 60 * 1000; // 5 minutos
const ACTIVITY = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];

/**
 * Gestão de sessão no cliente (montado só dentro de (app)):
 *
 * 1) Fechar o navegador → login: se o marcador de sessão do navegador sumiu (navegador
 *    fechado e reaberto) mas ainda há sessão Supabase válida, desloga. Refresh, nova aba
 *    e navegação mantêm o marcador, então não deslogam.
 * 2) Idle 5 min → login: SÓ para papel "user". Admin (ou papel ainda desconhecido)
 *    nunca cai por inatividade.
 */
export function SessionManager() {
  const { me } = useMyMembership();
  const lastActivity = useRef(Date.now());
  const done = useRef(false);

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

  // Parte 1 — idle timeout (só papel "user")
  useEffect(() => {
    if (me?.role !== "user") return; // admin / desconhecido → não arma o timer
    lastActivity.current = Date.now(); // zera o relógio quando o timer realmente arma
    const bump = () => {
      lastActivity.current = Date.now();
    };
    ACTIVITY.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const interval = window.setInterval(() => {
      if (Date.now() - lastActivity.current > IDLE_MS) void logout("idle");
    }, 15000);
    return () => {
      ACTIVITY.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.role]);

  return null;
}
