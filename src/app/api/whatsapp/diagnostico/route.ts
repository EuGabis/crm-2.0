import { createClient } from "@/lib/supabase/server";
import { numberDiagnostics, wabaDiagnostics, graphVersion } from "@/lib/whatsapp/client";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

/**
 * O que a META diz sobre o nosso número — o último eixo que a investigação do
 * áudio recusado nunca mediu.
 *
 * ⚠️ **Por que esta rota existe.** Doze rodadas provaram, cada uma medindo em vez
 * de deduzir, que:
 *   - o arquivo é válido byte a byte, em DOIS formatos independentes (Ogg/Opus
 *     mono com pre-skip 312, OpusTags, EOS, CRC de todas as páginas; e MP4/AAC);
 *   - a nossa transmissão está intacta (round-trip com hash IDÊNTICO ao que
 *     subimos, e a Meta tipando a mídia guardada como `audio/mp4`);
 *   - o caminho de transmissão não importa (falha igual por upload e por link);
 *   - IMAGEM vai pelo MESMO canal, com a MESMA rota e o mesmo par upload+send;
 *   - a Graph API está em v25.0.
 *
 * Ou seja: tudo que é nosso está exonerado por medida, não por argumento. O que
 * sobrou por perguntar é o ESTADO DA CONTA — e sobrou justamente porque a
 * resposta mora no painel da Meta, onde eu não alcanço e onde ninguém sabe qual
 * campo olhar. Esta rota pergunta à API dela.
 *
 * ⚠️ **`platform_type` é o campo que interessa mais**, e é o que `getNumberInfo`
 * nunca pediu. Ele revela se o número está em **coexistência** — o modo novo em
 * que o mesmo número funciona no aplicativo WhatsApp Business E na Cloud API. É a
 * hipótese que casa com a única evidência que nunca teve explicação: "pelo
 * celular o áudio é enviado normalmente". Um número 100% migrado para a Cloud API
 * NÃO funciona no aplicativo; se ele funciona nos dois, está em coexistência, e
 * aí as limitações são da conta, não do arquivo.
 *
 * Admin-only: o estado da conta não é segredo, mas também não é assunto de todo
 * atendente. O token NUNCA é devolvido.
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
  if (membership.role !== "admin") {
    return Response.json({ error: "apenas administradores" }, { status: 403 });
  }

  const url = new URL(request.url);
  const filtro = url.searchParams.get("channelId");

  // A sessão lê os canais: a RLS de `whatsapp_channels` já é do padrão membership,
  // então não há motivo para service role aqui.
  let q = supabase
    .from("whatsapp_channels")
    .select("id, name, phone_number_id, waba_id, active")
    .eq("location_id", membership.location_id);
  if (filtro) q = q.eq("id", filtro);
  const { data: canais } = await q;

  if (!canais?.length) {
    return Response.json({ graph: graphVersion(), canais: [], aviso: "nenhum canal cadastrado" });
  }

  /*
   * ⚠️ Best-effort POR CANAL e por bloco. Uma conta com problema é exatamente a
   * que faz a chamada falhar — se um erro derrubasse a resposta inteira, a rota
   * ficaria muda justamente no caso que ela existe para diagnosticar. O erro é
   * DADO aqui, não exceção.
   */
  const resultado = await Promise.all(
    (canais ?? []).map(async (c: any) => {
      const [numero, waba] = await Promise.all([
        numberDiagnostics(c.phone_number_id).catch((e: Error) => ({ erro: e.message })),
        c.waba_id
          ? wabaDiagnostics(c.waba_id).catch((e: Error) => ({ erro: e.message }))
          : Promise.resolve({ erro: "canal sem waba_id cadastrado" }),
      ]);
      return {
        canal: { id: c.id, nome: c.name, phoneNumberId: c.phone_number_id, ativo: c.active },
        numero,
        waba,
        /*
         * Leitura pronta, para não obrigar quem abre a rota a saber o vocabulário
         * da Meta. `platform_type` ausente é informação: a conta não expõe o
         * campo, o que já é diferente de expor "CLOUD_API".
         */
        leitura: leitura(numero, waba),
      };
    }),
  );

  return Response.json({ graph: graphVersion(), canais: resultado });
}

/** Traduz os campos da Meta no que eles significam para o caso do áudio. */
function leitura(numero: any, waba: any): string[] {
  const notas: string[] = [];
  if (numero?.erro) notas.push(`⚠️ não deu para consultar o número: ${numero.erro}`);
  if (waba?.erro) notas.push(`⚠️ não deu para consultar a WABA: ${waba.erro}`);

  const plataforma = numero?.platform_type;
  if (plataforma === "CLOUD_API") {
    notas.push(
      "Número 100% na Cloud API. Nesse modo ele NÃO funciona no aplicativo WhatsApp — " +
        "se alguém envia áudio 'pelo celular' com este mesmo número, é por outro caminho.",
    );
  } else if (ehCoexistencia(plataforma)) {
    notas.push(
      `⚠️ platform_type = ${plataforma}. Indica COEXISTÊNCIA (o número serve o aplicativo ` +
        "E a API ao mesmo tempo). É a hipótese que explica 'pelo celular o áudio vai' — e " +
        "nesse modo a Cloud API tem limitações de tipo de mídia que não vêm do nosso arquivo.",
    );
  } else if (plataforma) {
    notas.push(`platform_type = ${plataforma}`);
  } else {
    notas.push("A conta não devolveu platform_type — a própria ausência é dado.");
  }

  if (numero?.status && numero.status !== "CONNECTED") {
    notas.push(`⚠️ status do número = ${numero.status} (esperado CONNECTED)`);
  }
  if (numero?.quality_rating && numero.quality_rating !== "GREEN") {
    notas.push(`Qualidade = ${numero.quality_rating} — não bloqueia mídia, mas vale saber.`);
  }
  if (numero?.code_verification_status && numero.code_verification_status !== "VERIFIED") {
    notas.push(`⚠️ verificação do número = ${numero.code_verification_status}`);
  }
  if (waba?.account_review_status && waba.account_review_status !== "APPROVED") {
    notas.push(`⚠️ revisão da WABA = ${waba.account_review_status}`);
  }
  if (
    waba?.business_verification_status &&
    waba.business_verification_status !== "verified"
  ) {
    notas.push(`⚠️ verificação do negócio = ${waba.business_verification_status}`);
  }
  return notas;
}

/**
 * Coexistência aparece com nomes diferentes conforme a fase de migração da conta.
 * Casar por SUBSTRING e não por lista fechada: um valor novo da Meta deve ser
 * sinalizado, não ignorado em silêncio — que é o oposto do que custou rodadas
 * nesta investigação.
 */
function ehCoexistencia(p: unknown): boolean {
  if (typeof p !== "string") return false;
  const s = p.toUpperCase();
  return s.includes("COEXIST") || s.includes("ON_PREMISE") || s.includes("SMB");
}
