/**
 * Núcleo da distribuição de leads (rodízio). Usado em 2 lugares:
 *  - tempo real: o nó `distribute` do bot, quando o lead vira quente;
 *  - manual: /api/leads/distribute (admin) força a distribuição dos "aguardando".
 * Roda sempre com um client de service role (ignora RLS). Presença = ≤ 5 min.
 */
import { normalize } from "@/lib/bot/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/*
 * A janela de presença mora em `@/lib/presence` porque as TELAS também precisam
 * dela (a de Departamentos mostra quem está recebendo lead), e importar este
 * módulo no cliente arrastaria o cliente de service role para o navegador.
 * Reexportada aqui para não quebrar quem já importava daqui.
 */
export { PRESENCE_MS } from "@/lib/presence";
import { PRESENCE_MS } from "@/lib/presence";

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
 * Quem do pool está online E ACEITA lead novo agora.
 *
 * 🔴 `location_members.disponibilidade` (202609101100) separa duas coisas que
 * estavam coladas em `last_seen_at`: **estar no CRM** e **querer lead novo**.
 * Pedido do Gabriel: *"os vendedores ficam no CRM pós expediente para responder
 * os leads, mas não querem receber leads novos."* Sem o status, a única forma de
 * parar de receber era fechar o CRM — e aí eles também parariam de responder
 * quem já está com eles.
 *
 * ⚠️ **Ausente não recebe NADA pelo rodízio** — nem lead do bot, nem devolução
 * de outro vendedor (decisão do Gabriel: *"apenas se for transferência de outro
 * atendente"*). A transferência é ação de PESSOA e não passa por aqui, então ela
 * continua chegando, que é exatamente a exceção pedida.
 *
 * ⚠️ Tolera a coluna não existir: o código vai ao ar antes da migração, e pedir
 * coluna inexistente faz o PostgREST recusar a consulta INTEIRA — o rodízio
 * pararia de distribuir. Sem a coluna, todo mundo presente conta como
 * disponível, que é o comportamento de hoje.
 */
export async function disponiveisOrdered(
  db: any,
  locationId: string,
  pool: string[],
): Promise<string[]> {
  if (!pool.length) return [];
  const since = new Date(Date.now() - PRESENCE_MS).toISOString();
  const base = () =>
    db
      .from("location_members")
      .select("user_id, disponibilidade")
      .eq("location_id", locationId)
      .in("user_id", pool)
      .gte("last_seen_at", since);
  let linhas: any[] | null = null;
  const r = await base();
  if (r.error) {
    const semColuna = await db
      .from("location_members")
      .select("user_id")
      .eq("location_id", locationId)
      .in("user_id", pool)
      .gte("last_seen_at", since);
    linhas = semColuna.data;
  } else {
    linhas = r.data;
  }
  const ok = new Set(
    (linhas ?? [])
      .filter((m: any) => (m.disponibilidade ?? "online") !== "ausente")
      .map((m: any) => m.user_id),
  );
  // Mantém a ORDEM DO POOL: é ela que o cursor indexa.
  return pool.filter((u) => ok.has(u));
}

/**
 * Início do dia de HOJE no relógio de São Paulo, como instante ISO.
 *
 * ⚠️ A Vercel roda em UTC: às 21h de Brasília o servidor já está no dia
 * seguinte, e um corte por `new Date().setHours(0,0,0,0)` jogaria fora as
 * atribuições da noite — justamente as do turno que gerou esta queixa. Mesmo
 * cuidado de `private.business_minutes` (0079) e das janelas de resposta
 * automática.
 *
 * ⚠️ O offset é fixo em -03:00: o Brasil não tem horário de verão desde 2019. Se
 * ele voltar, esta linha erra por uma hora em dois dias do ano — e aí o certo é
 * derivar o offset das partes do `Intl`, não somar uma hora à mão.
 */
export function inicioDoDiaSP(agora: Date = new Date()): string {
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
  return `${dia}T00:00:00-03:00`;
}

/**
 * Quantos leads cada um do pool JÁ RECEBEU HOJE nos números deste setor.
 *
 * 🔴 **Media conversas ABERTAS acumuladas, e isso starvava um vendedor.**
 * Relato de 2026-09-11: *"o Rogerio recebeu muitos e o Paulo foi o único que não
 * recebeu"*. Não era defeito de presença nem de pool — era a métrica.
 *
 * Em 10/09 o Paulo tinha **67 conversas abertas** (medido) por causa do
 * incidente da fila; a migração que iria rebalanceá-las (`202609102300`) ainda
 * não tinha sido aplicada, então elas continuavam com ele. A cota olhava esse
 * acumulado, via o Paulo MUITO acima da média e nunca o escolhia — enquanto
 * Alberto e Rogério "alcançavam" o número dele absorvendo a fila inteira.
 *
 * ⚠️ **A regra do Gabriel é sobre os LEADS, não sobre o acervo:** *"distribuir
 * igualmente os leads para todos os vendedores"*. Quem recebeu 30 hoje e fechou
 * os 30 recebeu 30 — fechar rápido não pode render mais lead, e um backlog
 * histórico não pode render zero. Por isso a contagem é por `atribuida_em` no
 * DIA, e NÃO filtra `closed_at`/`archived_at`.
 *
 * ⚠️ E a cota do dia continua atendendo a regra original: com 90 na fila de
 * manhã e todos zerados no dia, a conta dá 30 para cada um, que é literalmente o
 * exemplo que ele deu.
 *
 * ⚠️ Uma consulta por SETOR, não por lead: a varredura chama `distributeOne` num
 * laço, e recontar a cada lead seria uma ida ao banco por conversa da fila. O
 * mapa é passado adiante e incrementado a cada atribuição — sem isso, dez leads
 * no mesmo tique iriam todos para a mesma pessoa.
 */
export async function recebidosNoDiaPorAtendente(
  db: any,
  locationId: string,
  channelIds: string[],
  pool: string[],
): Promise<Map<string, number>> {
  const cargas = new Map<string, number>(pool.map((u) => [u, 0]));
  if (!pool.length || !channelIds.length) return cargas;
  const desde = inicioDoDiaSP();
  const base = () =>
    db
      .from("conversations")
      .select("assigned_to")
      .eq("location_id", locationId)
      .in("channel_id", channelIds)
      .in("assigned_to", pool);
  /*
   * ⚠️ Tolera `atribuida_em` (202609101830) não existir: sem o fallback, a
   * consulta inteira seria recusada pelo PostgREST e TODAS as cargas voltariam
   * zero — o que faria a cota liberar geral e reabrir o despejo. O fallback é a
   * métrica antiga (abertas), que é pior mas não é catastrófica.
   */
  let linhas: any[] | null = null;
  const r = await base().gte("atribuida_em", desde);
  if (r.error) {
    const antigo = await base().is("closed_at", null).is("archived_at", null);
    linhas = (antigo.data as any[]) ?? null;
  } else {
    linhas = (r.data as any[]) ?? null;
  }
  for (const c of linhas ?? []) {
    const u = (c as any).assigned_to as string | null;
    if (u) cargas.set(u, (cargas.get(u) ?? 0) + 1);
  }
  return cargas;
}

/**
 * A COTA de cada pessoa neste momento: quantos leads cabem a cada um do pool.
 *
 * 🔴 A fórmula sai literalmente da regra do Gabriel (2026-09-10): *"dividir
 * igual — 30 pro Paulo, 30 para o Alberto quando logar e mais 30 para o Rogério
 * quando logar"*, diante de 90 leads na fila e um vendedor só online.
 *
 *     cota = teto( (carga de TODOS do pool + fila) / tamanho do pool )
 *
 * ⚠️ **A soma inclui quem está OFFLINE, e é isso que faz a divisão funcionar.**
 * Contando só quem está online, a conta com uma pessoa daria 90/1 = 90 — o
 * despejo de hoje. Com o pool inteiro no denominador, o Paulo recebe até 30 e
 * para; os outros 60 esperam os donos deles chegarem.
 *
 * ⚠️ **Teto e não piso.** No dia a dia (cargas 10/10/10 e 1 lead novo) o piso
 * daria 10 e ninguém estaria abaixo da própria cota — o lead ficaria parado na
 * fila para sempre, com três vendedores livres. O teto dá 11 e o lead sai.
 *
 * Estável por construção: à medida que a carga sobe, a fila cai, e a cota se
 * mantém — foi conferido no caso dos 90 (30 exatos por pessoa).
 */
export function cotaPorAtendente(
  cargas: number[],
  /**
   * 🔴 **Quantos ainda ESPERAM — e o "ainda" é a correção de 2026-09-11.**
   *
   * `soma(cargas) + filaRestante` tem de ser CONSTANTE ao longo de um lote: cada
   * entrega soma 1 numa carga e tira 1 da fila. Os chamadores passavam a fila
   * INICIAL e incrementavam o mapa de cargas — então o total crescia 1 por
   * entrega e **a cota subia junto**. Com pool 2 e 6 esperando ela ia de 3 a 6, e
   * a única pessoa online levava a fila inteira; com pool 3 e 100, ela nunca
   * parava. Foi a causa dos dois incidentes ("o Paulo recebeu 90", "o Alberto
   * recebeu todos") — e sobreviveu à primeira correção porque eu mexi em QUEM
   * escolhe, não no total que a conta divide.
   */
  filaRestante: number,
  tamanhoDoPool: number,
): number {
  if (tamanhoDoPool <= 0) return 0;
  const soma = cargas.reduce((a, c) => a + (Number.isFinite(c) ? c : 0), 0);
  return Math.ceil((soma + Math.max(filaRestante, 0)) / tamanhoDoPool);
}

/**
 * Quem recebe o próximo lead: o MENOS carregado entre os disponíveis, e só se
 * ele ainda couber na própria cota.
 *
 * Devolve `null` quando ninguém cabe — e aí o lead **fica na fila do setor**,
 * visível a todos, em vez de ser empurrado para quem já está cheio. É a
 * diferença entre "distribuir igualmente" e "entregar a quem estiver logado".
 *
 * ⚠️ **Empate desempata pelo CURSOR, não pela ordem do array.** Com três
 * vendedores zerados, escolher sempre o primeiro do pool faria o primeiro da
 * lista receber tudo — o rodízio deixaria de girar justamente no caso mais
 * comum. O cursor preserva a rotação que já existia.
 *
 * Pura e exportada para ter teste: é regra de números, o erro não gera exceção
 * nenhuma e só aparece como "fulano recebeu tudo de novo" dias depois.
 */
export function escolherPorCarga(
  disponiveis: string[],
  cargas: Map<string, number>,
  poolInteiro: string[],
  /**
   * ⚠️ Quantos ainda ESPERAM neste momento — decresce a cada entrega do lote.
   * Passar a fila inicial infla a cota a cada volta; ver `cotaPorAtendente`.
   */
  filaRestante: number,
  cursor: number,
): string | null {
  if (!disponiveis.length || !poolInteiro.length) return null;
  const carga = (u: string) => cargas.get(u) ?? 0;
  const cota = cotaPorAtendente(poolInteiro.map(carga), filaRestante, poolInteiro.length);
  const cabem = disponiveis.filter((u) => carga(u) < cota);
  if (!cabem.length) return null;
  const menor = Math.min(...cabem.map(carga));
  const empatados = cabem.filter((u) => carga(u) === menor);
  if (empatados.length === 1) return empatados[0];
  /*
   * Roda o pool a partir do cursor e pega o primeiro empatado que aparecer —
   * assim duas chamadas seguidas com todos zerados escolhem pessoas diferentes.
   */
  const n = poolInteiro.length;
  const inicio = ((cursor % n) + n) % n;
  for (let i = 0; i < n; i++) {
    const u = poolInteiro[(inicio + i) % n];
    if (empatados.includes(u)) return u;
  }
  return empatados[0];
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
  /*
   * ⚠️ Passa por `disponiveisOrdered`, não por `onlineOrdered`: o atendente fixo
   * marcado como AUSENTE também não pode receber lead novo. Se este caminho
   * usasse só a presença, o nó de assunto do fluxo entregaria a ele justamente
   * o que o rodízio foi proibido de entregar — e o status pareceria não
   * funcionar em metade dos leads, sem erro nenhum.
   */
  const disponivel = await disponiveisOrdered(db, locationId, [userId]);
  return disponivel.length > 0;
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
    /*
     * 🔴 **Aqui era onde o rodízio escrevia no funil errado.** Pedia "Controle
     * de Leads", que não existia, caía na heurística de etapa (que casou
     * "quente" com "Perdido Quente" do Comercial) e, no limite, em
     * `pipelines[0]` — também o Comercial. Assim a atendente da Secretaria
     * virava dona de card no funil do time comercial, num funil que ela não
     * pode nem ver: 82% dos cards com dono ali eram de fora do time.
     *
     * Nome configurado que não resolve devolve `null`, e `assignLeadTo` apenas
     * NÃO mexe em card nenhum — a conversa continua sendo atribuída
     * normalmente, que é o que importa para o atendimento.
     */
    console.warn(
      `[rodizio] funil "${pipelineName}" não existe — dono do card não foi escrito ` +
        `(nenhum palpite feito). A atribuição da conversa segue normal.`,
    );
    return null;
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

/**
 * O card do funil pode trocar de dono nesta atribuição?
 *
 * 🔴 **Regra do Gabriel (2026-09-10): propriedade NÃO segue a conversa.** O
 * comercial fechou a venda e passou o aluno para a Secretaria falar de
 * documentos — e o "proprietário" virou quem estava atendendo, não quem vendeu.
 * A frase dele é a regra inteira: *"o proprietário é o comercial Rogerio, mas
 * esse contato pode estar conversando com outro"*.
 *
 * ⚠️ **Card SEM dono grava; card COM dono não é sobrescrito.** É a primeira
 * atribuição que define o proprietário; depois dela, só uma PESSOA troca, no
 * seletor do card. Mesmo princípio da 0090 ("decisão humana não se desfaz"),
 * agora valendo também contra a decisão automática que já registrou um dono.
 *
 * ⚠️ **A exceção da DEVOLUÇÃO existe para não congelar um dado falso.** Quando o
 * rodízio tira a conversa de quem não respondeu, aquela pessoa nunca trabalhou o
 * lead — deixar o card no nome dela seria gravar como proprietário justamente
 * quem não atendeu, e ainda distorceria o "Ganhos por atendente" do relatório.
 * Então sobrescreve, mas SÓ quando o dono do card é exatamente quem está
 * perdendo a conversa.
 *
 * ⚠️ `donoAnterior` é parâmetro PRÓPRIO e não o `excluir` do `distributeOne`,
 * que por acaso hoje carrega o mesmo id. Reaproveitar um valor que já tem outro
 * significado é o erro que fez `last_seen_at = NULL` querer dizer três coisas
 * incompatíveis (ver a 202609091100 no AGENTS.md).
 */
export function podeTrocarDonoDoCard(
  donoDoCard: string | null | undefined,
  donoAnterior?: string | null,
): boolean {
  if (!donoDoCard) return true;
  return !!donoAnterior && donoDoCard === donoAnterior;
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
    /**
     * Quem estava com a conversa ANTES desta atribuição.
     *
     * Só a devolução por inatividade preenche: é o que autoriza sobrescrever o
     * dono do card, porque quem está saindo não trabalhou o lead. Ver
     * `podeTrocarDonoDoCard`.
     */
    donoAnterior?: string | null;
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
    .select("id, owner_id")
    .eq("contact_id", p.contactId)
    .eq("pipeline_id", pid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  /*
   * 🔴 Antes era `if (opp) update({ owner_id: userId })` — SEM ler o dono atual.
   * Toda atribuição da conversa reescrevia o proprietário do card, então o
   * vendedor que fechou a venda perdia o lead no instante em que o aluno foi
   * passado para a Secretaria. Ver `podeTrocarDonoDoCard`.
   */
  if (opp && podeTrocarDonoDoCard(opp.owner_id, p.donoAnterior)) {
    await db.from("opportunities").update({ owner_id: userId }).eq("id", opp.id);
  }
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
    /**
     * Carga atual por atendente, compartilhada pelo laço da varredura.
     *
     * ⚠️ É MUTÁVEL de propósito: cada atribuição incrementa o mapa, senão dez
     * leads no mesmo tique iriam todos para a mesma pessoa — a carga dela só
     * mudaria na próxima leitura do banco. Sem o mapa, `distributeOne` lê a
     * carga sozinho (caminho do bot, um lead por vez).
     */
    cargas?: Map<string, number>;
    /**
     * Quantos leads ainda ESPERAM neste instante (este inclusive). Entra na
     * cota; padrão 1.
     *
     * ⚠️ Quem chama num laço tem de DECREMENTAR a cada entrega — a fila inicial
     * repetida infla a cota e devolve o despejo. Ver `cotaPorAtendente`.
     */
    filaRestante?: number;
    /** Números do setor, para medir a carga. Sem eles, a carga é lida do zero. */
    channelIds?: string[];
    /**
     * Quem estava com a conversa antes — repassado ao `assignLeadTo`.
     *
     * ⚠️ NÃO é derivado de `excluir`, embora a devolução passe o mesmo id nos
     * dois: `excluir` responde "quem não pode receber" e este responde "de quem
     * estou tirando". Colar os dois faria qualquer exclusão futura (alguém de
     * férias, por exemplo) autorizar a troca do proprietário sem querer.
     */
    donoAnterior?: string | null;
  },
): Promise<string | null> {
  const { pool, cursor } = await departmentPool(db, args.locationId, args.deptId);
  if (!pool.length) return null; // sem pool/departamento → segura (aguardando)
  const online = await disponiveisOrdered(db, args.locationId, pool);
  // Departamento pode distribuir mesmo pra offline (0083): usa o pool inteiro
  // independente da presença. Senão, o padrão: online primeiro, offline só se
  // todos estiverem offline.
  /*
   * ⚠️ Tolera a coluna nova não existir — o código vai ao ar ANTES da migração e
   * pedir coluna inexistente faz o PostgREST recusar a consulta inteira.
   */
  let dep: any = null;
  {
    const r = await db
      .from("departments")
      .select("rodizio_offline, dividir_igualmente")
      .eq("id", args.deptId)
      .maybeSingle();
    if (r.error) {
      const semColuna = await db
        .from("departments")
        .select("rodizio_offline")
        .eq("id", args.deptId)
        .maybeSingle();
      dep = semColuna.data;
    } else {
      dep = r.data;
    }
  }
  const alwaysAll = dep?.rodizio_offline === true;
  /*
   * 🔴 **A cota é POR SETOR, e não global.** A regra do Gabriel foi dita para o
   * comercial ("distribuir igualmente os leads para todos os vendedores"), e
   * ligá-la em todo mundo mudaria a Secretaria sem ninguém pedir — pior, num
   * sentido perigoso: lá o problema que originou o rodízio foi lead PARADO na
   * fila, e a cota é justamente o que segura lead quando falta gente. A
   * Secretaria já tem a proteção dela contra despejo, que é o ritmo
   * (`intervalo_fila_min`, 1 lead a cada 7 min).
   *
   * Coluna e não nome de setor no código — casar por nome já confundiu setor
   * neste projeto mais de uma vez.
   */
  const porCota = dep?.dividir_igualmente === true;
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
  /*
   * 🔴 **A escolha é por CARGA, não pela vez do cursor.**
   *
   * Relato de 2026-09-10: o Paulo logou primeiro e recebeu os 90 leads que
   * esperavam. O cursor girava, mas girava sobre uma lista de UMA pessoa —
   * rodízio entre um só é despejo. A regra do Gabriel para o comercial é
   * dividir igual entre os três, e `escolherPorCarga` a executa: cada um recebe
   * até a própria cota e o resto espera o dono chegar.
   *
   * ⚠️ Ninguém abaixo da cota devolve `null`, e o lead FICA NA FILA — visível a
   * todos. É a diferença entre "dividir igualmente" e "entregar a quem logou".
   */
  let user: string | null;
  if (porCota) {
    const cargas =
      args.cargas ??
      (await recebidosNoDiaPorAtendente(db, args.locationId, args.channelIds ?? [], pool));
    user = escolherPorCarga(list, cargas, pool, args.filaRestante ?? 1, cursor);
    if (!user) return null;
    // O mapa acompanha a atribuição: o próximo lead do MESMO tique já vê a carga
    // nova e vai para outra pessoa. Sem isso, dez leads seguidos iriam todos
    // para quem estava mais leve na primeira leitura.
    cargas.set(user, (cargas.get(user) ?? 0) + 1);
  } else {
    // Comportamento de sempre nos demais setores: a vez do cursor.
    user = list[cursor % list.length];
  }
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
      donoAnterior: args.donoAnterior,
    },
    user,
    offline,
  );
  return user;
}

/**
 * Distribui uma fração dos leads "aguardando" de um departamento. `fraction`
 * 1 = todos; 0.3 = 30%.
 *
 * 🔴 **Esta função IGNORAVA a cota, e era um despejo à espera de acontecer.**
 * Relato de 2026-09-11: *"o Alberto recebeu todos os leads ao logar hoje"* —
 * mesmo sintoma do Paulo em 10/09, um dia depois de eu ter "resolvido" aquilo.
 *
 * A correção de 10/09 (`escolherPorCarga`) entrou em `distributeOne`, que é o
 * caminho do BOT e o da VARREDURA de minuto. O botão "Distribuir agora" do
 * Relatório não passa por lá: ele fazia `list[(cursor + i) % list.length]`
 * direto. Com uma pessoa online, `list.length` é 1 e o módulo devolve sempre a
 * mesma pessoa — o cursor gira sobre uma lista de um. **É exatamente o defeito
 * que a cota foi escrita para fechar, sobrevivendo no caminho que eu não
 * cobri.** E o botão lê até MIL pendentes de uma vez.
 *
 * ⚠️ A lição, que já é a terceira vez neste arquivo: ao consertar uma regra de
 * distribuição, **conte os caminhos que atribuem** antes de dar por fechado.
 * São três — bot, varredura e este botão —, e é sempre o não coberto que morde.
 *
 * Devolve `{ atribuidas, retidas }`: com a cota, "Todos" pode legitimamente não
 * levar todos, e um número só não distingue "não havia fila" de "a cota segurou
 * o resto até os outros logarem".
 */
export async function distributeDepartment(
  db: any,
  locationId: string,
  deptId: string,
  convs: { id: string; contact_id: string }[],
  fraction: number,
  /**
   * Entregar TUDO a uma pessoa específica, em vez de girar o rodízio.
   *
   * Pedido do Gabriel (2026-09-10): poder escolher para quem vai a fila no botão
   * do Relatório. É ação DELIBERADA de administrador, então ela passa por cima
   * da presença E do status "Ausente" — quem clica está decidindo, e um botão
   * que recusa em silêncio a escolha de quem clicou é pior que não ter o botão.
   * O evento no fio continua marcando "(estava offline)" quando for o caso, para
   * a decisão ficar legível depois.
   *
   * ⚠️ Se a pessoa não estiver no pool DESTE setor, devolve 0 sem escrever nada:
   * distribuir lead de um setor para quem não o atende seria pior que não
   * distribuir. Quem chama soma os zeros e avisa na tela.
   */
  paraUsuario?: string | null,
  /** Números do setor — sem eles não dá para medir a carga de cada atendente. */
  channelIds?: string[],
): Promise<{ atribuidas: number; retidas: number }> {
  if (!convs.length) return { atribuidas: 0, retidas: 0 };
  const { pool, cursor } = await departmentPool(db, locationId, deptId);
  /*
   * 🔴 Era `onlineOrdered`, que olha só a PRESENÇA — então o botão entregava
   * lead novo a quem marcou "Ausente" na barra superior, que é literalmente a
   * pessoa que pediu para não receber (202609101100). `distributeOne` usa
   * `disponiveisOrdered` desde aquele dia; este caminho ficou para trás.
   */
  const online = await disponiveisOrdered(db, locationId, pool);
  if (paraUsuario) {
    if (!pool.includes(paraUsuario)) return { atribuidas: 0, retidas: convs.length };
    const take = Math.min(convs.length, Math.max(1, Math.ceil(convs.length * fraction)));
    for (let i = 0; i < take; i++) {
      await assignLeadTo(
        db,
        {
          conversationId: convs[i].id,
          contactId: convs[i].contact_id,
          locationId,
          pipelineName: "Controle de Leads",
          reason: "escolha do administrador no relatório",
        },
        paraUsuario,
        !online.includes(paraUsuario),
      );
    }
    // ⚠️ O cursor NÃO avança: não houve rodízio. Avançá-lo puniria a próxima
    // pessoa da vez por uma entrega que ela não recebeu.
    /*
     * ⚠️ **A cota NÃO se aplica aqui, de propósito.** Escolher a pessoa no
     * seletor é decisão deliberada de administrador, e ela já passa por cima da
     * presença e do status "Ausente" pelo mesmo motivo: um botão que recusa em
     * silêncio a escolha de quem clicou é pior que não ter o botão.
     */
    return { atribuidas: take, retidas: convs.length - take };
  }
  /*
   * ⚠️ Tolera `dividir_igualmente` não existir — mesmo cuidado de
   * `distributeOne`: o código chega à produção ANTES da migração, e pedir coluna
   * inexistente faz o PostgREST recusar a consulta INTEIRA, o que aqui derrubaria
   * o botão inteiro em vez de apenas ignorar a cota.
   */
  let dep: any = null;
  {
    const r = await db
      .from("departments")
      .select("rodizio_offline, dividir_igualmente")
      .eq("id", deptId)
      .maybeSingle();
    if (r.error) {
      const semColuna = await db
        .from("departments")
        .select("rodizio_offline")
        .eq("id", deptId)
        .maybeSingle();
      dep = semColuna.data;
    } else {
      dep = r.data;
    }
  }
  // Departamento que distribui mesmo offline (0083) usa o pool inteiro.
  const list = dep?.rodizio_offline === true ? pool : online;
  if (!list.length) return { atribuidas: 0, retidas: convs.length };

  const take = Math.min(convs.length, Math.max(1, Math.ceil(convs.length * fraction)));
  const porCota = dep?.dividir_igualmente === true;
  /*
   * ⚠️ Lida UMA vez e mutada a cada entrega — o mesmo mapa compartilhado de
   * `distribuirFilaDoSetor`. Sem incrementar, os até MIL leads deste clique
   * veriam todos a mesma carga inicial e iriam para a mesma pessoa.
   */
  const cargas = porCota
    ? await recebidosNoDiaPorAtendente(db, locationId, channelIds ?? [], pool)
    : null;
  let feitas = 0;
  for (let i = 0; i < take; i++) {
    const conv = convs[i];
    let user: string | null;
    if (porCota && cargas) {
      /*
       * ⚠️ A `fila` da cota é a fila INTEIRA (`convs.length`), não o `take`. Com
       * 90 esperando e três vendedores a cota é 30 por pessoa; medindo só os 27
       * de um clique de "30%" ela cairia para 9 e o botão pararia cedo demais —
       * a mesma razão pela qual a varredura passa prontas + retidas.
       */
      user = escolherPorCarga(list, cargas, pool, convs.length - feitas, cursor + feitas);
      // Ninguém abaixo da cota: o RESTO FICA NA FILA, visível a todos, em vez de
      // ser empurrado para quem já está cheio. "Todos" pode não levar todos.
      if (!user) break;
      cargas.set(user, (cargas.get(user) ?? 0) + 1);
    } else {
      user = list[(cursor + feitas) % list.length];
    }
    await assignLeadTo(
      db,
      {
        conversationId: conv.id,
        contactId: conv.contact_id,
        locationId,
        pipelineName: "Controle de Leads",
        /*
         * 🔴 **O motivo MENTIA.** Sem `reason`, `assignLeadTo` grava o padrão
         * "atribuída pelo bot (origem não informada)" — e o fio dizia BOT numa
         * atribuição que veio de um clique de administrador. Foi essa lacuna que
         * me obrigou a DEDUZIR, em vez de ler, qual caminho despejou os leads no
         * Alberto. Mesma armadilha do padrão "rodízio do bot" em 02/09.
         */
        reason: "distribuição pelo relatório (rodízio)",
      },
      user,
      !online.includes(user),
    );
    feitas++;
  }
  // ⚠️ Avança pelo que REALMENTE foi entregue, não pelo `take`: parando na cota,
  // somar o `take` puniria quem nunca recebeu.
  await db.from("departments").update({ rr_cursor: cursor + feitas }).eq("id", deptId);
  return { atribuidas: feitas, retidas: convs.length - feitas };
}

export { statusForStageName };

/* ------------------------------------------------------------------ *
 * Devolver conversa parada ao rodízio
 * ------------------------------------------------------------------ */

/**
 * Teto da devolução, em minutos ÚTEIS: passado disto, o rodízio NÃO mexe.
 *
 * ⚠️ **Um dia útil (660 min = 8h–19h).** A devolução existe para o caso "o
 * atendente não está respondendo AGORA" — reatribuir resolve isso. Uma conversa
 * parada há três semanas é BACKLOG, e reatribuir não resolve nada: só move um
 * abandono entre pessoas e enche o fio de eventos.
 *
 * O número saiu de medida, não de gosto: na primeira execução com as regras
 * novas, 24 conversas seriam devolvidas e **19 delas esperavam mais de um dia
 * útil** — algumas desde 21/08. Sem o teto, religar a devolução despejaria três
 * semanas de abandono na caixa dos 3 atendentes online, de uma vez.
 *
 * Para o backlog o instrumento certo é a aba Atendimento (0079) e a fila do
 * setor, que mostram o problema; o rodízio não avisa ninguém, só reatribui.
 */
const DEVOLVER_TETO_MIN = 660;

/** Uma linha de `public.conversas_paradas` (202609081345). */
export type LinhaParada = {
  conversation_id: string;
  contact_id: string;
  assigned_to: string | null;
  /** Quem atribuiu. **NULL = o sistema.** Preenchido pelo gatilho `marca_quem_atribuiu`. */
  assigned_by: string | null;
  channel_id: string | null;
  /** Quando o rodízio devolveu esta conversa da última vez. */
  devolvida_em: string | null;
  /** Última mensagem DO CLIENTE — a âncora da espera. */
  ultima_do_cliente: string | null;
  espera_util_min: number | string;
  /** O bot triou esta conversa? Ver a regra em `devolvivel`. */
  passou_pelo_bot: boolean | null;
  /**
   * Alguém já respondeu esta conversa ALGUMA VEZ? (202609092030)
   *
   * ⚠️ Opcional de propósito: neste projeto o código vai ao ar ANTES da
   * migração, então até ela ser aplicada o campo chega `undefined` — e
   * `undefined` cai no comportamento de hoje em vez de travar a devolução
   * inteira.
   */
  ja_respondida?: boolean | null;
  /**
   * Minutos ÚTEIS que a conversa está com o responsável ATUAL (202609101830).
   *
   * ⚠️ Opcional: até a migração ser aplicada chega `undefined`, e aí a SQL
   * também não filtra por ela — o comportamento é o de hoje.
   */
  minutos_com_atendente?: number | string | null;
};

/**
 * Esta conversa pode ser devolvida ao rodízio?
 *
 * 🔴 **Cada `return false` aqui é um defeito que ACONTECEU em produção**, em 11
 * minutos do dia 2026-09-08 (150 eventos, 13 conversas). A função existe
 * separada e exportada para que as quatro regras tenham teste: elas são
 * invisíveis em revisão de código e o estrago só aparece no fio do cliente.
 *
 * A pergunta que a SQL já respondeu: "a bola está com a gente há mais de N
 * minutos úteis?" A que sobra aqui é: "e mesmo assim, devo mexer?"
 */
export function devolvivel(
  l: LinhaParada,
  channelIds: string[],
  /** Limite do setor, em minutos úteis. Sem ele, a janela não é conferida aqui. */
  limiteMin?: number,
): boolean {
  // Sem dono não é devolução: é fila, e quem cuida dela é `distribuirFilaDoSetor`.
  // Devolver para a fila quem já está na fila seria um evento por tique, para
  // sempre.
  if (!l.assigned_to) return false;

  // A conversa tem de ser deste setor. Sem isto o rodízio de um setor mexeria em
  // conversa de outro número.
  if (!l.channel_id || !channelIds.includes(l.channel_id)) return false;

  /*
   * 🔴 **O rodízio só retoma o que o RODÍZIO deu.**
   *
   * `assigned_by` não nulo = uma PESSOA pôs a conversa ali (transferiu, assumiu,
   * supervisão puxou). Medido: uma conversa transferida à mão de Jenifer para
   * Paulo Lopes — que é de outro setor e outro número — foi arrancada dele e
   * jogada de volta no rodízio da Secretaria, e depois passou por Jenifer,
   * Daniel e Beatriz, um por minuto.
   *
   * O princípio já estava escrito neste repositório, na 0090 ("decisão humana
   * não se desfaz"); só não havia sido aplicado aqui. E é também a regra que o
   * Gabriel deu: conversa transferida não volta para a fila, porque foi para
   * outro atendente e geralmente para outro número.
   */
  if (l.assigned_by) return false;

  /*
   * 🔴 **Uma devolução por mensagem NOVA do cliente — não uma por minuto.**
   *
   * Era o laço: reatribuir não faz o cliente ser respondido, então a condição
   * continuava verdadeira no tique seguinte. Exigir que o cliente tenha escrito
   * DEPOIS do último carimbo dá à devolução a memória que faltava, e amarra a
   * repetição a um evento real do mundo em vez de ao relógio.
   *
   * ⚠️ Sem `ultima_do_cliente` não há como comparar — e, na dúvida, NÃO mexer é
   * o lado seguro: o custo é uma conversa parada continuar com quem está; o
   * outro lado é o laço.
   */
  if (l.devolvida_em) {
    if (!l.ultima_do_cliente) return false;
    if (new Date(l.devolvida_em) >= new Date(l.ultima_do_cliente)) return false;
  }

  /*
   * 🔴 **A JANELA DO ATENDENTE: quem acabou de receber não pode perder.**
   *
   * Fio real de 2026-09-10: o lead esperou 3h na fila (ninguém online), foi
   * entregue à Beatriz às 10:35 e devolvido às 10:36 — ela teve UM MINUTO. A
   * espera do CLIENTE já era 156 min antes de ela existir na história, e era só
   * essa conta que a devolução olhava.
   *
   * ⚠️ Segunda barreira: a SQL já filtra por `minutos_com_atendente >= limite`.
   * Está repetido aqui porque o limite é por setor e esta função é a camada
   * testável — e porque a mesma devolução já misturou "o cliente espera demais"
   * com "este atendente falhou" uma vez.
   *
   * ⚠️ Sem o carimbo (`undefined`/null) NÃO bloqueia: a coluna é nova e, enquanto
   * a migração não for aplicada, bloquear aqui desligaria a devolução inteira.
   */
  if (l.minutos_com_atendente != null && limiteMin != null) {
    const comAtendente = Number(l.minutos_com_atendente);
    if (Number.isFinite(comAtendente) && comAtendente < limiteMin) return false;
  }

  /*
   * 🔴 **A devolução vale só ATÉ A PRIMEIRA RESPOSTA.**
   *
   * Regra do Gabriel (2026-09-09): o lead que ninguém respondeu em 15 minutos
   * passa para outro; mas, **uma vez que o atendente mandou mensagem, a conversa
   * é dele e não volta ao rodízio** — o cliente responde quando puder, e o
   * vendedor não tem como ficar de plantão no relógio.
   *
   * ⚠️ É a regra que substitui o desligamento do comercial (202609081346): em
   * vez de tirar a devolução de um setor inteiro, ela recorta o que a devolução
   * nunca deveria ter tocado. O que circula passa a ser só o lead SEM
   * atendimento nenhum — que é exatamente o caso que criou o rodízio.
   *
   * ⚠️ Nota interna e resposta do BOT não contam como resposta: quem decide isso
   * é a SQL (`ja_respondida` exclui `automated` e `internal`), senão toda
   * conversa pareceria atendida em segundos pelo auto-responder.
   */
  if (l.ja_respondida) return false;

  /*
   * ⚠️ **Teto**: passado um dia útil, isto é backlog e não "o atendente não
   * respondeu agora". Ver `DEVOLVER_TETO_MIN` — sem o teto, religar a devolução
   * despejaria 19 conversas abandonadas (a mais velha de 21/08) na caixa de quem
   * está online.
   */
  if (Number(l.espera_util_min) > DEVOLVER_TETO_MIN) return false;

  /*
   * 🔴 **Quem não passou pelo bot não entra no rodízio.** Regra do Gabriel: o
   * rodízio existe para o lead que o bot triou (nome, e-mail, assunto).
   * Conversa aberta pelo próprio CRM ("Nova conversa"), contato de antes da
   * integração ou abordagem nossa não são lead de fila — e distribuí-los põe na
   * caixa de alguém uma conversa sem contexto nenhum.
   *
   * Medido: das 299 conversas abertas, **135 (45%) nunca passaram pelo bot**, 77
   * delas sem o cliente ter escrito uma linha.
   *
   * ⚠️ Hoje isto não muda nenhuma devolução (6 antes, 6 depois) — o que o
   * sistema atribui já vem do bot. Está aqui como GARANTIA: a própria devolução
   * põe conversa na fila, e sem a regra bastaria um caminho novo marcar a flag
   * para conversa sem contexto começar a circular.
   */
  if (!l.passou_pelo_bot) return false;

  return true;
}

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

  /*
   * ⚠️ Tolera a coluna nova não existir: o código vai ao ar ANTES da migração, e
   * pedir coluna inexistente faz o PostgREST recusar a consulta INTEIRA — a
   * devolução pararia. Sem ela, `undefined` cai no comportamento de hoje.
   */
  let deps: any[] | null = null;
  {
    const r = await db
      .from("departments")
      .select("id, devolver_apos_min, usa_rodizio, devolver_so_com_todos_online")
      .eq("location_id", locationId);
    if (r.error) {
      const semColuna = await db
        .from("departments")
        .select("id, devolver_apos_min, usa_rodizio")
        .eq("location_id", locationId);
      deps = semColuna.data;
    } else {
      deps = r.data;
    }
  }

  for (const dep of deps ?? []) {
    const limite = Number(dep.devolver_apos_min ?? 0);
    if (!limite || dep.usa_rodizio === false) continue;

    /*
     * 🔴 **Só devolve com o time INTEIRO disponível** (regra do Gabriel,
     * 2026-09-10, para o comercial): tirar o lead de um vendedor quando falta
     * gente não resolve nada — ele só muda de mão para cair em quem já está
     * absorvendo o setor sozinho, que é o despejo por outro caminho.
     *
     * ⚠️ "Disponível" aqui é presença **E** status: quem está no CRM marcado
     * como AUSENTE não conta como um par de mãos para receber. Se contasse, a
     * devolução ligaria com base em alguém que o rodízio nem pode escolher, e a
     * conversa voltaria para a fila sem destino.
     *
     * É uma COLUNA e não o nome do setor no código — casar por nome já confundiu
     * setor neste projeto mais de uma vez.
     */
    /*
     * 🔴 **"Só com todos online" CONGELAVA a devolução** (medido em 2026-09-10,
     * relatado como urgente: leads da noite anterior parados com um vendedor que
     * não respondia, e nada acontecia).
     *
     * A regra do Gabriel era *"deixar a devolução apenas quando os 3 vendedores
     * estiverem online"*, e a INTENÇÃO dela é clara e continua valendo: não tirar
     * a conversa de alguém quando não há para quem dar — senão ela só muda de mão
     * para cair em quem já está segurando o setor sozinho.
     *
     * ⚠️ Mas exigir o time INTEIRO faz a regra depender da coincidência de três
     * presenças ao mesmo tempo. Um de férias, um em reunião, um que fechou o CRM
     * mais cedo — e a devolução não roda mais nunca, sem erro, sem aviso. Foi
     * exatamente o que aconteceu.
     *
     * A condição passa a ser a intenção literal: **existe OUTRA pessoa
     * disponível para receber?** Com dois trabalhando a devolução funciona; com
     * um só, ela para (que é o caso em que ela não resolveria nada mesmo).
     *
     * ⏳ O NOME da coluna virou dívida — `devolver_so_com_todos_online` já não
     * descreve o que ela faz. Não foi renomeada no meio de um incidente: ela
     * segue sendo o interruptor liga/desliga desta trava, e renomear coluna
     * quando o código no ar depende dela é como o envio quebrou em 01/09.
     */
    if (dep.devolver_so_com_todos_online === true) {
      const { pool } = await departmentPool(db, locationId, dep.id);
      const disponiveis = await disponiveisOrdered(db, locationId, pool);
      if (disponiveis.length < 2) continue;
    }

    const { data: dcs } = await db
      .from("department_channels")
      .select("channel_id")
      .eq("department_id", dep.id);
    const channelIds = (dcs ?? []).map((d: any) => d.channel_id);
    if (!channelIds.length) continue;

    /*
     * 🔴 **Duas trocas de função em um dia, e a segunda é a que importa.**
     *
     * Era `sla_conversations`, que é um NO-OP para a service role (a guarda de
     * empresa devolve zero linhas, sem erro — em 11 dias no ar, zero devoluções
     * e o tique respondendo `200 {"devolvidas":0}` com cara de saúde).
     *
     * Passou a ser `conversas_esperando`, que fez a devolução RODAR — e aí os
     * defeitos latentes dela apareceram em 11 minutos de produção. Agora é
     * `conversas_paradas` (202609081345), que ancora na ÚLTIMA mensagem do
     * cliente em vez da primeira de uma janela de 7 dias. A âncora antiga
     * inflava (688 min reportados para quem esperava 137) e APAGAVA (0 min para
     * quem esperava 3.301, porque a mensagem saiu da janela).
     */
    const { data: linhas, error } = await db.rpc("conversas_paradas", {
      p_location: locationId,
      p_limite_min: limite,
    });
    if (error) {
      /*
       * ⚠️ Neste projeto o CÓDIGO vai ao ar antes da migração, então esta função
       * pode ainda não existir. Avisar e seguir é o certo: a varredura da fila
       * não depende de SQL novo e continua trabalhando.
       */
      console.warn("[rodizio] não deu para ler a espera:", error.message);
      continue;
    }

    const parados = (linhas ?? []).filter((l: any) =>
      devolvivel(l, channelIds, limite),
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
          /*
           * 🔴 **A MEMÓRIA que faltava, e sem ela nada mais importa.** Devolver
           * não faz o cliente ser respondido: no tique seguinte a conversa
           * continuava parada e ela devolvia de novo — 150 eventos em 11
           * minutos, um ciclo por minuto, com o fio virando uma escada de
           * "Devolvida · Atribuída a X · Devolvida · Atribuída a Y".
           *
           * Com o carimbo, `devolvivel()` exige que o CLIENTE tenha escrito
           * depois dele: uma devolução por mensagem nova do cliente, não por
           * minuto.
           */
          devolvida_em: new Date().toISOString(),
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
        /*
         * ⚠️ Autoriza o card a trocar de dono NESTE caso e só nele: quem não
         * respondeu não trabalhou o lead, e deixar o card no nome dela gravaria
         * como proprietário exatamente quem não atendeu. Ver
         * `podeTrocarDonoDoCard`.
         */
        donoAnterior: anterior,
        channelIds,
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

  const ids = fila.map((c: any) => c.id);
  const { data: sessoes } = await db
    .from("bot_sessions")
    .select("conversation_id, status")
    .in("conversation_id", ids);
  const emTriagem = new Set(
    (sessoes ?? [])
      .filter((s: any) => s.status === "aguardando" || s.status === "ativo")
      .map((s: any) => s.conversation_id),
  );
  const comSessao = new Set((sessoes ?? []).map((s: any) => s.conversation_id));

  /*
   * 🔴 **Quem não passou pelo bot NÃO é distribuído.** Regra do Gabriel: o
   * rodízio existe para o lead que o bot triou. Conversa aberta pelo próprio CRM
   * ("Nova conversa"), contato de antes da integração ou abordagem nossa não são
   * lead de fila — distribuí-los põe na caixa de alguém uma conversa sem
   * contexto nenhum, e ainda tira o atendente do rodízio para o lead seguinte.
   *
   * Medido: das 299 conversas abertas, **135 (45%) nunca passaram pelo bot** — 77
   * delas sem o cliente ter escrito uma linha.
   *
   * ⚠️ **Dois sinais, unidos por OR, porque nenhum sozinho basta:** a sessão do
   * bot é APAGADA quando uma conversa finalizada reabre (o webhook a zera para
   * triar de novo), então a ausência dela não prova que o bot nunca falou; e uma
   * sessão recém-criada pode existir antes da primeira palavra do bot. Medidos
   * neste banco, os dois concordaram em 164 de 164 — o OR é a rede de borda.
   */
  const { data: automatizadas } = await db
    .from("messages")
    .select("conversation_id")
    .in("conversation_id", ids)
    .eq("direction", "out")
    .eq("automated", true);
  const botFalou = new Set((automatizadas ?? []).map((m: any) => m.conversation_id));

  const prontas = fila.filter(
    (c: any) => !emTriagem.has(c.id) && (comSessao.has(c.id) || botFalou.has(c.id)),
  );
  return { prontas, retidas: fila.length - prontas.length };
}

/** O que a varredura sabe do setor para decidir o ritmo. */
export type RitmoDoSetor = {
  /** Minutos entre um lead e o próximo. 0 = sem intervalo. */
  intervalo_fila_min?: number | string | null;
  /** Quando a varredura entregou o último lead deste setor. */
  ultima_da_fila_em?: string | null;
};

/**
 * Quantos leads este setor pode receber NESTE tique.
 *
 * 🔴 Regra do Gabriel (2026-09-09), depois de a varredura despejar a fila
 * inteira em quem logou primeiro: **um por vez, e depois aguarda.** A pausa é a
 * janela para outro atendente logar e entrar no rodízio — sem ela, quem abre o
 * CRM às 8h leva o acumulado da noite e quem chega às 8h30 não encontra nada.
 *
 * Devolve `0` (ainda no intervalo), `1` (setor com intervalo, liberado) ou o
 * teto normal do tique (setor sem intervalo — o comportamento de todos os
 * outros, que não muda).
 *
 * ⚠️ Função PURA e exportada só para ter teste: a regra é de relógio, depende
 * de quando o tique roda, e um erro aqui não dá erro nenhum — só reparte os
 * leads errado, que é invisível até alguém reclamar. Foi assim que este defeito
 * chegou à produção.
 */
export function limiteDoTique(dep: RitmoDoSetor, agora = Date.now()): number {
  const intervalo = Number(dep.intervalo_fila_min ?? 0);
  // Setor sem intervalo configurado segue como sempre foi.
  if (!Number.isFinite(intervalo) || intervalo <= 0) return FILA_POR_TIQUE;
  // Nunca entregou nada: pode entregar o primeiro agora.
  if (!dep.ultima_da_fila_em) return 1;
  const ultima = new Date(dep.ultima_da_fila_em).getTime();
  /*
   * ⚠️ Data inválida vira `NaN`, e `NaN < x` é FALSO — o que liberaria a
   * entrega. Aqui o lado seguro é liberar mesmo: segurar a fila para sempre por
   * causa de um carimbo corrompido é pior que entregar um lead a mais.
   */
  if (Number.isNaN(ultima)) return 1;
  return agora - ultima >= intervalo * 60_000 ? 1 : 0;
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

  /*
   * ⚠️ **O código vai ao ar ANTES da migração** neste projeto (deploy automático
   * no merge, migração à mão). Pedir colunas que ainda não existem faz o
   * PostgREST recusar a consulta INTEIRA — e a varredura pararia de esvaziar a
   * fila, que é o oposto do que ela existe para fazer. Foi assim que o envio
   * quebrou em 01/09. Tenta com as colunas do ritmo; falhando, refaz sem elas e
   * segue no comportamento antigo.
   */
  let deps: any[] | null = null;
  let temRitmo = true;
  {
    const r = await db
      .from("departments")
      .select("id, usa_rodizio, intervalo_fila_min, ultima_da_fila_em")
      .eq("location_id", locationId);
    if (r.error) {
      temRitmo = false;
      const semRitmo = await db
        .from("departments")
        .select("id, usa_rodizio")
        .eq("location_id", locationId);
      deps = semRitmo.data;
    } else {
      deps = r.data;
    }
  }

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

    /*
     * ⚠️ Lê a fila INTEIRA (até o teto) mesmo quando só vai entregar uma. É o
     * que mantém `naFila` verdadeiro — e `naFila` é o número que diz se o
     * rodízio está dando conta. Contar só o que foi entregue faria uma fila
     * represada de 20 leads parecer "0 na fila".
     */
    const { prontas, retidas } = await filaProntaDoSetor(db, locationId, channelIds, FILA_POR_TIQUE);
    naFila += retidas;
    if (!prontas.length) continue;

    /*
     * 🔴 O RITMO. Setor com `intervalo_fila_min` entrega UMA por vez e espera —
     * a pausa é a janela para outro atendente logar. Sem intervalo (todos os
     * outros setores), nada muda.
     */
    // ⚠️ Lido UMA vez e reusado no carimbo lá embaixo. Reavaliar o relógio
    // depois de distribuir daria respostas diferentes na mesma passagem.
    const intervalo = temRitmo ? Number(dep.intervalo_fila_min ?? 0) : 0;
    const cabem = intervalo > 0 ? limiteDoTique(dep) : FILA_POR_TIQUE;
    if (cabem === 0) {
      // Ainda dentro do intervalo: a fila fica, inteira e visível a todos.
      naFila += prontas.length;
      continue;
    }
    // `prontas` já vem com o que espera HÁ MAIS TEMPO primeiro (a consulta
    // ordena por `last_message_at` crescente) — é literalmente a regra pedida.
    const aEntregar = prontas.slice(0, cabem);
    naFila += prontas.length - aEntregar.length;

    // ⚠️ Contador POR SETOR. Usar o acumulador `distribuidas` para calcular o
    // resto desta fila daria número errado a partir do segundo setor com fila.
    let feitasAqui = 0;
    /*
     * ⚠️ Carga lida UMA vez por setor e compartilhada pelo laço — e a `fila` é a
     * fila INTEIRA (prontas + retidas), não só o que cabe neste tique. É a fila
     * inteira que entra na cota: com 90 esperando e três vendedores, a cota é 30
     * por pessoa; contando só as 25 do teto do tique, ela seria 8 e o rodízio
     * pararia cedo demais.
     */
    const { pool: poolDoSetor } = await departmentPool(db, locationId, dep.id);
    const cargas = await recebidosNoDiaPorAtendente(db, locationId, channelIds, poolDoSetor);
    const filaTotal = prontas.length + retidas;
    for (const conv of aEntregar) {
      const user = await distributeOne(db, {
        locationId,
        deptId: dep.id,
        conversationId: conv.id,
        contactId: conv.contact_id,
        pipelineName: "Controle de Leads",
        reason: "varredura da fila do setor",
        cargas,
        // 🔴 DECRESCE. Com `filaTotal` fixo aqui, cada entrega inflava a cota em
        // 1/pool e a pessoa online nunca batia no teto — o despejo de 10 e 11/09.
        filaRestante: filaTotal - feitasAqui,
        channelIds,
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
        naFila += aEntregar.length - feitasAqui;
        break;
      }
    }
    distribuidas += feitasAqui;

    /*
     * ⚠️ Carimba só se ENTREGOU. Marcar sempre faria um tique em que ninguém
     * está online reiniciar o relógio, e a fila esperaria mais 7 minutos por
     * nada — a espera existe para dar chance a outro atendente logar, não para
     * punir a fila quando não há ninguém.
     */
    if (intervalo > 0 && feitasAqui > 0) {
      await db
        .from("departments")
        .update({ ultima_da_fila_em: new Date().toISOString() })
        .eq("id", dep.id);
    }
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
