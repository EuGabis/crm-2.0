import { Mp3Encoder } from "@breezystack/lamejs";

/**
 * Transcodifica um áudio gravado no navegador (Ogg/Opus do Chrome, ou qualquer
 * coisa que o Web Audio saiba decodificar) para **MP3 (audio/mpeg)**.
 *
 * ⚠️ **Por que existe.** A Cloud API do WhatsApp lista `audio/ogg` (Opus) como
 * aceito, mas ESTA conta recusa todo Ogg/Opus com #131053 "Media upload error"
 * — mesmo um arquivo impecável (mono, pre-skip corrigido, EOS, CRC ok) que a
 * Meta recebe IDÊNTICO (verificado por round-trip). Imagem/vídeo/documento
 * passam pelo mesmo caminho e nunca falham, então o problema é o formato do
 * áudio, não a transmissão. MP3 é formato de primeira classe e universalmente
 * aceito, e o Chrome não grava mp4/aac — daí transcodificar aqui.
 *
 * Roda 100% no cliente (Web Audio decodifica; lamejs codifica em JS puro), sem
 * ffmpeg no servidor (que não roda no serverless da Vercel). Voz curta: rápido.
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
