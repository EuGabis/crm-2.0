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
 * Mostra o aviso. Devolve NULL quando conseguiu disparar, ou o motivo em texto
 * quando não — quem chama decide se mostra na tela (o botão "Testar" mostra).
 *
 * Sem esse retorno, um pop-up que não aparece tem quatro explicações
 * indistinguíveis: navegador sem suporte, permissão não concedida, caixinha
 * desligada aqui dentro, ou o Windows engolindo o aviso (Foco Assistido /
 * notificações do navegador desligadas no sistema). As três primeiras o CRM
 * sabe responder; a quarta é a que sobra quando esta função devolve null e nada
 * aparece.
 *
 * `href` é para onde o clique leva — a janela é trazida para a frente antes de
 * navegar, senão o CRM abriria atrás de tudo.
 */
export function showDesktop(item: {
  id: string;
  title: string;
  body: string;
  href: string;
}): string | null {
  const perm = desktopPermission();
  if (perm === "unsupported") return "Este navegador não suporta avisos do sistema.";
  if (perm === "denied") {
    return "O navegador bloqueou os avisos deste site. Libere no cadeado ao lado do endereço → Notificações.";
  }
  if (perm === "default") {
    return "Falta autorizar os avisos: use o botão \"Ativar avisos no computador\".";
  }
  if (window.localStorage.getItem(ENABLED_KEY) === "off") {
    return "Os avisos na área de trabalho estão desligados aqui nas preferências.";
  }
  try {
    const n = new Notification(item.title, {
      body: item.body,
      tag: item.id,
      icon: "/favicon.ico",
      /**
       * FICA NA TELA até a pessoa fechar.
       *
       * Sem isto, o Chrome no Windows desenha o próprio balãozinho por ~5
       * segundos e ele NÃO é arquivado na Central de Notificações do Windows —
       * quem estava com a cabeça em outra janela nunca vê e, ao abrir a central
       * depois, encontra "não há notificações novas". Era exatamente o sintoma
       * relatado. Com `requireInteraction`, o aviso espera.
       */
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      window.location.href = item.href;
      n.close();
    };
    return null;
  } catch (e) {
    // Android/Chrome exige Service Worker para notificação; no desktop não.
    return e instanceof Error ? `O navegador recusou o aviso: ${e.message}` : "O navegador recusou o aviso.";
  }
}

/**
 * Estado real de cada peça do caminho, para a tela poder MOSTRAR em vez de o
 * usuário adivinhar. "Não apareceu" tem cinco explicações possíveis e quatro
 * delas o navegador sabe responder — a quinta (o Windows engolindo) é a que
 * sobra quando todas as linhas abaixo estão verdes.
 */
export function desktopDiagnostics(): { label: string; value: string; ok: boolean }[] {
  if (typeof window === "undefined") return [];
  const perm = desktopPermission();
  const secure = window.isSecureContext;
  return [
    {
      label: "Navegador suporta",
      value: perm === "unsupported" ? "não" : "sim",
      ok: perm !== "unsupported",
    },
    {
      // A pegadinha silenciosa: fora de HTTPS (ou localhost) o Chrome nem
      // pergunta — acessar o CRM pelo IP da rede local cai aqui.
      label: "Conexão segura",
      value: secure ? "sim" : "não (precisa de HTTPS ou localhost)",
      ok: secure,
    },
    {
      label: "Permissão do site",
      value:
        perm === "granted" ? "concedida" : perm === "denied" ? "negada" : "ainda não pedida",
      ok: perm === "granted",
    },
    {
      label: "Ligado aqui",
      value: window.localStorage.getItem(ENABLED_KEY) === "off" ? "não" : "sim",
      ok: window.localStorage.getItem(ENABLED_KEY) !== "off",
    },
    { label: "Endereço", value: window.location.origin, ok: true },
  ];
}
