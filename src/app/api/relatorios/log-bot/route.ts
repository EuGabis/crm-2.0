import { createClient } from "@/lib/supabase/server";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

/**
 * Log do bot: uma linha por lead, com quem recebeu, quando e POR QUAL CAMINHO.
 *
 * ⚠️ **A rota devolve as LINHAS e não os totais**, como a de Atendimento (0079).
 * Quem agrupa por atendente e por hora é o navegador — é o que torna o recorte
 * imediato, e o volume aqui é pequeno por construção (uma janela de dias sobre
 * as conversas de números com setor). O dia em que isso virar dezenas de
 * milhares é o dia de agregar no servidor.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "não autenticado" }, { status: 401 });

  const { data: membership } = await supabase
    .from("location_members")
    .select("location_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return Response.json({ error: "empresa não encontrada" }, { status: 400 });
  /*
   * ⚠️ Admin-only, e a checagem que VALE é esta (servidor): `log_do_bot` é
   * `security definer`, então esconder a aba na tela não seria proteção. O log
   * mostra nome e telefone de todo lead do dia, inclusive de outros setores.
   */
  if (membership.role !== "admin") {
    return Response.json({ error: "apenas administradores" }, { status: 403 });
  }

  const dias = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("dias")) || 1));

  /*
   * 🔴 **PAGINA. O PostgREST corta em 1000 linhas SEM ERRO E SEM AVISO** — a
   * armadilha nº 7 deste projeto, a mesma que apagou o nome do contato em todas
   * as conversas depois da importação.
   *
   * Sem isto a tela mostrava "805 atribuídos de 1000" num dia com mais de mil
   * leads: o 1000 não era o total, era o teto. E um log de auditoria que erra o
   * total é pior que não existir, porque as porcentagens do rateio saem erradas
   * e alguém decide com base nelas.
   *
   * ⚠️ Teto de segurança em `MAX_PAGINAS`: a resposta vai inteira para o
   * navegador, e 30 dias no volume atual passariam de 30 mil linhas. Quando o
   * teto morde, a rota DIZ (`truncado`) em vez de devolver um número redondo
   * com cara de total.
   */
  const PAGINA = 1000;
  const MAX_PAGINAS = 10;
  const linhas: any[] = [];
  let truncado = false;
  for (let p = 0; ; p++) {
    if (p >= MAX_PAGINAS) {
      truncado = true;
      break;
    }
    const { data, error } = await supabase
      .rpc("log_do_bot", { p_location: membership.location_id, p_dias: dias })
      .range(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) return erroDoRpc(error);
    const veio = data?.length ?? 0;
    linhas.push(...(data ?? []));
    // ⚠️ `< PAGINA` e não `=== 0`: página incompleta já é a última, e pedir mais
    // uma seria uma ida e volta a mais em toda carga.
    if (veio < PAGINA) break;
  }

  return Response.json({ dias, linhas, truncado });
}

function erroDoRpc(error: { code?: string; message?: string }) {
  {
    /*
     * ⚠️ **O motivo VAI para a tela.** Um `error` engolido aqui já custou uma
     * rodada inteira na aba Agentes: a tela dizia "não foi possível carregar" e
     * o `code` do PostgREST — que apontava direto para `PGRST202` (função fora
     * do cache de esquema) ou `42501` (falta o grant) — era jogado fora.
     */
    console.error("[log-bot]", process.env.VERCEL_GIT_COMMIT_SHA ?? "local", error);
    return Response.json(
      { error: `Não foi possível carregar: ${error.code} · ${error.message}` },
      { status: 500 },
    );
  }
}
