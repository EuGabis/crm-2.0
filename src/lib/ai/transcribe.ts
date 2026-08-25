import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Transcrição dos áudios das conversas.
 *
 * SERVER-ONLY: usa `OPENAI_API_KEY` e a service role. Áudio no atendimento
 * obriga a parar e ouvir no ritmo de quem falou; virando texto, ele entra na
 * busca global do inbox (que procura no corpo das mensagens) e é lido de
 * relance.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const BUCKET = "conversation-media";
const URL_TRANSCRICAO = "https://api.openai.com/v1/audio/transcriptions";

/**
 * `whisper-1` é o padrão de propósito, mesmo havendo modelo mais novo e mais
 * barato (`gpt-4o-mini-transcribe`, cerca de metade do preço): ele existe em
 * toda conta da OpenAI desde 2023, e um nome de modelo que a conta não tem faz
 * TODA transcrição falhar. Na diferença de preço real deste volume (~75 min/mês)
 * a economia seria de centavos — não vale o risco de nascer quebrado.
 *
 * Para usar o mais novo, basta `OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe`
 * na Vercel; nada no código muda.
 */
export function transcribeModel(): string {
  return process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
}

/** O teto da API é 25 MB; acima disso a mensagem fica "ignorado", não "falhou". */
const LIMITE_BYTES = 25 * 1024 * 1024;

export interface ResultadoTranscricao {
  status: "ok" | "falhou" | "ignorado";
  texto?: string;
  erro?: string;
}

/**
 * Transcreve UM áudio e grava o resultado na própria mensagem.
 *
 * Devolve o resultado em vez de lançar: quem chama é um laço de fila (o tick) e
 * um áudio corrompido não pode derrubar os outros da rodada.
 */
export async function transcreverMensagem(messageId: string): Promise<ResultadoTranscricao> {
  const supabase = createAdminClient();

  const { data: msg, error } = await supabase
    .from("messages")
    .select("id, type, media_path, media_mime, media_size, conversation_id, created_at")
    .eq("id", messageId)
    .maybeSingle();

  if (error || !msg) return marcar(messageId, { status: "falhou", erro: "mensagem não encontrada" });
  if (msg.type !== "audio") return marcar(messageId, { status: "ignorado", erro: "não é áudio" });
  // Áudio sem arquivo existe: o composer grava a mensagem de forma otimista e o
  // upload pode ter falhado depois. Não é erro de transcrição — é nada para
  // transcrever, e tentar de novo a cada tick seria um laço infinito.
  if (!msg.media_path)
    return marcar(messageId, { status: "ignorado", erro: "áudio sem arquivo" });
  if ((msg.media_size ?? 0) > LIMITE_BYTES)
    return marcar(messageId, { status: "ignorado", erro: "áudio acima de 25 MB" });

  const { data: arquivo, error: erroDownload } = await supabase.storage
    .from(BUCKET)
    .download(msg.media_path);
  if (erroDownload || !arquivo)
    return marcar(messageId, {
      status: "falhou",
      erro: erroDownload?.message ?? "falha ao baixar o áudio",
    });

  const chave = process.env.OPENAI_API_KEY;
  if (!chave) return marcar(messageId, { status: "falhou", erro: "OPENAI_API_KEY ausente" });

  try {
    const form = new FormData();
    // O nome do arquivo IMPORTA: a API decide o formato pela extensão, e o
    // WhatsApp manda ogg/opus. Sem extensão ela recusa o arquivo.
    const nome = msg.media_path.split("/").pop() || "audio.ogg";
    form.append("file", arquivo, nome);
    form.append("model", transcribeModel());
    // Fixar o idioma melhora bastante o resultado em áudio curto e com ruído,
    // onde a detecção automática às vezes escolhe espanhol.
    form.append("language", "pt");

    const res = await fetch(URL_TRANSCRICAO, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}` },
      body: form,
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return marcar(messageId, {
        status: "falhou",
        erro: json?.error?.message || `OpenAI ${res.status}`,
      });
    }

    const texto = String(json?.text ?? "").trim();
    if (!texto) {
      // Áudio sem fala (toque, silêncio, ruído) não é falha — e retentar não
      // muda o resultado.
      return marcar(messageId, { status: "ignorado", erro: "nenhuma fala reconhecida" });
    }

    const resultado = await marcar(messageId, { status: "ok", texto });
    await atualizarPreview(msg.conversation_id, msg.created_at, texto);
    return resultado;
  } catch (e: any) {
    return marcar(messageId, { status: "falhou", erro: e?.message ?? "erro inesperado" });
  }
}

async function marcar(
  messageId: string,
  r: { status: "ok" | "falhou" | "ignorado"; texto?: string; erro?: string }
): Promise<ResultadoTranscricao> {
  const supabase = createAdminClient();
  await supabase
    .from("messages")
    .update({
      transcription: r.texto ?? null,
      transcription_status: r.status,
      transcription_error: r.erro ?? null,
    })
    .eq("id", messageId);
  return { status: r.status, texto: r.texto, erro: r.erro };
}

/**
 * A prévia da conversa mostra a transcrição quando o áudio é a última mensagem.
 *
 * A prévia é gravada em `conversations.last_message_preview` no momento do
 * envio, quando a transcrição ainda não existe — então ficava "Áudio" para
 * sempre. ⚠️ Só atualiza se NENHUMA mensagem mais nova chegou nesse meio tempo:
 * sobrescrever a prévia com um áudio antigo faria a lista mentir sobre qual foi
 * a última mensagem.
 */
async function atualizarPreview(
  conversationId: string,
  criadaEm: string,
  texto: string
): Promise<void> {
  const supabase = createAdminClient();
  const { count } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .gt("created_at", criadaEm);
  if ((count ?? 0) > 0) return;
  await supabase
    .from("conversations")
    .update({ last_message_preview: `🎤 ${texto.slice(0, 120)}` })
    .eq("id", conversationId);
}

/**
 * Processa a fila de áudios pendentes.
 *
 * ⚠️ Chamada pelo tick que JÁ existe (`/api/automations/tick`), como as
 * mensagens agendadas — de propósito, para não criar segundo cron, segundo
 * segredo nem passo manual novo em produção.
 *
 * O lote é pequeno porque cada áudio é uma chamada de rede de alguns segundos e
 * o tick roda a cada minuto: melhor esvaziar a fila em várias rodadas do que
 * estourar o tempo da rota e não gravar nada.
 */
export async function processarFilaDeTranscricao(
  limite = 5
): Promise<{ processados: number; ok: number; erros: number }> {
  const supabase = createAdminClient();
  const { data: pendentes } = await supabase
    .from("messages")
    .select("id")
    .eq("transcription_status", "pendente")
    // Mais novos primeiro: a conversa de agora é a que alguém está lendo. O
    // histórico antigo pode esperar as próximas rodadas.
    .order("created_at", { ascending: false })
    .limit(limite);

  let ok = 0;
  let erros = 0;
  for (const m of pendentes ?? []) {
    const r = await transcreverMensagem(m.id);
    if (r.status === "ok") ok++;
    else if (r.status === "falhou") erros++;
  }
  return { processados: (pendentes ?? []).length, ok, erros };
}
