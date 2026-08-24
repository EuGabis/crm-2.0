"use client";

/**
 * Preferências de interface por usuário (guardadas no navegador): tema
 * claro/escuro e tamanho da fonte. Aplicadas no <html> — a fonte via
 * `font-size` (as classes rem do Tailwind escalam junto) e o tema via a classe
 * `.dark`. Um script inline no layout aplica isso ANTES do render (sem flash).
 */

export type ThemePref = "light" | "dark";

export const THEME_KEY = "lito-theme";
export const FONT_KEY = "lito-font-px";

/** Tamanhos oferecidos (px na raiz). 16 = padrão do navegador. */
export const FONT_SIZES = [14, 15, 16, 17, 18, 20];
export const DEFAULT_FONT = 16;

export function getTheme(): ThemePref {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}

export function getFontPx(): number {
  if (typeof window === "undefined") return DEFAULT_FONT;
  const raw = Number(window.localStorage.getItem(FONT_KEY));
  return FONT_SIZES.includes(raw) ? raw : DEFAULT_FONT;
}

export function applyTheme(theme: ThemePref) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function applyFont(px: number) {
  document.documentElement.style.fontSize = `${px}px`;
}

export function setTheme(theme: ThemePref) {
  window.localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

export function setFontPx(px: number) {
  window.localStorage.setItem(FONT_KEY, String(px));
  applyFont(px);
}

/** Script (string) executado inline no <head> para aplicar sem flash. */
export const PREFS_BOOT_SCRIPT = `
(function(){try{
  var t = localStorage.getItem('${THEME_KEY}');
  if (t === 'dark') document.documentElement.classList.add('dark');
  var f = Number(localStorage.getItem('${FONT_KEY}'));
  if ([${FONT_SIZES.join(",")}].indexOf(f) !== -1) document.documentElement.style.fontSize = f + 'px';
}catch(e){}})();
`;
