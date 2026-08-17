"use client";

/**
 * Toques da central de notificações.
 *
 * Os sons são SINTETIZADOS no navegador (Web Audio), não arquivos:
 *   * nada para baixar — nenhum atraso na primeira notificação, e funciona com
 *     a rede caindo;
 *   * nada em `/public` para versionar, e nenhuma dúvida de licença de áudio;
 *   * cada toque tem 20 linhas de descrição em vez de 100 KB de MP3.
 *
 * Um MP3 próprio continua possível: bastaria uma opção com `new Audio(url)` ao
 * lado destas. Não entrou porque exigiria upload, bucket e limite de tamanho
 * para um ganho pequeno.
 *
 * A escolha vive no `localStorage`, como o resto do estado do sino: é
 * preferência de dispositivo (o som toca no computador que está aberto, não
 * "na conta").
 */

export type SoundId = "mudo" | "bordo" | "bordo-duplo" | "ping" | "alerta" | "suave";

export const SOUNDS: { id: SoundId; label: string; hint: string }[] = [
  { id: "bordo", label: "Sino de bordo", hint: "O ding-dong da cabine de avião" },
  { id: "bordo-duplo", label: "Sino de bordo duplo", hint: "Duas chamadas seguidas" },
  { id: "ping", label: "Ping", hint: "Um toque curto e discreto" },
  { id: "alerta", label: "Alerta", hint: "Três bipes — difícil de ignorar" },
  { id: "suave", label: "Suave", hint: "Grave e longo, para ambiente silencioso" },
  { id: "mudo", label: "Sem som", hint: "Só o aviso na tela" },
];

const STORAGE_KEY = "lito.notifications.sound";
export const DEFAULT_SOUND: SoundId = "bordo";

export function loadSound(): SoundId {
  if (typeof window === "undefined") return DEFAULT_SOUND;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return SOUNDS.some((s) => s.id === raw) ? (raw as SoundId) : DEFAULT_SOUND;
}

export function saveSound(id: SoundId) {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // localStorage bloqueado — volta ao padrão no F5, nada quebra.
  }
}

/* --------------------------------- síntese -------------------------------- */

let ctx: AudioContext | null = null;

/**
 * O AudioContext nasce SUSPENSO até um gesto do usuário (política de autoplay
 * dos navegadores). Por isso ele é criado na primeira reprodução — que vem do
 * clique em "ouvir" — e reaproveitado depois; a partir daí a notificação
 * automática consegue tocar.
 */
function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Uma nota com decaimento de sino (ataque curto, cauda longa). */
function bell(
  context: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  gain: number,
  type: OscillatorType = "sine",
) {
  const osc = context.createOscillator();
  const env = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  // Rampa exponencial não aceita zero — daí o 0.0001 no fim.
  env.gain.setValueAtTime(0.0001, startAt);
  env.gain.exponentialRampToValueAtTime(gain, startAt + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(env).connect(context.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

/** Toca o som escolhido. Silencioso (e sem erro) onde não há Web Audio. */
export function playSound(id: SoundId) {
  if (id === "mudo") return;
  const context = audioContext();
  if (!context) return;
  const t = context.currentTime + 0.02;

  switch (id) {
    case "bordo":
      // Mi5 -> Dó5: o intervalo descendente do aviso de cabine.
      bell(context, 659.25, t, 0.9, 0.22);
      bell(context, 523.25, t + 0.28, 1.1, 0.22);
      break;
    case "bordo-duplo":
      bell(context, 659.25, t, 0.7, 0.2);
      bell(context, 523.25, t + 0.24, 0.7, 0.2);
      bell(context, 659.25, t + 0.62, 0.7, 0.16);
      bell(context, 523.25, t + 0.86, 1.0, 0.16);
      break;
    case "ping":
      bell(context, 880, t, 0.45, 0.2);
      break;
    case "alerta":
      bell(context, 987.77, t, 0.16, 0.16, "triangle");
      bell(context, 987.77, t + 0.2, 0.16, 0.16, "triangle");
      bell(context, 987.77, t + 0.4, 0.24, 0.16, "triangle");
      break;
    case "suave":
      bell(context, 392, t, 1.4, 0.16, "triangle");
      break;
  }
}
