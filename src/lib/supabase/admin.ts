import { createClient } from "@supabase/supabase-js";
import { criarFetchVigiado } from "./vigiar-falhas";

// O tique, o webhook e a sincronização também estouram o tempo (a devolução ao
// rodízio de Vendas parou assim): registrados sem empresa, valem para todas.
const fetchVigiado = criarFetchVigiado();

/**
 * Cliente com a service role — ignora RLS.
 *
 * NUNCA importar em componente client: a chave só existe no servidor
 * (sem prefixo NEXT_PUBLIC_). Usado por rotas que precisam ler/escrever
 * em nome de qualquer empresa sem sessão de usuário (motor de automações,
 * motor de e-mail marketing, webhook e sincronização de pagamentos da Guru).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Cliente admin sem credenciais: defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchVigiado },
  });
}
