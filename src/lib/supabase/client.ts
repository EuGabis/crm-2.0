"use client";

import { createBrowserClient } from "@supabase/ssr";
import { criarFetchVigiado } from "./vigiar-falhas";

// Um só fetch vigiado por aba: tempo esgotado e falha de conexão vão para a
// tela de Saúde em vez de virarem "veio vazio" em silêncio.
const fetchVigiado = criarFetchVigiado();

// Cliente para uso em componentes client. Usa apenas a chave publishable
// (segura para o navegador) — a segurança real vem das políticas RLS no banco.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { global: { fetch: fetchVigiado } }
  );
}
