import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Upload no Storage que sobrevive a token vencido.
 *
 * ⚠️ Com a aba aberta há horas (notebook suspenso, rede trocando), o access
 * token pode vencer sem o refresh automático ter rodado. O Storage então recebe
 * o pedido como ANÔNIMO, `private.user_locations()` volta vazio e a resposta é
 * "new row violates row-level security policy" — que parece defeito de
 * permissão e não é (relato do Rogério, 2026-10-28, ao mandar imagem).
 *
 * Por isso: renova o token se estiver a menos de 60 s de vencer, e, se ainda
 * assim a RLS recusar, força um refresh e tenta UMA vez mais.
 */
export async function uploadComSessao(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  file: File | Blob,
  opts: { contentType?: string; upsert?: boolean },
): Promise<{ error: string | null }> {
  const { data } = await supabase.auth.getSession();
  const expira = data.session?.expires_at ? data.session.expires_at * 1000 : 0;
  if (!data.session || expira - Date.now() < 60_000) await supabase.auth.refreshSession();

  const tentar = () => supabase.storage.from(bucket).upload(path, file, opts);
  let { error } = await tentar();
  if (error && /row-level security|unauthorized|jwt/i.test(error.message)) {
    const { error: refErr } = await supabase.auth.refreshSession();
    if (refErr) return { error: "Sua sessão expirou. Recarregue a página (F5) e envie de novo." };
    ({ error } = await tentar());
    if (error && /row-level security/i.test(error.message)) {
      return { error: "Sem permissão para enviar arquivo nesta conversa. Recarregue a página (F5); se continuar, avise um administrador." };
    }
  }
  return { error: error ? error.message : null };
}
