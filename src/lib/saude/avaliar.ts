/**
 * Regras da tela Configurações → Saúde: o que é "ok", "atenção" e "falha".
 *
 * Funções puras, separadas da rota, para terem teste (`npm run test:saude`):
 * regra de limiar errada não dá erro nenhum — só pinta de verde o que está
 * quebrado, que é o oposto do que a tela existe para fazer.
 */

export type Status = "ok" | "atencao" | "falha" | "info";

export interface Checagem {
  id: string;
  grupo: string;
  nome: string;
  status: Status;
  /** Uma linha: o número que importa. */
  resumo: string;
  /** O que fazer / de onde vem, quando não está ok. */
  detalhe?: string;
}

const ORDEM: Record<Status, number> = { falha: 3, atencao: 2, ok: 1, info: 0 };

/** O pior status de uma lista — é o que pinta o grupo e o topo da tela. */
export function piorStatus(lista: Status[]): Status {
  let pior: Status = "ok";
  for (const s of lista) if (ORDEM[s] > ORDEM[pior]) pior = s;
  return pior;
}

/**
 * De quanto em quanto tempo (minutos) um cron deveria rodar. Só entende os
 * formatos usados neste projeto; `null` = não sei dizer, e aí a tela não acusa
 * atraso — acusar sem saber é o falso alarme que ensina a ignorar a tela.
 */
export function intervaloDoCron(agenda: string): number | null {
  const p = agenda.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [min, hora, dia, mes, sem] = p;
  if (dia !== "*" || mes !== "*" || sem !== "*") return null;
  if (hora === "*") {
    if (min === "*") return 1;
    const passo = /^\*\/(\d+)$/.exec(min);
    if (passo) return Number(passo[1]);
    if (/^\d+$/.test(min)) return 60;
    return null;
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hora)) return 1440;
  return null;
}

export function minutosDesde(iso: string | null | undefined, agora = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (agora - t) / 60000);
}

export function avaliarCron(
  c: { nome: string; agenda: string; ativo: boolean; ultimo_inicio: string | null; ultimo_status: string | null; mensagem?: string },
  agora = Date.now()
): { status: Status; resumo: string; detalhe?: string } {
  if (!c.ativo) return { status: "atencao", resumo: "pausado", detalhe: "O job está desativado no pg_cron." };
  const desde = minutosDesde(c.ultimo_inicio, agora);
  if (desde === null) return { status: "atencao", resumo: "nunca rodou" };
  const quando = `última execução ${formatarMinutos(desde)}`;
  if (c.ultimo_status === "failed") {
    return { status: "falha", resumo: `falhou · ${quando}`, detalhe: c.mensagem || undefined };
  }
  const intervalo = intervaloDoCron(c.agenda);
  // Folga de 3 intervalos (mínimo 5 min): um tique perdido não é incidente.
  if (intervalo !== null && desde > Math.max(5, intervalo * 3)) {
    return { status: "falha", resumo: `parado · ${quando}`, detalhe: `Deveria rodar a cada ${intervalo} min.` };
  }
  return { status: "ok", resumo: quando };
}

/**
 * Respostas HTTP das rotas chamadas pelos crons (últimos 15 min).
 * "sem resposta" (NULL) é o pg_net desistindo de esperar após 8 s enquanto a
 * rota segue rodando — normal nos tiques longos, por isso não é falha.
 */
export function avaliarHttp(porStatus: Record<string, number>): { status: Status; resumo: string; detalhe?: string } {
  let ok = 0, ruins = 0, semResposta = 0;
  const codigos: string[] = [];
  for (const [codigo, n] of Object.entries(porStatus)) {
    if (codigo === "sem resposta") semResposta += n;
    else if (Number(codigo) >= 400) { ruins += n; codigos.push(`${codigo}×${n}`); }
    else ok += n;
  }
  const total = ok + ruins + semResposta;
  if (total === 0) return { status: "falha", resumo: "nenhuma chamada nos últimos 15 min", detalhe: "Os crons não estão disparando." };
  const resumo = `${ok} ok · ${ruins} com erro · ${semResposta} sem resposta (15 min)`;
  if (ruins > 0) {
    const dica = codigos.some((c) => c.startsWith("401"))
      ? "401 = segredo do cron diferente do da Vercel (AUTOMATION_SECRET / GURU_SYNC_SECRET)."
      : codigos.some((c) => c.startsWith("404"))
        ? "404 = a URL do cron aponta para um domínio que não serve o CRM."
        : `Códigos: ${codigos.join(", ")}.`;
    return { status: ok === 0 ? "falha" : "atencao", resumo, detalhe: dica };
  }
  return { status: "ok", resumo };
}

export function porLimite(
  valor: number,
  atencao: number,
  falha: number
): Status {
  if (valor >= falha) return "falha";
  if (valor >= atencao) return "atencao";
  return "ok";
}

export function formatarMinutos(min: number): string {
  if (min < 1) return "agora";
  if (min < 60) return `há ${Math.round(min)} min`;
  if (min < 1440) return `há ${(min / 60).toFixed(1).replace(".", ",")} h`;
  return `há ${Math.round(min / 1440)} d`;
}

/**
 * Recusas da Meta que NÃO são defeito do sistema: a regra da plataforma ou o
 * destinatário recusou. Pintar a tela de vermelho por elas esconderia a falha
 * de verdade (token, conta, cobrança) atrás de ruído do dia a dia.
 */
const RECUSA_POR_REGRA: Record<string, string> = {
  "131047": "janela de 24h fechada (só template)",
  "131049": "limite de marketing do destinatário",
  "131026": "número sem WhatsApp / não entregável",
  "131050": "cliente parou de receber marketing",
  "130472": "experimento da Meta (não entregue)",
  "131021": "destinatário é o próprio número",
};

export type TipoFalhaWa = "regra" | "sistema";

/** Classifica o `error_detail` gravado no balão pelo código `#NNNNNN` da Meta. */
export function classificarFalhaWhatsapp(detalhe: string | null | undefined): {
  tipo: TipoFalhaWa;
  codigo: string | null;
  rotulo: string;
} {
  const codigo = /#(\d{5,6})\b/.exec(detalhe ?? "")?.[1] ?? null;
  if (codigo && RECUSA_POR_REGRA[codigo]) {
    return { tipo: "regra", codigo, rotulo: RECUSA_POR_REGRA[codigo] };
  }
  return { tipo: "sistema", codigo, rotulo: codigo ? `#${codigo}` : "sem código" };
}
