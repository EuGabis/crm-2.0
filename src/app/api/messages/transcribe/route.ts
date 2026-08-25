import { createClient } from "@/lib/supabase/server";
import { transcreverMensagem } from "@/lib/ai/transcribe";

export const dynamic = "force-dynamic";

/**
 * Transcreve um áudio AGORA, a pedido de quem está lendo a conversa.
 *
 * A fila do tick já transcreve tudo sozinha (migração 0085) — esta rota existe
 * para os dois casos em que esperar o minuto seguinte é ruim: o áudio que
 * acabou de chegar e alguém quer ler já, e o que falhou e merece outra chance.
 *
 * ⚠️ A sessão do usuário AUTORIZA e a service role EXECUTA. O padrão é o do
 * `resolveGuruUserToken`: o `select` abaixo passa pela RLS de `messages`, então
 * quem não pode ver a conversa recebe 404 e nunca chega a gastar uma chamada de
 * transcrição. A escrita precisa da service role porque a policy de UPDATE em
 * `messages` é de admin (0040).
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "não autenticado" }, { status: 401 });

  const { messageId } = await req.json().catch(() => ({}) as { messageId?: string });
  if (!messageId) return Response.json({ error: "messageId ausente" }, { status: 400 });

  // Com a sessão do usuário: a RLS decide se ele enxerga esta mensagem.
  const { data: msg } = await supabase
    .from("messages")
    .select("id, type, transcription")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg) return Response.json({ error: "mensagem não encontrada" }, { status: 404 });
  if (msg.type !== "audio") {
    return Response.json({ error: "a mensagem não é um áudio" }, { status: 400 });
  }
  // Já transcrito: devolve o que existe em vez de pagar pela mesma transcrição
  // de novo (o botão fica visível e é clicável mais de uma vez).
  if (msg.transcription) {
    return Response.json({ status: "ok", texto: msg.transcription, cache: true });
  }

  const r = await transcreverMensagem(messageId);
  if (r.status === "falhou") {
    return Response.json({ error: r.erro ?? "falha na transcrição" }, { status: 502 });
  }
  return Response.json({ status: r.status, texto: r.texto ?? null, erro: r.erro ?? null });
}
