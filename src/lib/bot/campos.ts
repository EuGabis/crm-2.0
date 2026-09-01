/**
 * Extração e validação das respostas do bot (e-mail, CPF/CNPJ).
 *
 * ⚠️ **Por que existe.** O nó `ask` só validava `name`; todo o resto caía num
 * `vars[node.var] = args.text` que guardava a resposta CRUA. O efeito, medido no
 * banco em 01/09/2026, é lixo indo para o lead e para a base de contatos:
 *
 *   e-mail = "Será do dia 14.10 ate dia 21.10, o ideal seria eu fazer a visita…"
 *   e-mail = "Usmetzket9@gmail. Com"
 *   curso  = "Muito obrigado novamente Beatriz"
 *
 * A causa é o bot tratar QUALQUER mensagem como resposta à pergunta atual. Um
 * cliente que pergunta em vez de responder tem a pergunta dele gravada no campo.
 *
 * Funções puras, num módulo separado do motor, para poderem ser testadas — o
 * motor precisa de banco e de webhook.
 */

/**
 * Forma de e-mail. Deliberadamente NÃO é a RFC 5322 inteira.
 *
 * ⚠️ Validador exageradamente permissivo é o que deixou passar uma frase de 130
 * caracteres; exageradamente estrito recusa o e-mail real de um cliente e o
 * trava no meio da triagem. O meio é exigir a estrutura que todo e-mail de
 * verdade tem — algo@algo.tld, sem espaço, com TLD de 2+ letras — e aceitar o
 * resto.
 */
const FORMA_EMAIL = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/**
 * Tira a pontuação que a pessoa escreve EM VOLTA do endereço e que não é parte
 * dele — parênteses, aspas, ponto final, vírgula.
 */
function tirarPontuacao(s: string): string {
  return s.replace(/^[.,;:!?([{<'"]+/, "").replace(/[.,;:!?)\]}>'"]+$/, "");
}

/**
 * Acha um e-mail dentro da resposta e devolve normalizado, ou `null`.
 *
 * Aceita a pessoa escrevendo em volta ("meu email é x@y.com, obrigado") porque é
 * como as pessoas respondem de verdade — exigir a linha limpa reperguntaria a
 * quem já respondeu certo.
 *
 * ⚠️ **Tolera espaço perdido, mas SÓ na emenda de um ponto ou do arroba.** É o
 * erro que o teclado do celular produz ao autocapitalizar ("@gmail. Com" — valor
 * real gravado no banco). A tentação é normalizar a frase inteira tirando
 * espaços em volta de todo ponto; isso transformaria "obrigado. joao@gmail.com"
 * em "obrigado.joao@gmail.com", colando palavra solta no endereço. Daí a emenda
 * ser condicionada ao ponto e limitada a dois pedaços.
 */
export function extrairEmail(bruto: string): string | null {
  const texto = (bruto ?? "").trim();
  if (!texto) return null;

  const pedacos = texto.split(/\s+/);
  const i = pedacos.findIndex((t) => t.includes("@"));
  if (i < 0) return null;

  // Um espaço perdido ANTES do arroba ("joao @gmail.com") junta o pedaço
  // anterior; é a mesma classe de erro de digitação.
  const bases: string[] = [];
  if (pedacos[i]!.startsWith("@") && i > 0) bases.push(pedacos[i - 1]! + pedacos[i]!);
  bases.push(pedacos[i]!);

  for (const base of bases) {
    let candidato = base;
    for (let extra = 0; extra <= 2; extra++) {
      const limpo = tirarPontuacao(candidato);
      if (FORMA_EMAIL.test(limpo)) return limpo.toLowerCase();
      const proximo = pedacos[i + 1 + extra];
      if (proximo === undefined) break;
      // A emenda só vale num PONTO — ver o aviso acima.
      if (!(candidato.endsWith(".") || proximo.startsWith("."))) break;
      candidato += proximo;
    }
  }
  return null;
}

/** Só os dígitos — o cliente manda CPF pontuado, com espaço ou nada disso. */
function digitos(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

/**
 * CPF (11) ou CNPJ (14) dentro da resposta.
 *
 * ⚠️ **Não confere o dígito verificador de propósito.** Aqui o objetivo é
 * separar "o cliente respondeu o documento" de "o cliente fez outra pergunta";
 * recusar um CPF por dígito errado travaria a triagem de quem digitou um número
 * a menos, e quem confere o cadastro de verdade é o atendente. Mas exige o
 * TAMANHO exato: sem isso, qualquer frase com número passaria.
 */
export function extrairDoc(bruto: string): string | null {
  const d = digitos(bruto);
  if (d.length === 11 || d.length === 14) return d;
  return null;
}

/** E-mail OU documento — o nó do financeiro pede "e-mail ou CPF". */
export function extrairEmailOuDoc(bruto: string): string | null {
  return extrairEmail(bruto) ?? extrairDoc(bruto);
}

/**
 * Teto de palavras do nome.
 *
 * ⚠️ Era **4**, e cortava nome brasileiro no meio: medido no banco,
 * "Mário José Coppini da" (de "…da Silva") e "Eduardo Gama dos". O corte cai
 * justamente depois da preposição, o que deixa o nome truncado de um jeito que
 * parece erro de digitação do cliente. Seis cobre "Maria das Graças Ferreira
 * dos Santos"; o teto continua existindo porque a resposta pode ser uma frase.
 */
export const MAX_PALAVRAS_NOME = 6;

/** Aplica o teto de palavras e o de caracteres ao nome já extraído. */
export function limitarNome(nome: string): string {
  const palavras = nome.trim().split(/\s+/).slice(0, MAX_PALAVRAS_NOME).join(" ");
  // Teto de caracteres como rede: uma "palavra" pode ser uma linha inteira sem
  // espaço, e o nome vai para o card do funil e para a base de contatos.
  return palavras.length > 80 ? palavras.slice(0, 80).trim() : palavras;
}
