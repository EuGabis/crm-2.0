import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Qual código está REALMENTE rodando em produção.
 *
 * ⚠️ **Nasceu de uma investigação que voltou cinco vezes ao mesmo ponto.** O
 * áudio recusado pela Meta (#131053) foi corrigido, mesclado na `main`, e o erro
 * continuou aparecendo com o texto ANTIGO. Sem saber qual commit estava no ar,
 * não havia como distinguir três coisas completamente diferentes:
 *
 *   1. a correção não funcionou;
 *   2. a correção não foi para produção (o `AGENTS.md` já documenta este risco:
 *      `vercel deploy` local, ou um "Promote to Production" de commit atrasado,
 *      sobrescrevem a produção com código velho);
 *   3. a falha lida na tela era ANTIGA — a recusa da Meta chega pelo webhook, de
 *      forma assíncrona, e fica gravada em `error_detail` até ser sobrescrita,
 *      então um balão aberto hoje mostra o motivo da tentativa de ontem.
 *
 * Deduzir entre as três custou rodadas. Um endereço que responde "estou rodando
 * o commit X" torna isso uma conferência de dois segundos.
 *
 * ⚠️ **Se este endereço responder 404, a resposta já é a própria resposta**: o
 * código no ar é anterior a esta rota.
 *
 * Exige sessão (está dentro do matcher do `proxy.ts`): commit e branch não são
 * segredo, mas também não precisam ficar abertos na internet.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "não autenticado" }, { status: 401 });

  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  return Response.json({
    commit: sha ? sha.slice(0, 7) : "local",
    commitCompleto: sha,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? "local",
    mensagem: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0] ?? null,
    ambiente: process.env.VERCEL_ENV ?? "local",
    /*
     * Marcadores de correções cuja ausência é difícil de perceber pela tela.
     * São literais: chegam `true` só se ESTE arquivo estiver no ar, o que é
     * justamente o que se quer saber. Ao consertar algo que gerou dúvida de
     * "isso subiu?", acrescente a linha aqui.
     */
    correcoes: {
      /** Mime enviado à Meta sem `; codecs=...`, limpo na fronteira (uploadMedia). */
      audioMimeSemParametro: true,
      /** `messages.error_detail` guarda `error_data.details` da Meta, não só o `title`. */
      motivoDetalhadoDaMeta: true,
      /** `media_mime` guarda o mime REALMENTE enviado — marcador de versão por mensagem. */
      mimeGravadoComoEnviado: true,
    },
  });
}
