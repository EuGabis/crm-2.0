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

  /*
   * ⚠️ **Cabeçalho válido NÃO é fluxo válido**, e foi essa suposição que fez a
   * investigação persuadir o mime por três rodadas. As checagens acima leem os
   * primeiros 400 bytes; a Meta recusa por não conseguir DECODIFICAR o arquivo
   * ("on processing it is of type application/octet-stream"). Só percorrendo as
   * páginas dá para saber se falta OpusTags, se não há página de áudio ou se o
   * fluxo ficou sem fechar.
   */
  const ogg = analisarOgg(bytes);
  if (ogg.problemas.length) {
    return {
      ...base,
      aceitavel: false,
      motivo:
        `O arquivo tem cabeçalho de OGG/Opus válido mas o fluxo está incompleto ` +
        `(${ogg.problemas.join("; ")}), e a Meta recusa o que não consegue decodificar.`,
    };
  }
  return { ...base, aceitavel: true, motivo: "" };
}

/** Linha curta para log — é o que caracteriza o arquivo quando algo falha. */
export function resumoDaInspecao(i: InspecaoDeAudio): string {
  return `container=${i.container} canais=${i.canais ?? "?"} taxa=${i.taxa ?? "?"} bytes=${i.bytes}`;
}

/* ------------------------------------------------------------------ *
 * O mime que declaramos para a Meta
 * ------------------------------------------------------------------ */

/** Assinatura de bytes -> mime que a Cloud API aceita, sem parâmetros. */
const MIME_POR_CONTAINER: Partial<Record<InspecaoDeAudio["container"], string>> = {
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  // `webm` e `wav` de propósito FORA: a Cloud API não aceita nenhum dos dois em
  // áudio, e mapeá-los só trocaria a recusa da Meta por outra recusa da Meta.
};

/**
 * Tira os parâmetros de um mime: `audio/ogg; codecs=opus` -> `audio/ogg`.
 *
 * ⚠️ **Foi exatamente isto que a Meta recusou**, e ela disse com todas as
 * letras: "uploaded with mimetype as audio/ogg; codecs=opus, however on
 * processing it is of type application/octet-stream". A lista de tipos aceitos
 * da Cloud API tem `audio/ogg`, não a forma com parâmetro — e com o parâmetro
 * ela não reconhece o arquivo, cai em `application/octet-stream` e acusa
 * divergência entre o declarado e o real.
 */
export function mimeSemParametros(mime: string): string {
  return mime.split(";")[0]!.trim().toLowerCase();
}

/**
 * Mime a declarar no upload, **derivado dos BYTES** quando dá para reconhecê-los.
 *
 * ⚠️ A queixa da Meta é sobre DIVERGÊNCIA entre o tipo declarado e o conteúdo.
 * Enquanto o valor declarado vem do cliente (`file.type` do navegador, guardado
 * no Storage e devolvido no corpo da requisição), essa divergência é sempre
 * possível: basta um navegador anotar o tipo de um jeito, um bundle antigo em
 * cache, ou um arquivo renomeado à mão. Derivando do próprio conteúdo, a
 * divergência deixa de existir por construção — não é conserto de um caso, é a
 * remoção da classe inteira.
 *
 * O declarado ainda serve de reserva para o que não sabemos farejar (PDF, DOCX,
 * imagem), mas SEM parâmetros: tirar o `; codecs=...` é correto em qualquer
 * caso, porque a Cloud API compara com uma lista de tipos sem parâmetro.
 */
export function mimeParaUpload(
  bytes: ArrayBuffer,
  mimeDeclarado: string,
  /** `true` quando a mensagem é do tipo áudio, mesmo que o mime não diga. */
  ehAudio = false,
): string {
  const limpo = mimeSemParametros(mimeDeclarado) || "application/octet-stream";
  /*
   * ⚠️ Farejar também quando o declarado é `application/octet-stream` ou vazio
   * fecha um furo que a primeira versão desta função tinha: a condição era só
   * `limpo.startsWith("audio/")`, então um OGG legítimo cujo mime tinha se
   * perdido no caminho (corpo sem `mime`, ou Storage devolvendo genérico) era
   * enviado à Meta COMO octet-stream — a divergência exata que ela recusa. O
   * teste com "ogg real, declarado octet" foi o que mostrou isso.
   *
   * `ehAudio` vem do `kind` da mensagem, que é a intenção do usuário e não
   * depende de nenhum mime ter sobrevivido à viagem.
   */
  const valeFarejar =
    ehAudio || limpo.startsWith("audio/") || limpo === "application/octet-stream" || !limpo;
  if (valeFarejar) {
    const container = containerDe(new Uint8Array(bytes.slice(0, 400)));
    const porBytes = MIME_POR_CONTAINER[container];
    // Só reescreve quando a assinatura é CONCLUSIVA: palpite nosso por cima de
    // um mime declarado correto trocaria um erro por outro.
    if (porBytes) return porBytes;
  }
  return limpo;
}

/* ------------------------------------------------------------------ *
 * Análise do FLUXO Ogg, não só do cabeçalho
 *
 * ⚠️ `inspecionarAudio` lê os primeiros 400 bytes: confirma que começa com
 * `OggS` e que o `OpusHead` diz 1 canal. Isso passou, e a Meta recusou de todo
 * jeito — com o commit da correção confirmado no ar (`GET` desta rota devolvia
 * `audioMimeSemParametro: true`). Ou seja, o problema não é o rótulo: é o
 * CONTEÚDO, e um cabeçalho válido não garante fluxo válido.
 *
 * A frase da Meta lida de novo diz exatamente isso: "however on processing it is
 * of type application/octet-stream" — o farejador dela não reconheceu o arquivo.
 * E `audio/ogg; codecs=opus` é a forma canônica que ela própria usa para nota de
 * voz, então a primeira metade da frase provavelmente é a Meta se citando, não
 * citando o que mandamos. Foi isso que fez a investigação perseguir o mime por
 * três rodadas.
 *
 * O que um Ogg/Opus VÁLIDO precisa ter, pela RFC 7845, e que o cabeçalho sozinho
 * não prova:
 *   - página 1 com a marca BOS e carga `OpusHead`;
 *   - página 2 com carga `OpusTags` (cabeçalho de comentários) — **obrigatória**,
 *     e é justamente o que alguns codificadores de navegador omitem;
 *   - ao menos uma página de áudio depois dela;
 *   - a última página com a marca EOS (fim de fluxo).
 * Navegador e Whisper toleram a falta de qualquer um desses; parser estrito, não.
 * ------------------------------------------------------------------ */

export interface AnaliseOgg {
  paginas: number;
  temOpusHead: boolean;
  /** Segunda página com `OpusTags` — obrigatória pela RFC 7845. */
  temOpusTags: boolean;
  paginasDeAudio: number;
  /** Marca EOS na última página: o fluxo declara que terminou. */
  temEos: boolean;
  /** Amostras totais em 48 kHz, do granule da última página. */
  granuleFinal: number;
  /** Bytes que sobraram sem formar página — sinal de arquivo truncado. */
  sobra: number;
  problemas: string[];
}

/** Percorre as páginas Ogg e diz o que o fluxo tem e o que falta. */
export function analisarOgg(bytes: ArrayBuffer): AnaliseOgg {
  const b = new Uint8Array(bytes);
  const r: AnaliseOgg = {
    paginas: 0,
    temOpusHead: false,
    temOpusTags: false,
    paginasDeAudio: 0,
    temEos: false,
    granuleFinal: 0,
    sobra: 0,
    problemas: [],
  };

  const marca = (i: number, t: string) =>
    [...t].every((c, k) => b[i + k] === c.charCodeAt(0));

  let i = 0;
  let ultimoTipo = 0;
  while (i + 27 <= b.length) {
    if (!marca(i, "OggS")) {
      // Lixo entre páginas é corrupção: um Ogg é uma sequência contígua delas.
      r.sobra = b.length - i;
      r.problemas.push(`bytes fora de página na posição ${i}`);
      break;
    }
    const nSeg = b[i + 26]!;
    const tabela = i + 27;
    if (tabela + nSeg > b.length) {
      r.sobra = b.length - i;
      r.problemas.push("tabela de segmentos cortada (arquivo truncado)");
      break;
    }
    let carga = 0;
    for (let k = 0; k < nSeg; k++) carga += b[tabela + k]!;
    const inicioCarga = tabela + nSeg;
    if (inicioCarga + carga > b.length) {
      r.sobra = b.length - i;
      r.problemas.push("carga da última página cortada (arquivo truncado)");
      break;
    }

    ultimoTipo = b[i + 5]!;
    // Granule é int64 LE; em 48 kHz um áudio de horas não passa de 2^53, então
    // ler como dois inteiros de 32 bits é seguro e evita BigInt.
    const gLo =
      b[i + 6]! | (b[i + 7]! << 8) | (b[i + 8]! << 16) | (b[i + 9]! * 0x1000000);
    const gHi =
      b[i + 10]! | (b[i + 11]! << 8) | (b[i + 12]! << 16) | (b[i + 13]! * 0x1000000);
    r.granuleFinal = gHi * 0x100000000 + gLo;

    if (r.paginas === 0 && marca(inicioCarga, "OpusHead")) r.temOpusHead = true;
    else if (r.paginas === 1 && marca(inicioCarga, "OpusTags")) r.temOpusTags = true;
    else if (r.paginas >= 1) r.paginasDeAudio++;

    r.paginas++;
    i = inicioCarga + carga;
  }
  if (i === b.length) r.sobra = 0;
  r.temEos = (ultimoTipo & 0x04) !== 0;

  if (!r.temOpusHead) r.problemas.push("primeira página não é OpusHead");
  if (!r.temOpusTags) r.problemas.push("falta a página OpusTags (obrigatória na RFC 7845)");
  if (r.paginasDeAudio === 0) r.problemas.push("nenhuma página de áudio");
  if (!r.temEos) r.problemas.push("última página sem a marca EOS (fluxo não fechado)");
  return r;
}

/** Linha curta para log. */
export function resumoDoOgg(a: AnaliseOgg): string {
  return (
    `paginas=${a.paginas} head=${a.temOpusHead} tags=${a.temOpusTags} ` +
    `audio=${a.paginasDeAudio} eos=${a.temEos} granule=${a.granuleFinal} sobra=${a.sobra}` +
    (a.problemas.length ? ` PROBLEMAS[${a.problemas.join("; ")}]` : "")
  );
}
