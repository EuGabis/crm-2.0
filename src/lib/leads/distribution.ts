/**
 * Núcleo da distribuição de leads (rodízio). Usado em 2 lugares:
 *  - tempo real: o nó `distribute` do bot, quando o lead vira quente;
 *  - manual: /api/leads/distribute (admin) força a distribuição dos "aguardando".
 * Roda sempre com um client de service role (ignora RLS). Presença = ≤ 5 min.
 */
import { normalize } from "@/lib/bot/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PRESENCE_MS = 5 * 60 * 1000;

/** Status da oportunidade deduzido do nome da etapa (igual ao pipeline.ts). */
function statusForStageName(name: string): "open" | "won" | "lost" {
  const n = (name ?? "").toUpperCase();
  if (n.includes("PERDID")) return "lost";
  if (n.includes("ASSINOU") || n.includes("GANHO") || n.includes("GANHA")) return "won";
  return "open";
}

/** Departamento vinculado a um número (o primeiro, se houver mais de um). */
export async function channelDepartmentId(db: any, channelId: string): Promise<string | null> {
  const { data } = await db
    .from("department_channels")
    .select("department_id")
    .eq("channel_id", channelId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return data?.department_id ?? null;
}

/** Pool + cursor do departamento. Pool vazio = todos os membros do departamento. */
export async function departmentPool(
  db: any,
  locationId: string,
  deptId: string,
): Promise<{ pool: string[]; cursor: number }> {
  const { data: dep } = await db
    .from("departments")
    .select("lead_pool, rr_cursor")
    .eq("id", deptId)
    .maybeSingle();
  let pool: string[] = dep?.lead_pool ?? [];
  if (!pool.length) {
    const { data: mem } = await db
      .from("location_members")
      .select("user_id")
      .eq("location_id", locationId)
      .eq("department_id", deptId);
    pool = (mem ?? []).map((m: any) => m.user_id);
  }
  return { pool, cursor: dep?.rr_cursor ?? 0 };
}

/** Quais desses user_ids estão online (last_seen_at ≤ 5 min), na ordem do pool. */
export async function onlineOrdered(
  db: any,
  locationId: string,
  pool: string[],
): Promise<string[]> {
  if (!pool.length) return [];
  const since = new Date(Date.now() - PRESENCE_MS).toISOString();
  const { data } = await db
    .from("location_members")
    .select("user_id")
    .eq("location_id", locationId)
    .in("user_id", pool)
    .gte("last_seen_at", since);
  const online = new Set((data ?? []).map((m: any) => m.user_id));
  return pool.filter((u) => online.has(u));
}

/** Funil de leads para setar o dono do card: por nome, senão pelas etapas típicas. */
async function leadsPipelineId(
  db: any,
  locationId: string,
  pipelineName?: string,
): Promise<string | null> {
  const { data: pipelines } = await db
    .from("pipelines")
    .select("id, name, position")
    .eq("location_id", locationId)
    .order("position");
  if (!pipelines?.length) return null;
  if (pipelineName) {
    const byName = pipelines.find((p: any) => normalize(p.name).includes(normalize(pipelineName)));
    if (byName) return byName.id;
  }
  const { data: stages } = await db
    .from("stages")
    .select("name, pipeline_id")
    .in("pipeline_id", pipelines.map((p: any) => p.id));
  const hints = ["quente", "novo lead"];
  let best: any = null;
  let bestScore = -1;
  for (const p of pipelines) {
    const names = (stages ?? [])
      .filter((s: any) => s.pipeline_id === p.id)
      .map((s: any) => normalize(s.name));
    const score = hints.reduce((a, h) => a + (names.some((n: string) => n.includes(h)) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return (bestScore > 0 ? best : pipelines[0]).id;
}

/** Atribui o lead ao atendente: conversa + dono do card no funil de leads. */
export async function assignLeadTo(
  db: any,
  p: {
    conversationId: string;
    contactId: string;
    locationId: string;
    pipelineName?: string;
    /** Vai para `conversations.assign_reason` e aparece no evento do fio. */
    reason?: string;
  },
  userId: string,
  offline = false,
) {
  await db
    .from("conversations")
    .update({
      assigned_to: userId,
      bot_paused: true,
      awaiting_distribution: false,
      // caiu enquanto o atendente estava offline → aparece na aba "Offline" dele
      assigned_offline: offline,
      /*
       * ⚠️ O evento no fio NÃO é mais escrito aqui: quem escreve é o gatilho
       * `private.log_atribuicao` (202608281530), que pega TODOS os oito caminhos
       * de atribuição — os seis em SQL inclusive. Deixar o insert manual daria
       * dois eventos para a mesma atribuição.
       *
       * O que era texto no insert virou MOTIVO na coluna: o gatilho monta
       * "Atribuída a X (estava offline) · pelo sistema · rodízio do bot".
       */
      assign_reason: p.reason ?? "rodízio do bot",
    })
    .eq("id", p.conversationId);

  const pid = await leadsPipelineId(db, p.locationId, p.pipelineName);
  if (!pid) return;
  const { data: opp } = await db
    .from("opportunities")
    .select("id, stage_id, name")
    .eq("contact_id", p.contactId)
    .eq("pipeline_id", pid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (opp) await db.from("opportunities").update({ owner_id: userId }).eq("id", opp.id);
}

/**
 * Escolhe UM atendente do departamento por rodízio e atribui a conversa.
 * Regra: se ALGUÉM está online, distribui só entre os online (rodízio). Se TODOS
 * estão offline, distribui igualitário entre todos do pool e marca "offline".
 * Avança o cursor. Retorna o user escolhido ou null (sem pool = aguardando).
 */
export async function distributeOne(
  db: any,
  args: {
    locationId: string;
    deptId: string;
    conversationId: string;
    contactId: string;
    pipelineName?: string;
    /**
     * Quem NÃO pode receber esta conversa.
     *
     * ⚠️ Usado pela devolução por inatividade: sem isso o rodízio pode escolher a
     * MESMA pessoa que não respondeu — o cursor não sabe de onde a conversa veio
     * — e o resultado seria um evento de transferência a cada tique, para sempre.
     */
    excluir?: string[];
    /** Motivo repassado ao `assignLeadTo` → coluna `assign_reason` → evento. */
    reason?: string;
  },
): Promise<string | null> {
  const { pool, cursor } = await departmentPool(db, args.locationId, args.deptId);
  if (!pool.length) return null; // sem pool/departamento → segura (aguardando)
  const online = await onlineOrdered(db, args.locationId, pool);
  // Departamento pode distribuir mesmo pra offline (0083): usa o pool inteiro
  // independente da presença. Senão, o padrão: online primeiro, offline só se
  // todos estiverem offline.
  const { data: dep } = await db
    .from("departments")
    .select("rodizio_offline")
    .eq("id", args.deptId)
    .maybeSingle();
  const alwaysAll = dep?.rodizio_offline === true;
  /*
   * ⚠️ **Ninguém online agora = SEGURA, não despeja no pool inteiro.**
   *
   * Era `online.length === 0 ? pool : online` — e essa segunda causa
   * sobreviveria mesmo com o `rodizio_offline` desligado. Na madrugada ninguém
   * está online, então caía no `pool` e a conversa era atribuída a quem estivesse
   * na vez do cursor: foi assim que conversas de 05:55 amanheceram na caixa de
   * uma atendente que começa 12h, invisíveis para o resto do setor.
   *
   * Devolvendo `null`, o chamador marca `awaiting_distribution` e o lead fica na
   * FILA DO SETOR — visível para todos, e distribuído a quem entrar primeiro.
   * Esperar na fila do grupo é melhor que ficar preso com quem não está lá.
   */
  const semExcluidos = (l: string[]) =>
    args.excluir?.length ? l.filter((u) => !args.excluir!.includes(u)) : l;
  // ⚠️ A exclusão é aplicada DEPOIS da regra de presença, não antes: tirar a
  // pessoa do pool cedo mudaria o tamanho de `pool` e, com ele, o resultado do
  // `cursor % list.length` — o rodízio pularia gente ao devolver uma conversa.
  const list = semExcluidos(alwaysAll ? pool : online);
  if (!list.length) return null;
  const user = list[cursor % list.length];
  const offline = !online.includes(user); // marca "offline" se o escolhido não está online
  await db.from("departments").update({ rr_cursor: cursor + 1 }).eq("id", args.deptId);
  await assignLeadTo(
    db,
    {
      conversationId: args.conversationId,
      contactId: args.contactId,
      locationId: args.locationId,
      pipelineName: args.pipelineName,
      reason: args.reason,
    },
    user,
    offline,
  );
  return user;
}

/**
 * Distribui uma fração dos leads "aguardando" de um departamento entre os online,
 * em rodízio. `fraction` 1 = todos; 0.3 = 30%. Retorna quantos foram atribuídos.
 */
export async function distributeDepartment(
  db: any,
  locationId: string,
  deptId: string,
  convs: { id: string; contact_id: string }[],
  fraction: number,
): Promise<number> {
  if (!convs.length) return 0;
  const { pool, cursor } = await departmentPool(db, locationId, deptId);
  const online = await onlineOrdered(db, locationId, pool);
  // Departamento que distribui mesmo offline (0083) usa o pool inteiro; senão,
  // só os online (e não distribui nada se ninguém online).
  const { data: dep } = await db
    .from("departments")
    .select("rodizio_offline")
    .eq("id", deptId)
    .maybeSingle();
  const list = dep?.rodizio_offline === true ? pool : online;
  if (!list.length) return 0;

  const take = Math.min(convs.length, Math.max(1, Math.ceil(convs.length * fraction)));
  for (let i = 0; i < take; i++) {
    const conv = convs[i];
    const user = list[(cursor + i) % list.length];
    await assignLeadTo(
      db,
      {
        conversationId: conv.id,
        contactId: conv.contact_id,
        locationId,
        pipelineName: "Controle de Leads",
      },
      user,
      !online.includes(user),
    );
  }
  await db.from("departments").update({ rr_cursor: cursor + take }).eq("id", deptId);
  return take;
}

export { statusForStageName };

/* ------------------------------------------------------------------ *
 * Devolver conversa parada ao rodízio
 * ------------------------------------------------------------------ */

/**
 * Devolve ao rodízio as conversas cujo aluno está esperando há tempo demais.
 *
 * ⚠️ **Existe porque respeitar presença não basta.** Relato de 2026-08-28: a
 * atendente estava offline (começa 12h) e o bot moveu conversas para ela; ninguém
 * mais do setor recebeu e a fila de espera dos alunos ficou alta. Desligar o
 * `rodizio_offline` impede o caso dela, mas não estes:
 *   - a pessoa está ONLINE e saiu para almoçar, entrou em reunião ou não viu;
 *   - a conversa caiu de madrugada, ficou aguardando, e nada garante que alguém
 *     vá olhar a fila do setor.
 *
 * ⚠️ **O relógio é a ESPERA DO ALUNO** — última mensagem de entrada sem resposta
 * humana —, não "quanto tempo faz que foi atribuída". Não existe coluna
 * `assigned_at`, mas o motivo principal é outro: a queixa foi a FILA DE ESPERA, e
 * medir a espera do aluno é medir exatamente a queixa.
 *
 * ⚠️ **Espera ÚTIL, pela mesma `private.business_minutes` do SLA (0079).** Com
 * tempo corrido, toda conversa que chegasse numa sexta à noite seria "devolvida"
 * na madrugada do sábado, em rodízio, para gente que também não está lá — trocaria
 * uma conversa parada por três eventos de transferência inúteis no fio.
 */
export async function devolverInativas(
  db: any,
  locationId: string,
): Promise<{ devolvidas: number; redistribuidas: number }> {
  let devolvidas = 0;
  let redistribuidas = 0;

  const { data: deps } = await db
    .from("departments")
    .select("id, devolver_apos_min, usa_rodizio")
    .eq("location_id", locationId);

  for (const dep of deps ?? []) {
    const limite = Number(dep.devolver_apos_min ?? 0);
    if (!limite || dep.usa_rodizio === false) continue;

    const { data: dcs } = await db
      .from("department_channels")
      .select("channel_id")
      .eq("department_id", dep.id);
    const channelIds = (dcs ?? []).map((d: any) => d.channel_id);
    if (!channelIds.length) continue;

    /*
     * `sla_conversations` já responde exatamente a pergunta "quem está esperando
     * e há quantos minutos ÚTEIS" — com a resposta do bot não contando como
     * atendimento, que é essencial aqui: o auto-responder responde em segundos e
     * sem isso NENHUMA conversa pareceria parada.
     *
     * Reusar em vez de escrever a consulta de novo evita duas definições de
     * "esperando" para divergirem — foi o cuidado que a própria 0079 registrou.
     */
    /*
     * ⚠️ Os nomes são `p_from`/`p_to`/`p_target_min` (assinatura da 0079). Errar
     * o nome de parâmetro num `rpc` do PostgREST não dá erro de compilação — dá
     * 404 "function not found" em produção.
     *
     * Janela de 7 dias: a devolução só interessa para quem está esperando AGORA,
     * e varrer 30 dias a cada minuto seria pagar caro por linhas que já foram
     * respondidas ou fechadas há semanas.
     */
    const { data: linhas, error } = await db.rpc("sla_conversations", {
      p_location: locationId,
      p_from: new Date(Date.now() - 7 * 86400000).toISOString(),
      p_to: new Date(Date.now() + 86400000).toISOString(),
      p_target_min: limite,
    });
    if (error) {
      console.warn("[rodizio] não deu para ler a espera:", error.message);
      continue;
    }

    const parados = (linhas ?? []).filter(
      (l: any) =>
        !l.respondida && !l.fechada && Number(l.espera_util_min ?? 0) >= limite,
    );
    if (!parados.length) continue;

    const ids = parados.map((l: any) => l.conversation_id);
    const { data: convs } = await db
      .from("conversations")
      .select("id, contact_id, assigned_to")
      .in("id", ids)
      .in("channel_id", channelIds)
      .not("assigned_to", "is", null)
      .is("closed_at", null)
      .is("archived_at", null);

    for (const conv of convs ?? []) {
      const anterior = conv.assigned_to as string;
      /*
       * ⚠️ Solta ANTES de redistribuir, e num passo separado: se o rodízio não
       * achar ninguém disponível, a conversa fica na FILA DO SETOR (visível para
       * todos) em vez de continuar presa com quem não respondeu. Redistribuir
       * primeiro e soltar depois deixaria a conversa parada no caso ruim.
       */
      const esperou = Math.round(
        parados.find((p: any) => p.conversation_id === conv.id)?.espera_util_min ?? limite,
      );
      await db
        .from("conversations")
        .update({
          assigned_to: null,
          awaiting_distribution: true,
          assigned_offline: false,
          // O gatilho `log_atribuicao` escreve o evento; aqui só vai o motivo.
          assign_reason: `devolvida: cliente esperava ${esperou} min sem resposta`,
        })
        .eq("id", conv.id);
      devolvidas++;

      const novo = await distributeOne(db, {
        locationId,
        deptId: dep.id,
        conversationId: conv.id,
        contactId: conv.contact_id,
        pipelineName: "Controle de Leads",
        reason: `redistribuída após ${esperou} min de espera`,
        // ⚠️ Sem isto o rodízio pode devolver para a MESMA pessoa que não
        // respondeu — o cursor não sabe de onde a conversa veio, e o resultado
        // seria um evento de transferência a cada tique, para sempre.
        excluir: [anterior],
      });
      if (novo) redistribuidas++;
    }
  }

  return { devolvidas, redistribuidas };
}

/**
 * Roda a devolução em TODAS as empresas — é o que o tick de minuto chama.
 *
 * O tick é máquina-a-máquina (pg_cron) e não tem sessão, então não existe
 * "empresa atual": precisa varrer. Cada empresa é independente e uma falhar não
 * pode parar as outras.
 */
export async function devolverInativasDeTodas(): Promise<{
  devolvidas: number;
  redistribuidas: number;
}> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();
  const { data: locs } = await db.from("locations").select("id");
  let devolvidas = 0;
  let redistribuidas = 0;
  for (const l of locs ?? []) {
    try {
      const r = await devolverInativas(db, l.id as string);
      devolvidas += r.devolvidas;
      redistribuidas += r.redistribuidas;
    } catch (e) {
      console.warn(`[rodizio] devolução falhou na empresa ${l.id}:`, e);
    }
  }
  return { devolvidas, redistribuidas };
}
