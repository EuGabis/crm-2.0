/**
 * Inspeção do áudio ANTES de mandar para a Cloud API.
 *
 * ⚠️ **Por que no servidor, e não só no navegador.** A Meta aceita o upload,
 * responde 200 com id de mensagem, e só recusa DEPOIS, ao processar — o
 * webhook de status volta com `errors[0].title = "Media upload error"` (131053),
 * que é um rótulo de CATEGORIA e não diz o que está errado. Resultado: o
 * atendente via "falhou", o toast dizia "Áudio enviado" (porque a chamada de
 * fato deu 200) e não havia como saber o motivo.
 *
 * Aqui os bytes são lidos onde temos o arquivo em mãos, e a recusa passa a ter
 * motivo específico gravado em `messages.error_detail` — sem gastar a ida à Meta
 * para receber um rótulo genérico de volta.
 *
 * ⚠️ **A checagem no navegador tinha um furo que isto corrige.** Ela era
 * `if (canais !== null && canais > 1)`, então "não achei o cabeçalho OpusHead"
 * (null) passava CALADO, indistinguível de mono. Um arquivo que não fosse
 * Ogg/Opus — WebM, WAV — não disparava aviso nenhum. Agora "não é Ogg/Opus" é um
 * resultado nomeado, não a ausência de resultado.
 */

/** O que a Cloud API aceita em `audio/ogg`: OPUS, e mono. */
const CANAIS_ACEITOS = 1;

export interface InspecaoDeAudio {
  /** Contêiner reconhecido pelos bytes iniciais, não pelo mime declarado. */
  container: "ogg" | "webm" | "wav" | "mp4" | "mp3" | "desconhecido";
  /** Canais lidos do OpusHead; null quando não há OpusHead. */
  canais: number | null;
  /** Taxa de entrada declarada no OpusHead (informativa). */
  taxa: number | null;
  bytes: number;
  /** `false` = sabemos que a Meta vai recusar. */
  aceitavel: boolean;
  /** Vazio quando aceitável; texto para o atendente quando não. */
  motivo: string;
}

function achar(buf: Uint8Array, texto: string, ate = 300): number {
  const alvo = [...texto].map((c) => c.charCodeAt(0));
  const limite = Math.min(buf.length - alvo.length, ate);
  for (let i = 0; i <= limite; i++) {
    let bate = true;
    for (let k = 0; k < alvo.length; k++) {
      if (buf[i + k] !== alvo[k]) {
        bate = false;
        break;
      }
    }
    if (bate) return i;
  }
  return -1;
}

/** Contêiner pelos bytes de assinatura — o mime declarado pode mentir. */
function containerDe(buf: Uint8Array): InspecaoDeAudio["container"] {
  if (achar(buf, "OggS", 0) === 0) return "ogg";
  // EBML (Matroska/WebM)
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "webm";
  if (achar(buf, "RIFF", 0) === 0 && achar(buf, "WAVE", 12) === 8) return "wav";
  if (achar(buf, "ftyp", 8) === 4) return "mp4";
  if (achar(buf, "ID3", 0) === 0 || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return "mp3";
  return "desconhecido";
}

export function inspecionarAudio(bytes: ArrayBuffer): InspecaoDeAudio {
  const buf = new Uint8Array(bytes.slice(0, 400));
  const container = containerDe(buf);
  const total = bytes.byteLength;

  // O campo de canais é o byte 9 do OpusHead (magia de 8 + 1 de versão). A magia
  // é PROCURADA e não lida em posição fixa: antes dela vem o cabeçalho da página
  // Ogg, cujo tamanho varia com a tabela de segmentos.
  const iHead = achar(buf, "OpusHead");
  const canais = iHead >= 0 ? (buf[iHead + 9] ?? null) : null;
  const taxa =
    iHead >= 0 && iHead + 15 < buf.length
      ? buf[iHead + 12]! |
        (buf[iHead + 13]! << 8) |
        (buf[iHead + 14]! << 16) |
        (buf[iHead + 15]! << 24)
      : null;

  const base = { container, canais, taxa, bytes: total };

  if (total === 0) {
    return { ...base, aceitavel: false, motivo: "O arquivo de áudio está vazio (0 bytes)." };
  }
  if (container !== "ogg") {
    const oQueE =
      container === "desconhecido"
        ? "O áudio não está num formato reconhecível"
        : `O áudio foi gravado como ${container.toUpperCase()}`;
    return {
      ...base,
      aceitavel: false,
      motivo:
        `${oQueE}, e o WhatsApp aceita só OGG/Opus. Isso costuma ser o codificador Opus ` +
        `não ter carregado no navegador — recarregue a página e tente de novo.`,
    };
  }
  if (canais === null) {
    return {
      ...base,
      aceitavel: false,
      motivo:
        "O arquivo é OGG mas não tem cabeçalho OpusHead — provavelmente não está em Opus, " +
        "que é o único codec de áudio que o WhatsApp aceita.",
    };
  }
  if (canais !== CANAIS_ACEITOS) {
    return {
      ...base,
      aceitavel: false,
      motivo: `O áudio saiu com ${canais} canais e o WhatsApp aceita só mono (1 canal).`,
    };
  }
  return { ...base, aceitavel: true, motivo: "" };
}

/** Linha curta para log — é o que caracteriza o arquivo quando algo falha. */
export function resumoDaInspecao(i: InspecaoDeAudio): string {
  return `container=${i.container} canais=${i.canais ?? "?"} taxa=${i.taxa ?? "?"} bytes=${i.bytes}`;
}
