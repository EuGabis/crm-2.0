import { Mp3Encoder } from "@breezystack/lamejs";

/**
 * Transcodifica um áudio gravado no navegador para **MP3 (audio/mpeg)**.
 *
 * ⚠️ **A causa, PROVADA em 02/09/2026 e não deduzida.** O `MediaRecorder` emite
 * MP4 **fragmentado** (`frag=true` no diagnóstico): o `moov` sai sem tabela de
 * amostras e as amostras moram nos fragmentos `moof`. O farejador de mídia da
 * Meta não identifica o arquivo e cai em `application/octet-stream` — o #131053.
 * Ogg/Opus do `opus-media-recorder` também é recusado nesta conta.
 *
 * O teste que fechou: no MESMO número, no MESMO minuto,
 *   - MP4 fragmentado gravado no navegador → recusado;
 *   - **MP3 anexado do computador → ENTREGUE E LIDO** (14:55, `audio/mpeg`,
 *     30.056 bytes).
 *
 * MP3 é um fluxo elementar, sem índice de contêiner para o analisador errar. É a
 * única forma que temos prova de funcionar nesta conta.
 *
 * ⚠️ **Transcodifica SEMPRE, qualquer que seja o formato gravado.** A primeira
 * versão disto (42b4580, revertida em 7c3dbf5) só convertia o ramo Ogg, porque a
 * hipótese da época era "esta conta recusa todo Ogg" — hipótese errada, já que o
 * Ogg entregou 191 vezes até 26/08. Deixar o MP4 passar direto manteria
 * exatamente o caminho que hoje falha.
 *
 * Roda 100% no cliente (Web Audio decodifica; lamejs codifica em JS puro), sem
 * ffmpeg no servidor — que não roda no serverless da Vercel. Voz curta: rápido.
 *
 * Mono, 64 kbps — de sobra para voz e mantém o arquivo pequeno.
 */
export async function audioParaMp3(blob: Blob, segundos: number): Promise<File> {
  const buf = await blob.arrayBuffer();
  const Ctx =
    (window.AudioContext as typeof AudioContext) ||
    ((window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new Ctx();
  let audio: AudioBuffer;
  try {
    // slice(0): decodeAudioData "detacha" o buffer; a cópia deixa o original intacto.
    audio = await ctx.decodeAudioData(buf.slice(0));
  } finally {
    void ctx.close();
  }

  // Mistura para MONO (a Cloud API só aceita voz mono; e o encoder é mono).
  const canais = audio.numberOfChannels;
  const n = audio.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < canais; c++) {
    const dados = audio.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += dados[i] / canais;
  }

  // Float32 [-1,1] → Int16 PCM (o que o lamejs consome).
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const s = mono[i] < -1 ? -1 : mono[i] > 1 ? 1 : mono[i];
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const taxa = audio.sampleRate; // 48000 típico; lamejs aceita 8/16/22.05/32/44.1/48k
  const enc = new Mp3Encoder(1, taxa, 64);
  const partes: Uint8Array[] = [];
  const BLOCO = 1152; // tamanho de quadro que o lamejs espera
  for (let i = 0; i < pcm.length; i += BLOCO) {
    const quadro = enc.encodeBuffer(pcm.subarray(i, i + BLOCO));
    if (quadro.length) partes.push(new Uint8Array(quadro));
  }
  const fim = enc.flush();
  if (fim.length) partes.push(new Uint8Array(fim));

  const total = partes.reduce((soma, p) => soma + p.length, 0);
  const saida = new Uint8Array(total);
  let off = 0;
  for (const p of partes) {
    saida.set(p, off);
    off += p.length;
  }

  return new File([saida], `audio-${segundos}s.mp3`, { type: "audio/mpeg" });
}
