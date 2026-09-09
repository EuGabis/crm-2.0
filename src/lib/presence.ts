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
