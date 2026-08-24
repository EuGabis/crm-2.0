import type { BotFlow } from "../types";
import { triagemFlow } from "./triagem";

/**
 * Bot da SECRETARIA — independente do comercial. Nasce com a mesma estrutura da
 * triagem por assunto (saudação → cadastrado? → e-mail/nome → curso → assunto →
 * como ajudar → fila → transfere para um atendente por assunto). Ajuste os textos
 * e escolha os atendentes de cada transferência na aba WhatsApp → Bot; ligue-o ao
 * número da Secretaria em Canais → editar → Bot de atendimento.
 */
export const secretariaFlow: BotFlow = {
  ...structuredClone(triagemFlow),
  key: "triagem-secretaria",
  name: "Triagem Secretaria",
};
