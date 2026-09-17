import { createClient } from "@/lib/supabase/server";
import { ehDiaValido, hojeSP, somaDias } from "@/lib/periodo";
import { paginarRpc } from "@/lib/supabase/paginar-rpc";

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

  const url = new URL(request.url);
  const dias = Math.min(90, Math.max(1, Number(url.searchParams.get("dias")) || 1));
  /*
   * 🔴 **Período por DATA, não "últimas N horas".** `dias = 1` significava
   * `now() - 24h`: escolher "hoje" trazia desde ontem no mesmo horário, e foi
   * isso que fez o log mostrar 152/157 num dia de ~60 por pessoa (medido em
   * 17/09). Quem escolhe um dia quer o DIA.
   *
   * ⚠️ Data malformada NÃO cai no padrão em silêncio: um período diferente do
   * pedido é a tela mentindo sobre o próprio recorte, e quem lê os números não
   * tem como perceber.
   */
  const deQ = url.searchParams.get("de");
  const ateQ = url.searchParams.get("ate");
  if ((deQ || ateQ) && !(deQ && ateQ && ehDiaValido(deQ) && ehDiaValido(ateQ) && deQ <= ateQ)) {
    return Response.json({ error: "período inválido" }, { status: 400 });
  }
  const periodo = deQ && ateQ ? { de: deQ, ate: ateQ } : { de: somaDias(hojeSP(), -(dias - 1)), ate: hojeSP() };

  /*
   * 🔴 **PAGINA.** O PostgREST corta em 1000 linhas SEM ERRO E SEM AVISO — a
   * armadilha nº 7 deste projeto. Sem isto a tela mostrava "805 atribuídos de
   * 1000" num dia com mais de mil leads: o 1000 não era o total, era o teto. E
   * um log de auditoria que erra o total é pior que não existir, porque as
   * porcentagens do rateio saem erradas.
   *
   * ⚠️ A ordem termina em `conversation_id` (uuid único). A função ordena por
   * `atribuida_em`/`chegou_em`, e carimbo de tempo empata: o bot e a varredura
   * da fila gravam em rajada, e duas páginas sem desempate repetiriam uma linha
   * e PULARIAM outra.
   */
  const { data: linhas, truncado, error } = await paginarRpc(
    supabase,
    "log_do_bot",
    { p_location: membership.location_id, p_dias: dias, p_de: periodo.de, p_ate: periodo.ate },
    [
      { coluna: "atribuida_em", desc: true },
      { coluna: "chegou_em", desc: true },
      { coluna: "conversation_id" },
    ]
  );
  if (error) return erroDoRpc(error);

  return Response.json({ dias, periodo, linhas, truncado });
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
