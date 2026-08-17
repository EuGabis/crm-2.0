"use client";

/**
 * Aviso na área de trabalho (Notification API do navegador).
 *
 * Some do CRM e aparece no sistema — é o que faz o atendente ver a mensagem
 * nova com a aba do CRM atrás do WhatsApp Web ou do e-mail.
 *
 * Regras do navegador que ditam o desenho aqui:
 *   * a permissão SÓ pode ser pedida a partir de um gesto do usuário, então
 *     existe um botão no painel — pedir sozinho ao carregar seria bloqueado
 *     pelo Chrome e queimaria a única chance de perguntar;
 *   * negada, não dá para perguntar de novo pelo código (só nas permissões do
 *     site), e por isso a tela explica isso em vez de insistir;
 *   * `tag` faz o mesmo aviso se SUBSTITUIR em vez de empilhar — sem ela, uma
 *     conversa que recebe três mensagens vira três pop-ups.
 */

const ENABLED_KEY = "lito.notifications.desktop";

export type DesktopPermission = "unsupported" | "default" | "granted" | "denied";

export function desktopPermission(): DesktopPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as DesktopPermission;
}

/** Ligado pelo usuário E permitido pelo navegador — as duas coisas. */
export function desktopEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (desktopPermission() !== "granted") return false;
  return window.localStorage.getItem(ENABLED_KEY) !== "off";
}

export function setDesktopEnabled(on: boolean) {
  try {
    window.localStorage.setItem(ENABLED_KEY, on ? "on" : "off");
  } catch {
    // localStorage bloqueado — volta ao padrão no F5.
  }
}

/** Pede a permissão (precisa vir de um clique). Devolve o estado final. */
export async function requestDesktop(): Promise<DesktopPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") {
    setDesktopEnabled(true);
    return "granted";
  }
  if (Notification.permission === "denied") return "denied";
  const result = await Notification.requestPermission();
  if (result === "granted") setDesktopEnabled(true);
  return result as DesktopPermission;
}

/**
 * Mostra o aviso. `href` é para onde o clique leva — a janela é trazida para a
 * frente antes de navegar, senão o CRM abriria atrás de tudo.
 */
export function showDesktop(item: { id: string; title: string; body: string; href: string }) {
  if (!desktopEnabled()) return;
  try {
    const n = new Notification(item.title, {
      body: item.body,
      tag: item.id,
      icon: "/favicon.ico",
    });
    n.onclick = () => {
      window.focus();
      window.location.href = item.href;
      n.close();
    };
  } catch {
    // Alguns navegadores exigem Service Worker (Android). Sem pop-up, o sino
    // continua funcionando — não é motivo para quebrar nada.
  }
}
