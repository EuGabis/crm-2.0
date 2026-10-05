import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendText } from "@/lib/whatsapp/client";
import { toWhatsAppNumber } from "@/lib/whatsapp/phone";
import { MARCA_REENVIO, planoDeReenvio, type MsgDaConversa, type MotivoPulo } from "@/lib/whatsapp/reenvio-bot";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Orçamento por rodada: a rota tem 60 s; o resto fica para a próxima. */
const ORCAMENTO_MS = 40_000;

/**
 * Reenvio das mensagens do FLUXO AUTOMÁTICO (bot) que falharam.
 *   GET  → prévia (nada é enviado)
 *   POST → envia, em série, conversa por conversa
 * Admin-only. Regras em `lib/whatsapp/reenvio-bot.ts`.
 *
 * ⚠️ A sessão AUTORIZA e a service role EXECUTA: atualizar `messages` é
 * admin-only pela RLS (0040) e UPDATE recusado volta calado.
 */
async function autorizar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erro: Response.json({ error: "não autenticado" }, { status: 401 }) };
  const { data: membro } = await supabase
    .from("location_members")
    .select("location_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membro) return { erro: Response.json({ error: "empresa não encontrada" }, { status: 400 }) };
  if (membro.role !== "admin") {
    return { erro: Response.json({ error: "apenas administradores" }, { status: 403 }) };
  }
  return { location: membro.location_id as string };
}

async function montarPlano(db: any, location: string, horas: number) {
  const agora = Date.now();
  const desde = new Date(agora - horas * 3600_000).toISOString();

  const { data: falhas, error } = await db
    .from("messages")
    .select("conversation_id")
    .eq("location_id", location)
    .eq("direction", "out")
    .eq("status", "failed")
    .eq("automated", true)
    .gte("created_at", desde)
    .limit(5000);
  if (error) throw new Error(`falhas: ${error.message}`);
  const convIds: string[] = [...new Set<string>((falhas ?? []).map((f: any) => f.conversation_id as string))];

  // Fio de cada conversa (desde 26h antes do período: precisa da última entrada).
  const janelaDesde = new Date(agora - (horas + 26) * 3600_000).toISOString();
  const porConversa = new Map<string, MsgDaConversa[]>();
  /*
   * ⚠️ Lotes PEQUENOS e corte detectado. O PostgREST devolve no máximo 1000
   * linhas SEM AVISAR; com 100 conversas por lote, um fio podia vir sem a
   * resposta bem-sucedida de um atendente — e a regra reenviaria a pergunta
   * antiga numa conversa que já tinha seguido. Lote de 5 e, se mesmo assim
   * bater no teto, recusa o plano em vez de agir com o fio incompleto.
   */
  const LOTE = 5;
  for (let i = 0; i < convIds.length; i += LOTE) {
    const lote = convIds.slice(i, i + LOTE);
    const { data, error: e2 } = await db
      .from("messages")
      .select("id, conversation_id, direction, status, type, automated, internal, body, error_detail, created_at")
      .in("conversation_id", lote)
      .gte("created_at", janelaDesde)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (e2) throw new Error(`fio: ${e2.message}`);
    if ((data?.length ?? 0) >= 1000) {
      throw new Error("fio de conversa grande demais para conferir com segurança — reenvio não feito");
    }
    for (const m of data ?? []) {
      const arr = porConversa.get(m.conversation_id) ?? [];
      arr.push({ ...m, at: m.created_at });
      porConversa.set(m.conversation_id, arr);
    }
  }

  const { data: convs } = convIds.length
    ? await db
        .from("conversations")
        .select("id, channel_id, contact:contacts(first_name, last_name, phone)")
        .in("id", convIds)
    : { data: [] };
  const convPorId = new Map<string, any>((convs ?? []).map((c: any) => [c.id, c]));

  const pulos: Record<MotivoPulo, number> = {
    "janela fechada": 0,
    "conversa seguiu depois da falha": 0,
    "nada para reenviar": 0,
  };
  const itens: { conversa: string; canal: string | null; contato: string; telefone: string; mensagens: { id: string; body: string }[] }[] = [];
  for (const id of convIds) {
    const plano = planoDeReenvio(porConversa.get(id) ?? [], agora);
    if (plano.pulo) {
      pulos[plano.pulo] += 1;
      continue;
    }
    const c = convPorId.get(id);
    const ct = Array.isArray(c?.contact) ? c.contact[0] : c?.contact;
    itens.push({
      conversa: id,
      canal: c?.channel_id ?? null,
      contato: [ct?.first_name, ct?.last_name].filter(Boolean).join(" ") || "Contato",
      telefone: ct?.phone ?? "",
      mensagens: plano.reenviar,
    });
  }
  return { itens, pulos, conversasComFalha: convIds.length };
}

function horasDe(request: Request): number {
  const h = Number(new URL(request.url).searchParams.get("horas") ?? 24);
  return Number.isFinite(h) && h > 0 && h <= 48 ? h : 24;
}

export async function GET(request: Request) {
  const auth = await autorizar();
  if (auth.erro) return auth.erro;
  try {
    const plano = await montarPlano(createAdminClient(), auth.location, horasDe(request));
    return Response.json({
      conversas: plano.itens.length,
      mensagens: plano.itens.reduce((n, i) => n + i.mensagens.length, 0),
      conversasComFalha: plano.conversasComFalha,
      pulos: plano.pulos,
      amostra: plano.itens.slice(0, 50).map((i) => ({
        contato: i.contato,
        telefone: i.telefone,
        mensagens: i.mensagens.map((m) => m.body.slice(0, 120)),
      })),
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await autorizar();
  if (auth.erro) return auth.erro;
  const db = createAdminClient();
  const inicio = Date.now();
  let plano;
  try {
    plano = await montarPlano(db, auth.location, horasDe(request));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const { data: canais } = await db
    .from("whatsapp_channels")
    .select("id, phone_number_id, active")
    .eq("location_id", auth.location);
  const canalPorId = new Map<string, any>((canais ?? []).map((c: any) => [c.id, c]));

  let enviadas = 0, conversasFeitas = 0;
  const erros: string[] = [];
  /**
   * Marca a mensagem como "reenvio já tentado". ⚠️ Sem a marca, a recusa
   * permanente era retentada a cada rodada — o "reenviando infinito".
   */
  const marcar = (ids: string[], motivo: string) =>
    db
      .from("messages")
      .update({ error_detail: `${MARCA_REENVIO}: ${motivo}`.slice(0, 500) })
      .in("id", ids);

  for (const item of plano.itens) {
    if (Date.now() - inicio > ORCAMENTO_MS) break;
    conversasFeitas++;
    const canal = item.canal ? canalPorId.get(item.canal) : null;
    const to = toWhatsAppNumber(item.telefone);
    if (!canal?.active || !to) {
      const motivo = !to ? "contato sem telefone" : "canal inativo";
      await marcar(item.mensagens.map((m) => m.id), motivo);
      erros.push(`${item.contato}: ${motivo}`);
      continue;
    }
    // Em ORDEM: se uma falha, as seguintes da mesma conversa não vão —
    // pergunta 2 sem a pergunta 1 não faz sentido para o cliente.
    for (let i = 0; i < item.mensagens.length; i++) {
      const m = item.mensagens[i];
      let resp: any;
      try {
        resp = await sendText(canal.phone_number_id, to, m.body);
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        // ⚠️ Marca ESTA e as SEGUINTES: marcando só esta, a próxima rodada
        // mandaria a pergunta 2 sem a 1.
        await marcar(item.mensagens.slice(i).map((x) => x.id), motivo);
        erros.push(`${item.contato}: ${motivo.slice(0, 120)}`);
        break;
      }
      const waId = resp?.messages?.[0]?.id ?? null;
      const { error: upErr } = await db
        .from("messages")
        .update({ status: "sent", wa_message_id: waId, error_detail: null })
        .eq("id", m.id);
      enviadas++;
      if (upErr) {
        /*
         * ⚠️ Enviou mas NÃO conseguiu registrar: seguir seria reenviar a mesma
         * mensagem na próxima rodada e o cliente a receberia em dobro. Para tudo.
         */
        return Response.json(
          {
            error: `Mensagem enviada, mas não foi possível registrar (${upErr.message}). Reenvio interrompido para não duplicar.`,
            enviadas,
          },
          { status: 500 }
        );
      }
    }
  }

  return Response.json({
    enviadas,
    conversas: conversasFeitas,
    restantes: plano.itens.length - conversasFeitas,
    erros: erros.slice(0, 20),
    totalErros: erros.length,
  });
}
