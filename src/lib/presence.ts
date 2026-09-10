/**
 * Janela de presença: quem carimbou `location_members.last_seen_at` dentro dela
 * conta como ONLINE.
 *
 * ⚠️ Mora aqui, e não em `lib/leads/distribution.ts`, porque quem precisa dela
 * são os DOIS lados: o rodízio (servidor) e as telas que mostram quem está
 * recebendo lead (cliente). Importar o módulo do rodízio numa página cliente
 * arrastaria o cliente de service role para o pacote do navegador — o mesmo
 * cuidado que fez `telHref` sair para `lib/phone.ts`.
 *
 * ⚠️ **Um número só.** Eram dois — 5 min na tela de Departamentos e 15 no
 * rodízio —, e isso produziu duas verdades sobre a mesma pessoa: "visto há 8
 * minutos" na tela enquanto ela recebia lead. Foi o que fez a investigação de
 * 2026-09-09 começar por "mas ele está online".
 *
 * A escolha dos 15 min é do Gabriel (08/09) e está justificada em
 * `lib/leads/distribution.ts`: o carimbo mede "está mexendo no CRM", não "está
 * trabalhando", e com 5 min quem lê uma conversa longa ou atende o telefone
 * saía do rodízio — medido, 1 de 3 atendentes contava como online.
 */
export const PRESENCE_MS = 15 * 60 * 1000;

/**
 * O que a pessoa escolheu no seletor da barra superior (202609101100).
 *
 * ⚠️ Separa duas coisas que `last_seen_at` sozinho não distingue: ESTAR no CRM e
 * QUERER lead novo. O vendedor que fica depois do expediente para responder quem
 * já é dele marca "ausente" — está online, e mesmo assim o rodízio não o escolhe.
 */
export type Disponibilidade = "online" | "ausente";

/** Os três estados que uma pessoa pode ter para quem vai transferir uma conversa. */
export type EstadoPresenca = "online" | "ausente" | "offline";

/**
 * Estado de UMA pessoa, a partir do carimbo de presença e do seletor dela.
 *
 * ⚠️ **São três estados, não dois, e a diferença importa justamente na
 * transferência.** "Ausente" não é offline: a pessoa está no CRM e PODE receber
 * uma transferência — a regra do Gabriel é que ela não recebe do RODÍZIO
 * ("ausente ele não recebe nada, apenas se for transferência de outro
 * atendente"). Mostrar as duas como a mesma coisa faria o atendente evitar um
 * colega que está ali, disponível para receber.
 *
 * ⚠️ A ordem das checagens não é livre: a presença vem PRIMEIRO. Quem marcou
 * "ausente" e foi embora há três horas está **offline**, não ausente — o
 * carimbo é o que diz se a pessoa está lá.
 */
export function estadoDePresenca(
  lastSeen: string | null | undefined,
  disponibilidade?: Disponibilidade | null,
): EstadoPresenca {
  if (!lastSeen) return "offline";
  if (Date.now() - new Date(lastSeen).getTime() >= PRESENCE_MS) return "offline";
  return disponibilidade === "ausente" ? "ausente" : "online";
}

/**
 * A palavra que acompanha o ponto colorido.
 *
 * ⚠️ **Nunca só a cor.** Verde × âmbar × cinza num ponto de 8px é exatamente o
 * par que a deuteranopia embaralha — o mesmo motivo pelo qual os selos FRIO e
 * QUENTE da caixa de entrada carregam a palavra. O texto é a codificação
 * secundária, e tirá-lo deixa a informação inacessível para parte da equipe.
 */
export function rotuloDePresenca(estado: EstadoPresenca): string {
  return estado === "online" ? "online" : estado === "ausente" ? "ausente" : "offline";
}
