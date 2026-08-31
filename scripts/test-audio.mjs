#!/usr/bin/env node
/**
 * Bateria de testes do módulo de áudio do WhatsApp (`src/lib/whatsapp/audio.ts`).
 *
 * ⚠️ **Por que este arquivo existe.** O envio de áudio consumiu DOZE rodadas de
 * investigação (mime, estéreo, contêiner, fluxo Ogg, pre-skip, round-trip) e o
 * módulo que saiu dela não tinha um único teste comitado — as verificações foram
 * feitas em scripts descartáveis. Ou seja: a peça mais depurada do repositório
 * era também a única sem rede contra regressão. Qualquer refatoração futura
 * quebraria em silêncio, e o sintoma só apareceria como "Não foi entregue" no
 * balão de um atendente, dias depois.
 *
 * ⚠️ **O CRC é calculado aqui por uma SEGUNDA implementação, com tabela.** Testar
 * `crcOgg` contra si mesma não provaria nada. A implementação do módulo é bit a
 * bit, direto da especificação; a daqui é pré-calculada por tabela. Duas
 * derivações independentes que concordam é evidência; uma sozinha é só uma
 * afirmação. É a mesma lógica da autovalidação de `corrigirPreSkip`, que só
 * reescreve a página quando o CRC dela confere com o do codificador.
 *
 * Rodar: `npm run test:audio`
 */

const mod = await import("../src/lib/whatsapp/audio.ts");
const {
  inspecionarAudio,
  mimeSemParametros,
  mimeParaUpload,
  analisarOgg,
  cabecalhoOpus,
  crcOgg,
  corrigirPreSkip,
  analisarMp4,
  retratoDoAudio,
} = mod;

/* ------------------------------------------------------------------ *
 * Arreio de teste
 * ------------------------------------------------------------------ */

let ok = 0;
const falhas = [];

function conferir(nome, real, esperado) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a === b) ok++;
  else falhas.push(`${nome}\n      esperado: ${b}\n      obtido:   ${a}`);
}

function verdade(nome, cond, detalhe = "") {
  if (cond) ok++;
  else falhas.push(`${nome}${detalhe ? `\n      ${detalhe}` : ""}`);
}

/* ------------------------------------------------------------------ *
 * CRC-32 do Ogg — segunda implementação, por tabela
 *
 * Polinômio 0x04C11DB7, início 0, SEM reflexão de entrada/saída, sem xor final.
 * A ausência de reflexão é o que diferencia o CRC do Ogg do CRC-32 comum (zip,
 * PNG) e é exatamente o erro que uma tabela copiada de outro lugar esconderia.
 * ------------------------------------------------------------------ */

const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? ((c << 1) ^ 0x04c11db7) >>> 0 : (c << 1) >>> 0;
    t[n] = c >>> 0;
  }
  return t;
})();

function crcPorTabela(bytes) {
  let crc = 0;
  for (const b of bytes) crc = ((crc << 8) ^ TABELA[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  return crc >>> 0;
}

/* ------------------------------------------------------------------ *
 * Construtor de fluxo Ogg/Opus sintético
 *
 * Monta página por página, com tabela de segmentos e CRC de verdade — é o que
 * permite testar `analisarOgg` e `corrigirPreSkip` sem depender de um arquivo
 * binário comitado no repositório (que ninguém saberia regerar).
 * ------------------------------------------------------------------ */

const BOS = 0x02;
const EOS = 0x04;

function pagina({ carga, flags = 0, granule = 0, seq = 0, serial = 0x4c495441 }) {
  // Tabela de segmentos: 255 para cada bloco cheio, o resto no último.
  const segs = [];
  let restante = carga.length;
  while (restante >= 255) {
    segs.push(255);
    restante -= 255;
  }
  segs.push(restante);

  const cab = new Uint8Array(27 + segs.length);
  cab.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  cab[4] = 0; // versão
  cab[5] = flags;
  // granule: 64 bits little-endian (dois inteiros de 32 — em 48 kHz nem áudio de
  // horas passa de 2^53, então não precisa de BigInt)
  const baixo = granule >>> 0;
  const alto = Math.floor(granule / 0x100000000) >>> 0;
  for (let i = 0; i < 4; i++) cab[6 + i] = (baixo >>> (8 * i)) & 0xff;
  for (let i = 0; i < 4; i++) cab[10 + i] = (alto >>> (8 * i)) & 0xff;
  for (let i = 0; i < 4; i++) cab[14 + i] = (serial >>> (8 * i)) & 0xff;
  for (let i = 0; i < 4; i++) cab[18 + i] = (seq >>> (8 * i)) & 0xff;
  // 22..25 = CRC, fica zero durante o cálculo
  cab[26] = segs.length;
  cab.set(segs, 27);

  const pag = new Uint8Array(cab.length + carga.length);
  pag.set(cab, 0);
  pag.set(carga, cab.length);

  const crc = crcPorTabela(pag); // tabela de segmentos e carga incluídas
  for (let i = 0; i < 4; i++) pag[22 + i] = (crc >>> (8 * i)) & 0xff;
  return pag;
}

function opusHead({ canais = 1, preSkip = 312, taxa = 48000, ganho = 0, map = 0 } = {}) {
  const c = new Uint8Array(19);
  c.set([..."OpusHead"].map((x) => x.charCodeAt(0)), 0);
  c[8] = 1; // versão
  c[9] = canais;
  c[10] = preSkip & 0xff;
  c[11] = (preSkip >> 8) & 0xff;
  for (let i = 0; i < 4; i++) c[12 + i] = (taxa >>> (8 * i)) & 0xff;
  c[16] = ganho & 0xff;
  c[17] = (ganho >> 8) & 0xff;
  c[18] = map;
  return c;
}

function opusTags() {
  const vendor = [..."lito-test"].map((x) => x.charCodeAt(0));
  const c = new Uint8Array(8 + 4 + vendor.length + 4);
  c.set([..."OpusTags"].map((x) => x.charCodeAt(0)), 0);
  c[8] = vendor.length; // tamanho do vendor (little-endian, cabe em 1 byte)
  c.set(vendor, 12);
  return c; // 0 comentários
}

function juntar(...partes) {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    out.set(p, i);
    i += p.length;
  }
  return out.buffer;
}

/** Fluxo Ogg/Opus completo e válido. */
function fluxoCompleto({ canais = 1, preSkip = 312, paginasDeAudio = 3 } = {}) {
  const partes = [
    pagina({ carga: opusHead({ canais, preSkip }), flags: BOS, seq: 0 }),
    pagina({ carga: opusTags(), seq: 1 }),
  ];
  for (let k = 0; k < paginasDeAudio; k++) {
    const ultima = k === paginasDeAudio - 1;
    partes.push(
      pagina({
        carga: new Uint8Array(80).fill(0x7c),
        flags: ultima ? EOS : 0,
        granule: 960 * 51 * (k + 1),
        seq: 2 + k,
      }),
    );
  }
  return juntar(...partes);
}

/* ================================================================== *
 * 1. CRC — as duas implementações precisam concordar
 * ================================================================== */

console.log("\n  CRC-32 do Ogg (bit a bit x tabela)");

{
  // Vetor da própria especificação do Ogg.
  const s = new Uint8Array([..."123456789"].map((c) => c.charCodeAt(0)));
  const porTabela = crcPorTabela(s);
  conferir("crc('123456789') pela tabela = 0x89a1897f", porTabela.toString(16), "89a1897f");

  // `crcOgg` zera os bytes 22..25 da JANELA, então para comparar com a tabela o
  // vetor precisa ser maior que 26 bytes e ter zeros ali — é o que uma página
  // real tem durante o cálculo.
  const p = fluxoCompleto();
  const b = new Uint8Array(p);
  const semCrc = b.slice(0, 60);
  semCrc.fill(0, 22, 26);
  conferir(
    "crcOgg == crcPorTabela na primeira página",
    crcOgg(b, 0, 60).toString(16),
    crcPorTabela(semCrc).toString(16),
  );
}

/* ================================================================== *
 * 2. Análise do fluxo Ogg
 * ================================================================== */

console.log("  analisarOgg — o que a RFC 7845 exige e o cabeçalho não prova");

{
  const a = analisarOgg(fluxoCompleto());
  conferir("fluxo completo: sem problemas", a.problemas, []);
  conferir("fluxo completo: 5 páginas", a.paginas, 5);
  conferir("fluxo completo: 3 de áudio", a.paginasDeAudio, 3);
  verdade("fluxo completo: OpusHead", a.temOpusHead);
  verdade("fluxo completo: OpusTags", a.temOpusTags);
  verdade("fluxo completo: EOS", a.temEos);
  conferir("fluxo completo: sem sobra", a.sobra, 0);
}

{
  // Sem OpusTags — é o que alguns codificadores de navegador omitem, e é
  // obrigatória pela RFC. Toca no navegador; demuxer estrito recusa.
  const b = juntar(
    pagina({ carga: opusHead(), flags: BOS, seq: 0 }),
    pagina({ carga: new Uint8Array(80).fill(0x7c), flags: EOS, granule: 48960, seq: 1 }),
  );
  const a = analisarOgg(b);
  verdade("sem OpusTags: temOpusTags = false", a.temOpusTags === false);
  verdade("sem OpusTags: acusa problema", a.problemas.length > 0, `problemas: ${a.problemas}`);
}

{
  // Sem EOS: fluxo não fechado. O navegador toca; parser estrito não confia.
  const partes = [
    pagina({ carga: opusHead(), flags: BOS, seq: 0 }),
    pagina({ carga: opusTags(), seq: 1 }),
    pagina({ carga: new Uint8Array(80).fill(0x7c), granule: 48960, seq: 2 }),
  ];
  const a = analisarOgg(juntar(...partes));
  verdade("sem EOS: temEos = false", a.temEos === false);
  verdade("sem EOS: acusa problema", a.problemas.length > 0, `problemas: ${a.problemas}`);
}

{
  // Só cabeçalhos, nenhuma página de áudio.
  const a = analisarOgg(
    juntar(pagina({ carga: opusHead(), flags: BOS, seq: 0 }), pagina({ carga: opusTags(), seq: 1 })),
  );
  conferir("só cabeçalhos: 0 páginas de áudio", a.paginasDeAudio, 0);
  verdade("só cabeçalhos: acusa problema", a.problemas.length > 0);
}

{
  // Truncado: bytes fora de página. É o sintoma de gravação interrompida.
  const inteiro = new Uint8Array(fluxoCompleto());
  const cortado = inteiro.slice(0, inteiro.length - 30);
  const a = analisarOgg(cortado.buffer);
  verdade("truncado: acusa problema", a.problemas.length > 0, `problemas: ${a.problemas}`);
}

/* ================================================================== *
 * 3. Cabeçalho OpusHead
 * ================================================================== */

console.log("  cabecalhoOpus — canais e pre-skip");

{
  const h = cabecalhoOpus(fluxoCompleto({ canais: 1, preSkip: 312 }));
  conferir("mono, preskip 312: canais", h.canais, 1);
  conferir("mono, preskip 312: preSkip", h.preSkip, 312);
  conferir("mono, preskip 312: taxa de entrada", h.taxaEntrada, 48000);
  // `channelMappingFamily` != 0 exige tabela de mapeamento e faz decodificador
  // estrito recusar — era um dos candidatos da investigação.
  conferir("mono, preskip 312: mapa de canais", h.channelMappingFamily, 0);
}

{
  // Estéreo é o que o `opus-media-recorder` produzia quando o microfone
  // reportava 2 canais — a Cloud API aceita Ogg/Opus só em mono.
  const h = cabecalhoOpus(fluxoCompleto({ canais: 2 }));
  conferir("estéreo: canais = 2", h.canais, 2);
}

{
  // ⚠️ Ausência de OpusHead tem que ser DISTINGUÍVEL de mono. Ler `null` como
  // "está mono" foi um furo real da primeira versão da checagem: um WebM ou WAV
  // (que é o que sai quando o codificador Opus não carrega) passava calado.
  const h = cabecalhoOpus(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]).buffer);
  conferir("sem OpusHead: canais = null (≠ 1)", h.canais, null);
  conferir("sem OpusHead: preSkip = null", h.preSkip, null);
}

/* ================================================================== *
 * 4. Correção do pre-skip — a causa provada da recusa
 * ================================================================== */

console.log("  corrigirPreSkip — e o CRC refeito");

{
  const antes = fluxoCompleto({ preSkip: 0 });
  const r = corrigirPreSkip(antes);
  verdade("preskip=0: corrigiu", r.corrigido === true, r.nota);
  conferir("preskip=0: virou 312", cabecalhoOpus(r.bytes).preSkip, 312);
  conferir("preskip=0: tamanho intacto", r.bytes.byteLength, antes.byteLength);

  // ⚠️ O ponto crítico: mudar a carga sem refazer o CRC trocaria um arquivo que
  // o navegador aceita por um que NADA aceita. Confere pela tabela.
  const b = new Uint8Array(r.bytes);
  let paginas = 0;
  let batem = 0;
  let i = 0;
  while (i + 27 <= b.length && b[i] === 0x4f && b[i + 1] === 0x67) {
    const nSeg = b[i + 26];
    let carga = 0;
    for (let k = 0; k < nSeg; k++) carga += b[i + 27 + k];
    const fim = i + 27 + nSeg + carga;
    if (fim > b.length) break;
    const gravado =
      (b[i + 22] | (b[i + 23] << 8) | (b[i + 24] << 16) | b[i + 25] * 0x1000000) >>> 0;
    const janela = b.slice(i, fim);
    janela.fill(0, 22, 26);
    paginas++;
    if (crcPorTabela(janela) === gravado) batem++;
    i = fim;
  }
  conferir("preskip corrigido: CRC de TODAS as páginas confere", `${batem}/${paginas}`, "5/5");
  // A análise do fluxo tem que continuar limpa depois da reescrita.
  conferir("preskip corrigido: fluxo segue válido", analisarOgg(r.bytes).problemas, []);
}

{
  const r = corrigirPreSkip(fluxoCompleto({ preSkip: 312 }));
  verdade("preskip já correto: não mexe", r.corrigido === false, r.nota);
}

{
  // CRC corrompido → RECUSA mexer. É a autovalidação: se `crcOgg` divergisse do
  // codificador, reescrever produziria arquivo pior do que o atual.
  const b = new Uint8Array(fluxoCompleto({ preSkip: 0 }));
  b[23] ^= 0xff;
  const r = corrigirPreSkip(b.buffer);
  verdade("CRC corrompido: RECUSA corrigir", r.corrigido === false, r.nota);
  verdade("CRC corrompido: diz o motivo", /crc/i.test(r.nota), r.nota);
}

{
  const r = corrigirPreSkip(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]).buffer);
  verdade("sem OpusHead: não mexe", r.corrigido === false, r.nota);
}

/* ================================================================== *
 * 5. Inspeção — contêiner pelos BYTES, não pelo mime declarado
 * ================================================================== */

console.log("  inspecionarAudio — contêiner pelos bytes de assinatura");

const ftyp = (marca) => {
  const c = new Uint8Array(64);
  c.set([0, 0, 0, 0x20], 0);
  c.set([..."ftyp"].map((x) => x.charCodeAt(0)), 4);
  c.set([...marca].map((x) => x.charCodeAt(0)), 8);
  return c.buffer;
};

{
  const i = inspecionarAudio(fluxoCompleto());
  conferir("ogg válido: contêiner", i.container, "ogg");
  conferir("ogg válido: canais", i.canais, 1);
  verdade("ogg válido: aceitável", i.aceitavel === true, i.motivo);
}

{
  const i = inspecionarAudio(fluxoCompleto({ canais: 2 }));
  verdade("ogg estéreo: REPROVA", i.aceitavel === false);
  verdade("ogg estéreo: motivo nomeia canais", /canal|mono|estéreo|estereo/i.test(i.motivo), i.motivo);
}

{
  // MP4/AAC é o formato de primeira classe da Cloud API — e a saída adotada.
  const i = inspecionarAudio(ftyp("M4A "));
  conferir("mp4: contêiner", i.container, "mp4");
  verdade("mp4: aceitável", i.aceitavel === true, i.motivo);
}

{
  // WebM é o que sai quando o codificador Opus não carrega. A Cloud API não
  // aceita, então reprovar aqui poupa a viagem e dá motivo específico.
  const webm = new Uint8Array(64);
  webm.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  const i = inspecionarAudio(webm.buffer);
  conferir("webm: contêiner", i.container, "webm");
  verdade("webm: REPROVA", i.aceitavel === false);
}

{
  const wav = new Uint8Array(64);
  wav.set([..."RIFF"].map((x) => x.charCodeAt(0)), 0);
  wav.set([..."WAVE"].map((x) => x.charCodeAt(0)), 8);
  const i = inspecionarAudio(wav.buffer);
  conferir("wav: contêiner", i.container, "wav");
  verdade("wav: REPROVA (Cloud API não aceita)", i.aceitavel === false);
}

{
  const i = inspecionarAudio(new ArrayBuffer(0));
  verdade("vazio: REPROVA", i.aceitavel === false);
  conferir("vazio: bytes = 0", i.bytes, 0);
}

{
  // ⚠️ Ogg SEM OpusHead: cabeçalho de página válido, carga que não é Opus. Não
  // pode ser confundido com mono — foi o furo que fez "sem aviso" ser lido como
  // "está mono" durante rodadas de investigação.
  const b = juntar(pagina({ carga: new Uint8Array(40).fill(0x33), flags: BOS | EOS, seq: 0 }));
  const i = inspecionarAudio(b);
  conferir("ogg sem OpusHead: contêiner", i.container, "ogg");
  conferir("ogg sem OpusHead: canais = null", i.canais, null);
  verdade("ogg sem OpusHead: REPROVA", i.aceitavel === false, i.motivo);
}

/* ================================================================== *
 * 6. Mime declarado à Meta
 * ================================================================== */

console.log("  mimeParaUpload — nunca declarar o que os bytes não são");

conferir("tira o parâmetro", mimeSemParametros("audio/ogg; codecs=opus"), "audio/ogg");
conferir("tira sem espaço", mimeSemParametros("audio/ogg;codecs=opus"), "audio/ogg");
conferir("normaliza caixa", mimeSemParametros("AUDIO/OGG"), "audio/ogg");

{
  const ogg = fluxoCompleto();
  // O valor que a Meta reclamou por três rodadas: a lista de tipos aceitos dela
  // tem `audio/ogg`, SEM parâmetro.
  conferir(
    "ogg + 'audio/ogg; codecs=opus' → audio/ogg",
    mimeParaUpload(ogg, "audio/ogg; codecs=opus", true),
    "audio/ogg",
  );
  // ⚠️ O furo que o teste pegou na primeira versão: um OGG legítimo cujo mime se
  // perdeu no caminho era enviado COMO octet-stream — a divergência exata que a
  // Meta recusa.
  conferir(
    "ogg + octet-stream → audio/ogg (fareja pelos bytes)",
    mimeParaUpload(ogg, "application/octet-stream", true),
    "audio/ogg",
  );
  conferir("ogg + mime vazio → audio/ogg", mimeParaUpload(ogg, "", true), "audio/ogg");
  conferir(
    "ogg + mime errado, ehAudio → manda o do CONTEÚDO",
    mimeParaUpload(ogg, "audio/mpeg", true),
    "audio/ogg",
  );
}

{
  conferir(
    "mp4 + 'audio/mp4;codecs=mp4a.40.2' → audio/mp4",
    mimeParaUpload(ftyp("M4A "), "audio/mp4;codecs=mp4a.40.2", true),
    "audio/mp4",
  );
}

{
  // Assinatura NÃO conclusiva não vira palpite: um chute nosso por cima de um
  // mime declarado correto trocaria um erro por outro.
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]).buffer;
  conferir(
    "pdf: mantém o declarado (sem parâmetro)",
    mimeParaUpload(pdf, "application/pdf", false),
    "application/pdf",
  );
  conferir(
    "desconhecido + audio/*: mantém o declarado limpo",
    mimeParaUpload(pdf, "audio/ogg; codecs=opus", true),
    "audio/ogg",
  );
}

/* ================================================================== *
 * 7. MP4 — a estrutura que o diagnóstico não conferia
 *
 * ⚠️ O retrato de um MP4 REAL (o que a Meta recusou) saía assim:
 *   head[v=null ch=null preskip=null ...] ogg[pag=0 tags=false ...]
 *   problemas[bytes fora de página; primeira página não é OpusHead; falta
 *             OpusTags; nenhuma página de áudio; última página sem EOS]
 * Cinco "problemas" que diziam apenas "isto não é um Ogg". O diagnóstico
 * acusava um arquivo saudável e mandou a investigação para o lado errado.
 * ================================================================== */

console.log("  analisarMp4 — moov, mdat e faststart");

/** Caixa MP4: 4 bytes de tamanho (big-endian) + 4 do tipo + carga. */
function caixa(tipo, carga = new Uint8Array(0)) {
  const total = 8 + carga.length;
  const c = new Uint8Array(total);
  c[0] = (total >>> 24) & 0xff;
  c[1] = (total >>> 16) & 0xff;
  c[2] = (total >>> 8) & 0xff;
  c[3] = total & 0xff;
  c.set([...tipo].map((x) => x.charCodeAt(0)), 4);
  c.set(carga, 8);
  return c;
}

const FTYP = caixa("ftyp", new Uint8Array([..."M4A mp42isom"].map((x) => x.charCodeAt(0))));

{
  // MP4 saudável, com faststart: moov ANTES do mdat.
  const b = juntar(FTYP, caixa("moov", new Uint8Array(40)), caixa("mdat", new Uint8Array(200)));
  const a = analisarMp4(b);
  conferir("mp4 saudável: marca", a.marca, "M4A");
  conferir("mp4 saudável: caixas", a.caixas, ["ftyp", "moov", "mdat"]);
  verdade("mp4 saudável: tem moov", a.temMoov);
  verdade("mp4 saudável: tem mdat", a.temMdat);
  verdade("mp4 saudável: faststart", a.moovNaFrente);
  conferir("mp4 saudável: sem problemas", a.problemas, []);
  conferir("mp4 saudável: sem sobra", a.sobra, 0);
}

{
  /*
   * ⚠️ moov DEPOIS do mdat. É o que sai de quem grava em FLUXO (o índice só fica
   * pronto no fim) e é a hipótese que casa com a queixa da Meta: quem processa
   * lendo o começo do arquivo não acha o índice e cai em octet-stream. É o que o
   * `-movflags +faststart` do ffmpeg conserta.
   */
  const b = juntar(FTYP, caixa("mdat", new Uint8Array(200)), caixa("moov", new Uint8Array(40)));
  const a = analisarMp4(b);
  verdade("moov no fim: tem as duas caixas", a.temMoov && a.temMdat);
  verdade("moov no fim: faststart = false", a.moovNaFrente === false);
  verdade(
    "moov no fim: acusa a falta de faststart",
    a.problemas.some((p) => /faststart/.test(p)),
    `problemas: ${a.problemas}`,
  );
}

{
  // SEM moov: nenhum demuxer identifica o arquivo. É o pior caso.
  const b = juntar(FTYP, caixa("mdat", new Uint8Array(200)));
  const a = analisarMp4(b);
  verdade("sem moov: acusa", a.problemas.some((p) => /moov/.test(p)), `${a.problemas}`);
}

{
  // Fragmentado (fMP4) — o que o MediaRecorder do navegador emite.
  const b = juntar(
    FTYP,
    caixa("moov", new Uint8Array(40)),
    caixa("moof", new Uint8Array(30)),
    caixa("mdat", new Uint8Array(200)),
  );
  const a = analisarMp4(b);
  verdade("fMP4: marcado como fragmentado", a.fragmentado === true);
  verdade("fMP4: tem moov", a.temMoov);
}

{
  // Truncado: bytes fora de qualquer caixa.
  const inteiro = new Uint8Array(
    juntar(FTYP, caixa("moov", new Uint8Array(40)), caixa("mdat", new Uint8Array(200))),
  );
  const a = analisarMp4(inteiro.slice(0, inteiro.length - 50).buffer);
  verdade("mp4 truncado: acusa sobra", a.sobra > 0 || a.problemas.length > 0, `${a.problemas}`);
}

/* ================================================================== *
 * 8. O retrato segue o CONTÊINER — a regressão escrita como teste
 * ================================================================== */

console.log("  retratoDoAudio — análise do contêiner certo");

{
  const mp4 = juntar(FTYP, caixa("moov", new Uint8Array(40)), caixa("mdat", new Uint8Array(200)));
  const r = retratoDoAudio(mp4);
  verdade("mp4: retrato diz fmt=mp4", /fmt=mp4/.test(r), r);
  verdade("mp4: retrato traz o bloco mp4[...]", /mp4\[/.test(r), r);
  // ⚠️ A regressão: um MP4 saudável NÃO pode sair com problemas de Ogg.
  verdade("mp4: NÃO fala de OpusHead", !/OpusHead/.test(r), r);
  verdade("mp4: NÃO fala de OpusTags", !/OpusTags/.test(r), r);
  verdade("mp4: NÃO traz bloco ogg[...]", !/ogg\[/.test(r), r);
  verdade("mp4: sem lista de problemas", !/problemas\[/.test(r), r);
}

{
  const r = retratoDoAudio(fluxoCompleto());
  verdade("ogg: retrato traz head[...] e ogg[...]", /head\[/.test(r) && /ogg\[/.test(r), r);
  verdade("ogg válido: sem lista de problemas", !/problemas\[/.test(r), r);
}

/* ------------------------------------------------------------------ *
 * Resultado
 * ------------------------------------------------------------------ */

console.log("");
if (falhas.length) {
  for (const f of falhas) console.error(`  ✗ ${f}`);
  console.error(`\n  ${ok} passaram, ${falhas.length} FALHARAM\n`);
  process.exit(1);
}
console.log(`  ✓ ${ok} asserções passaram\n`);
