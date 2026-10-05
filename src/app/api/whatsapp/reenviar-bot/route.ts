import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendText } from "@/lib/whatsapp/client";
import { toWhatsAppNumber } from "@/lib/whatsapp/phone";
import { planoDeReenvio, type MsgDaConversa, type MotivoPulo } from "@/lib/whatsapp/reenvio-bot";

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
  for (let i = 0; i < convIds.length; i += 100) {
    const lote = convIds.slice(i, i + 100);
    const { data, error: e2 } = await db
      .from("messages")
      .select("id, conversation_id, direction, status, type, automated, internal, body, created_at")
      .in("conversation_id", lote)
      .gte("created_at", janelaDesde)
      .limit(10000);
    if (e2) throw new Error(`fio: ${e2.message}`);
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
  for (const item of plano.itens) {
    if (Date.now() - inicio > ORCAMENTO_MS) break;
    const canal = item.canal ? canalPorId.get(item.canal) : null;
    const to = toWhatsAppNumber(item.telefone);
    if (!canal?.active || !to) {
      erros.push(`${item.contato}: ${!to ? "sem telefone" : "canal inativo"}`);
      continue;
    }
    // Em ORDEM: se uma falha, as seguintes da mesma conversa não vão —
    // pergunta 2 sem a pergunta 1 não faz sentido para o cliente.
    for (const m of item.mensagens) {
      try {
        const resp: any = await sendText(canal.phone_number_id, to, m.body);
        const waId = resp?.messages?.[0]?.id ?? null;
        await db
          .from("messages")
          .update({ status: "sent", wa_message_id: waId, error_detail: null })
          .eq("id", m.id);
        enviadas++;
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        await db.from("messages").update({ error_detail: `Reenvio falhou: ${motivo}` }).eq("id", m.id);
        erros.push(`${item.contato}: ${motivo.slice(0, 120)}`);
        break;
      }
    }
    conversasFeitas++;
  }

  return Response.json({
    enviadas,
    conversas: conversasFeitas,
    restantes: plano.itens.length - conversasFeitas,
    erros: erros.slice(0, 20),
    totalErros: erros.length,
  });
}
