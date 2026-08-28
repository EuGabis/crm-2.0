/**
 * Resposta automática com janela de tempo.
 *
 * Decide, para um instante, QUAL mensagem automática se aplica — ou nenhuma.
 *
 * ⚠️ **Em TypeScript e não em função SQL, de propósito.** A regra tem três
 * armadilhas (virada de meia-noite, fuso e "qual das duas janelas ganha") e
 * nenhuma delas é óbvia à leitura. Em TS ela é uma função pura, coberta por
 * teste; em SQL eu não teria como executá-la antes de mandar para produção — e
 * este projeto já pagou caro por lógica que parecia certa e não foi rodada.
 */

/** Fuso do negócio, o mesmo do expediente do SLA (0079). */
const FUSO = "America/Sao_Paulo";

export type TipoJanela = "recorrente" | "periodo";

export interface AutoResposta {
  id: string;
  nome: string;
  mensagem: string;
  ativo: boolean;
  tipo: TipoJanela;
  channelId: string | null;
  /** 0=domingo … 6=sábado. Vazio = todos os dias. */
  diasSemana: number[] | null;
  /** "HH:MM" ou "HH:MM:SS". */
  horaInicio: string | null;
  horaFim: string | null;
  inicioEm: string | null;
  fimEm: string | null;
}

/** Minutos desde a meia-noite, no fuso do negócio, e o dia da semana local. */
function agoraLocal(quando: Date): { minutos: number; diaSemana: number } {
  /*
   * ⚠️ `Intl` e não `getHours()`. O servidor da Vercel roda em UTC: às 21h de
   * Brasília, `getHours()` devolveria 0 (meia-noite do dia seguinte) e uma janela
   * "19h às 8h" pareceria fechada justamente quando devia estar aberta. É o mesmo
   * cuidado que `private.business_minutes` (0079) toma no lado do banco.
   */
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const partes = Object.fromEntries(fmt.formatToParts(quando).map((p) => [p.type, p.value]));
  const dias = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // `hour` pode vir "24" em algumas implementações para meia-noite.
  const h = Number(partes.hour) % 24;
  return {
    minutos: h * 60 + Number(partes.minute),
    diaSemana: Math.max(0, dias.indexOf(String(partes.weekday))),
  };
}

/** "19:00" / "19:00:00" → minutos desde a meia-noite. */
function paraMinutos(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":");
  const n = Number(h) * 60 + Number(m ?? 0);
  return Number.isFinite(n) ? n : null;
}

function valeAgoraRecorrente(r: AutoResposta, quando: Date): boolean {
  const ini = paraMinutos(r.horaInicio);
  const fim = paraMinutos(r.horaFim);
  if (ini === null || fim === null) return false;
  const { minutos, diaSemana } = agoraLocal(quando);

  /*
   * ⚠️ **A janela que VIRA A MEIA-NOITE é o caso normal aqui, não a exceção.**
   * "Fora do expediente" é 19h → 8h, ou seja `fim <= ini`. Tratada como intervalo
   * comum (`minutos >= ini && minutos < fim`), ela nunca seria verdadeira e o bot
   * simplesmente não responderia nunca — sem erro nenhum, o que é o pior tipo de
   * defeito.
   *
   * ⚠️ E o DIA DA SEMANA é o do INÍCIO da janela. Numa janela 19h→8h marcada para
   * sexta, 1h da manhã já é sábado no relógio: conferir o dia do instante atual
   * cortaria a madrugada de sexta para sábado, que é justamente quando a mensagem
   * mais importa.
   */
  const viraMeiaNoite = fim <= ini;
  const dentro = viraMeiaNoite ? minutos >= ini || minutos < fim : minutos >= ini && minutos < fim;
  if (!dentro) return false;

  const dias = r.diasSemana;
  if (!dias || dias.length === 0) return true;
  const diaDaJanela =
    viraMeiaNoite && minutos < fim ? (diaSemana + 6) % 7 : diaSemana; // recua um dia
  return dias.includes(diaDaJanela);
}

function valeAgoraPeriodo(r: AutoResposta, quando: Date): boolean {
  if (!r.inicioEm || !r.fimEm) return false;
  const t = quando.getTime();
  const ini = new Date(r.inicioEm).getTime();
  const fim = new Date(r.fimEm).getTime();
  if (!Number.isFinite(ini) || !Number.isFinite(fim)) return false;
  // Fim EXCLUSIVO: "até 02/01 08:00" significa que às 8h em ponto já atende
  // normalmente. Inclusivo faria o bot responder um minuto depois da volta.
  return t >= ini && t < fim;
}

/**
 * Qual resposta automática se aplica agora — ou `null`.
 *
 * ⚠️ **Período ganha de recorrente**, e essa é a regra que o Gabriel definiu ao
 * escolher "os dois": quando as duas janelas coincidem, "estamos em recesso" é
 * mais específico que "fora do expediente". Sem uma ordem explícita, qual venceria
 * dependeria da ordem de leitura no banco — e mudaria sozinha um dia.
 *
 * Entre duas do mesmo tipo, ganha a MAIS ESPECÍFICA: a amarrada a um número
 * vence a que vale para a empresa inteira.
 */
export function respostaAplicavel(
  regras: AutoResposta[],
  channelId: string | null,
  quando: Date = new Date(),
): AutoResposta | null {
  const candidatas = regras.filter(
    (r) =>
      r.ativo &&
      (r.channelId === null || r.channelId === channelId) &&
      (r.tipo === "periodo" ? valeAgoraPeriodo(r, quando) : valeAgoraRecorrente(r, quando)),
  );
  if (candidatas.length === 0) return null;

  const peso = (r: AutoResposta) => (r.tipo === "periodo" ? 2 : 0) + (r.channelId ? 1 : 0);
  return candidatas.reduce((melhor, r) => (peso(r) > peso(melhor) ? r : melhor));
}
