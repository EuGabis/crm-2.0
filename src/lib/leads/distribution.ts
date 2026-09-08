/**
 * Núcleo da distribuição de leads (rodízio). Usado em 2 lugares:
 *  - tempo real: o nó `distribute` do bot, quando o lead vira quente;
 *  - manual: /api/leads/distribute (admin) força a distribuição dos "aguardando".
 * Roda sempre com um client de service role (ignora RLS). Presença = ≤ 5 min.
 */
import { normalize } from "@/lib/bot/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Janela de presença: "online" = carimbou `last_seen_at` nos últimos 15 minutos.
 *
 * ⚠️ **Eram 5 minutos, e 5 minutos mede a coisa errada.** O carimbo sai do
 * `session-manager`, que pinga a cada 60 s enquanto houver mouse/teclado/scroll
 * recente — ou seja, ele mede "está mexendo no CRM", não "está trabalhando".
 * Quem lê uma conversa longa, atende o telefone ou vai ao banheiro sai do
 * rodízio. Medido em 2026-09-08, com a equipe em plena operação: o Daniel
 * aparecia OFFLINE com 13 min de último carimbo e a Beatriz com 36 — dos 3
 * atendentes da Secretaria, 1 contava como online.
 *
 * Atendente que o rodízio julga offline não recebe lead, e o lead vai para a
 * fila do setor: a janela curta era uma das causas da fila encher.
 *
 * ⚠️ O risco do outro lado (lead cair em quem saiu de fato) fica coberto por
 * duas peças que a mesma mudança conserta: `devolverInativas` volta a funcionar
 * (devolve em 15 min ÚTEIS sem resposta) e `clear_presence()` apaga a presença
 * no logout — inclusive no logout por inatividade, que para o papel "user"
 * acontece em 10 min e antes deixava `last_seen_at` parado no último clique.
 */
export const PRESENCE_MS = 15 * 60 * 1000;

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

/**
 * Uma pessoa específica está online agora?
 *
 * Existe para o nó `handoff` de atendente FIXO, que atribui direto e por isso
 * não passava por `onlineOrdered`. Reusa o mesmo `PRESENCE_MS` do rodízio — duas
 * definições de "online" divergiriam na primeira mudança, e aí a mesma pessoa
 * seria online para um caminho e offline para o outro.
 */
export async function estaOnline(db: any, locationId: string, userId: string): Promise<boolean> {
  const online = await onlineOrdered(db, locationId, [userId]);
  return online.length > 0;
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
      /*
       * ⚠️ **O padrão era "rodízio do bot", e isso MENTIA** para o chamador que
       * não é rodízio. O nó `handoff` de atendente FIXO chama esta função direto,
       * e o fio dizia "rodízio do bot" numa atribuição que o rodízio nunca viu —
       * foi o que fez a investigação de 02/09 procurar defeito na presença
       * enquanto a causa era rota fixa no fluxo. Sem motivo informado, agora diz
       * que não sabe, em vez de chutar o caminho mais comum.
       */
      assign_reason: p.reason ?? "atribuída pelo bot (origem não informada)",
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
     * 🔴 **Aqui era `sla_conversations`, e era um NO-OP.** A função tem a guarda
     * de empresa na PRIMEIRA linha (`p_location not in (select
     * private.user_locations())`, padrão 0049) e este código roda com a SERVICE
     * ROLE, cujo `auth.uid()` é nulo. A guarda dava `return` e devolvia ZERO
     * LINHAS, SEM ERRO — então nem o `if (error)` abaixo salvava.
     *
     * Medido em 2026-09-08: como `service_role`, 0 linhas; como admin real, 35
     * clientes esperando e 6 presos com atendente. Em 11 dias no ar, ZERO
     * eventos de devolução. O tique respondia 200 e `{devolvidas: 0}` — com cara
     * de saúde, que é o que fez isso passar despercebido.
     *
     * ⚠️ É a armadilha que este repositório já registrou duas vezes: "zero
     * linhas por guarda de RLS não é prova de que a função funciona".
     *
     * `conversas_esperando` (202609081310) é o recorte mínimo desta pergunta,
     * concedido SÓ à service_role, e reusa a MESMA `private.business_minutes`
     * da 0079 — a devolução e o relatório de SLA continuam concordando sobre o
     * que é "esperando".
     */
    const { data: linhas, error } = await db.rpc("conversas_esperando", {
      p_location: locationId,
      p_limite_min: limite,
    });
    if (error) {
      // Antes da migração ser aplicada, a função não existe. Avisa e segue: a
      // varredura da fila (que não depende de SQL novo) continua funcionando.
      console.warn("[rodizio] não deu para ler a espera:", error.message);
      continue;
    }

    /*
     * A função já filtra "sem resposta humana" e "espera >= limite"; aqui só
     * sobra quem TEM dono. Quem está sem dono é assunto de
     * `distribuirFilaDoSetor` — devolver para a fila quem já está na fila seria
     * um evento de transferência por tique, para sempre.
     */
    const parados = (linhas ?? []).filter(
      (l: any) => l.assigned_to && channelIds.includes(l.channel_id),
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
        Number(parados.find((p: any) => p.conversation_id === conv.id)?.espera_util_min ?? limite),
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

/* ------------------------------------------------------------------ *
 * Esvaziar a fila do setor
 * ------------------------------------------------------------------ */

/**
 * Teto de conversas distribuídas por setor em UM tique.
 *
 * Não é ajuste de desempenho: é rede contra despejo. Uma fila que acumulou por
 * dias (ou um defeito que marque `awaiting_distribution` em massa) cairia inteira
 * na caixa de quem estivesse online no minuto seguinte ao deploy. Com o teto, um
 * atraso grande escoa em alguns minutos e continua reversível.
 */
const FILA_POR_TIQUE = 25;

/**
 * A fila do setor, já sem o que NÃO pode ser distribuído.
 *
 * 🔴 ⚠️ **`emTriagem` é o filtro mais importante deste arquivo.** `assignLeadTo`
 * põe `bot_paused = true`, então distribuir uma conversa cuja triagem está em
 * curso **CALA o bot** e entrega ao atendente uma conversa sem nome, sem e-mail e
 * sem assunto — o oposto do que a triagem existe para fazer.
 *
 * Não é hipótese: era o estado dos 3 leads de 03/09 presos há 115h. A conversa
 * havia sido finalizada, o cliente escreveu de novo, o webhook zerou a sessão do
 * bot e uma triagem NOVA começou — mas a flag de fila do ciclo ANTERIOR ficou
 * para trás. `bot_sessions.status` estava `aguardando` em `pede_nome`/`pede_email`:
 * o bot esperava o cliente, que abandonou. Não havia atendente a quem entregar.
 *
 * `concluido` (ou sem sessão) = a triagem terminou e o lead espera humano de
 * verdade → vai. `aguardando`/`ativo` = o bot está no meio → fica, e é o PRÓPRIO
 * bot que chama `distributeLead` ao terminar.
 *
 * ⚠️ Mora aqui, exportada, porque **existem DOIS caminhos que esvaziam a fila**:
 * esta varredura e o botão do admin (`/api/leads/distribute`). Com a regra escrita
 * só na varredura, o botão continuaria podendo cortar a triagem — e a divergência
 * apareceria como "às vezes o bot para no meio", que é indepurável.
 *
 * `retidas` é devolvido para o chamador poder dizer quantas FICARAM, em vez de
 * confundir "não havia nada" com "havia e não pôde".
 */
export async function filaProntaDoSetor(
  db: any,
  locationId: string,
  channelIds: string[],
  limite: number,
): Promise<{ prontas: { id: string; contact_id: string }[]; retidas: number }> {
  const { data: fila } = await db
    .from("conversations")
    .select("id, contact_id")
    .eq("location_id", locationId)
    .eq("awaiting_distribution", true)
    .is("assigned_to", null)
    .is("closed_at", null)
    .is("archived_at", null)
    .in("channel_id", channelIds)
    // Quem espera há mais tempo primeiro — é uma fila.
    .order("last_message_at", { ascending: true })
    .limit(limite);
  if (!fila?.length) return { prontas: [], retidas: 0 };

  const { data: sessoes } = await db
    .from("bot_sessions")
    .select("conversation_id, status")
    .in("conversation_id", fila.map((c: any) => c.id));
  const emTriagem = new Set(
    (sessoes ?? [])
      .filter((s: any) => s.status === "aguardando" || s.status === "ativo")
      .map((s: any) => s.conversation_id),
  );

  const prontas = fila.filter((c: any) => !emTriagem.has(c.id));
  return { prontas, retidas: fila.length - prontas.length };
}

/**
 * Distribui a FILA DO SETOR (`awaiting_distribution`) entre quem está online.
 *
 * 🔴 **Existe porque a fila não tinha saída.** Medido em 2026-09-08: 12 leads
 * presos, 3 desde 03/09 (115 horas), com atendente ONLINE no setor. O lead entra
 * na fila quando o bot termina a triagem e ninguém está online — o que está
 * CERTO, e é a decisão de 2026-08-28 (melhor esperar na fila do grupo, visível a
 * todos, do que ficar preso com quem não está lá). O que faltava era o outro
 * lado: **ninguém tirava o lead da fila quando a equipe chegava.**
 *
 * A varredura que a 0058 prometia (`/api/leads/sweep`) nunca existiu; o único
 * caminho era o botão do admin em `/api/leads/distribute`. Um lead que caísse às
 * 5h da manhã só saía se um administrador se lembrasse de clicar.
 *
 * Roda no tique de minuto que já existe, como as agendadas (0028), a transcrição
 * (0085) e a devolução por espera — segundo cron seria segundo segredo, segunda
 * migração de agendamento e mais um passo manual em produção.
 *
 * ⚠️ **Ninguém online não é problema a resolver: é para deixar na fila.** A
 * função não atribui a quem está offline em nenhuma hipótese; ela apenas volta no
 * minuto seguinte. Na prática o lead da madrugada é atribuído no primeiro minuto
 * em que a primeira pessoa do setor aparece.
 */
export async function distribuirFilaDoSetor(
  db: any,
  locationId: string,
): Promise<{ distribuidas: number; naFila: number }> {
  let distribuidas = 0;
  let naFila = 0;

  const { data: deps } = await db
    .from("departments")
    .select("id, usa_rodizio")
    .eq("location_id", locationId);

  for (const dep of deps ?? []) {
    /*
     * Setor sem rodízio (0081) é decisão explícita: os leads dele ficam na fila
     * para alguém assumir à mão. Distribuir aqui atropelaria essa escolha — é a
     * mesma regra que o nó `distribute` do bot já respeita.
     */
    if (dep.usa_rodizio === false) continue;

    const { data: dcs } = await db
      .from("department_channels")
      .select("channel_id")
      .eq("department_id", dep.id);
    const channelIds = (dcs ?? []).map((d: any) => d.channel_id);
    // Sem número vinculado não há como saber que a conversa é deste setor.
    if (!channelIds.length) continue;

    const { prontas, retidas } = await filaProntaDoSetor(db, locationId, channelIds, FILA_POR_TIQUE);
    if (!prontas.length) {
      naFila += retidas;
      continue;
    }
    naFila += retidas;

    // ⚠️ Contador POR SETOR. Usar o acumulador `distribuidas` para calcular o
    // resto desta fila daria número errado a partir do segundo setor com fila.
    let feitasAqui = 0;
    for (const conv of prontas) {
      const user = await distributeOne(db, {
        locationId,
        deptId: dep.id,
        conversationId: conv.id,
        contactId: conv.contact_id,
        pipelineName: "Controle de Leads",
        reason: "varredura da fila do setor",
      });
      if (user) {
        feitasAqui++;
      } else {
        /*
         * `distributeOne` devolveu null = ninguém online no setor. Não há por que
         * tentar as outras da mesma fila neste tique: a resposta seria a mesma, e
         * insistir só gastaria consultas. Elas continuam na fila, visíveis a
         * todos, e o próximo tique tenta de novo.
         */
        naFila += prontas.length - feitasAqui;
        break;
      }
    }
    distribuidas += feitasAqui;
  }

  return { distribuidas, naFila };
}

/**
 * Roda a varredura da fila em TODAS as empresas — é o que o tique chama.
 *
 * Mesma forma de `devolverInativasDeTodas`: o tique é máquina-a-máquina (pg_cron)
 * e não tem sessão, então não existe "empresa atual". Uma empresa falhar não pode
 * parar as outras.
 */
export async function distribuirFilaDeTodas(): Promise<{
  distribuidas: number;
  naFila: number;
}> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();
  const { data: locs } = await db.from("locations").select("id");
  let distribuidas = 0;
  let naFila = 0;
  for (const l of locs ?? []) {
    try {
      const r = await distribuirFilaDoSetor(db, l.id as string);
      distribuidas += r.distribuidas;
      naFila += r.naFila;
    } catch (e) {
      console.warn(`[rodizio] varredura da fila falhou na empresa ${l.id}:`, e);
    }
  }
  return { distribuidas, naFila };
}
