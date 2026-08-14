// Marcador de "sessão de navegador": um cookie de SESSÃO (sem max-age/expires) que
// o navegador apaga sozinho ao fechar. É só um sinal de UX para exigir login depois de
// fechar o navegador — NÃO é credencial (a barreira real de rotas é o proxy/RLS).
// Setado apenas no login; sobrevive a refresh, navegação e nova aba enquanto o navegador
// estiver aberto (é compartilhado entre abas por ser cookie).

const MARKER = "lito_active";

export function markBrowserSession(): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${MARKER}=1; path=/; samesite=lax${secure}`;
}

export function hasBrowserSession(): boolean {
  if (typeof document === "undefined") return true; // no SSR não decide nada
  return document.cookie.split("; ").some((c) => c.startsWith(`${MARKER}=`));
}

export function clearBrowserSession(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${MARKER}=; path=/; max-age=0`;
}
