#!/usr/bin/env node
/**
 * Testes de `src/lib/bot/campos.ts` — validação das respostas do bot.
 *
 * ⚠️ **Os casos vêm do banco de produção**, não de imaginação: em 01/09/2026 o
 * bot tinha gravado, como e-mail do lead, uma frase de 130 caracteres sobre datas
 * de viagem, e nomes cortados depois da preposição ("Mário José Coppini da").
 * Cada teste abaixo marcado com [real] é um valor que ESTAVA gravado.
 *
 * O ponto delicado é o equilíbrio: validador permissivo deixa a frase passar
 * (o defeito), e validador estrito recusa o e-mail de um cliente de verdade e o
 * trava no meio da triagem. Metade dos casos aqui existe para vigiar esse lado.
 *
 * Rodar: `npm run test:bot`
 */

const { extrairEmail, extrairDoc, extrairEmailOuDoc, limitarNome, MAX_PALAVRAS_NOME } =
  await import("../src/lib/bot/campos.ts");

let ok = 0;
const falhas = [];

function eq(nome, real, esperado) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) ok++;
  else falhas.push(`${nome}\n      esperado: ${JSON.stringify(esperado)}\n      obtido:   ${JSON.stringify(real)}`);
}

/* ================================================================== *
 * E-mail que DEVE ser aceito — o lado que trava cliente de verdade
 * ================================================================== */
console.log("\n  extrairEmail — aceita o que é e-mail");

eq("simples", extrairEmail("joao@gmail.com"), "joao@gmail.com");
eq("maiúsculas viram minúsculas", extrairEmail("Cadubordin@Gmail.COM"), "cadubordin@gmail.com");
eq("com ponto no usuário", extrairEmail("renanmunhoz.nutri@gmail.com"), "renanmunhoz.nutri@gmail.com");
eq("com underscore [real]", extrairEmail("Mate.us_hgoncalves567@hotmail.com"), "mate.us_hgoncalves567@hotmail.com");
eq("domínio corporativo [real]", extrairEmail("matheus.miranda@latam.com"), "matheus.miranda@latam.com");
eq("com + (alias)", extrairEmail("joao+curso@gmail.com"), "joao+curso@gmail.com");
eq("dois níveis de domínio", extrairEmail("a@mail.empresa.com.br"), "a@mail.empresa.com.br");
eq("com hífen no domínio", extrairEmail("a@minha-escola.com"), "a@minha-escola.com");

// As pessoas respondem em volta do endereço — exigir a linha limpa
// reperguntaria a quem já respondeu certo.
eq("dentro de frase", extrairEmail("meu email é joao@gmail.com"), "joao@gmail.com");
eq("com ponto final", extrairEmail("joao@gmail.com."), "joao@gmail.com");
eq("com vírgula e agradecimento", extrairEmail("joao@gmail.com, obrigado!"), "joao@gmail.com");
eq("entre parênteses", extrairEmail("(joao@gmail.com)"), "joao@gmail.com");
eq("com espaços em volta", extrairEmail("   joao@gmail.com   "), "joao@gmail.com");

// ⚠️ [real] O teclado do celular autocapitaliza e separa o domínio de topo.
eq("domínio quebrado por espaço [real]", extrairEmail("Usmetzket9@gmail. Com"), "usmetzket9@gmail.com");
eq("espaço antes do arroba", extrairEmail("joao @gmail.com"), "joao@gmail.com");

/* ================================================================== *
 * E-mail que DEVE ser recusado — o defeito que isto fecha
 * ================================================================== */
console.log("  extrairEmail — recusa o que não é");

// ⚠️ [real] Era isto que estava gravado no campo `email` de um lead.
eq(
  "frase inteira sobre datas [real]",
  extrairEmail(
    "Será do dia 14.10 ate dia 21.10, o ideal seria eu fazer a visita no dia 15.10. " +
      "Eu viajo no dia 14.10 e chego no Brasil no dia 14.10. Aí volto no dia 19 e chego dia 20",
  ),
  null,
);
eq("agradecimento [real]", extrairEmail("Muito obrigado novamente Beatriz"), null);
eq("pergunta do cliente [real]", extrairEmail("Pode gerar uma nova chave pix por favor"), null);
eq("outra pergunta [real]", extrairEmail("E depois pode me informar quantas parcelas eu já paguei?"), null);
eq("vazio", extrairEmail(""), null);
eq("só espaço", extrairEmail("   "), null);
eq("sem arroba", extrairEmail("joao.gmail.com"), null);
eq("sem domínio de topo", extrairEmail("joao@gmail"), null);
eq("sem usuário", extrairEmail("@gmail.com"), null);
eq("TLD de 1 letra", extrairEmail("joao@gmail.c"), null);
eq("só o arroba", extrairEmail("@"), null);
eq("telefone", extrairEmail("11988772030"), null);
// ⚠️ Este é o limite do validador, e é DE PROPÓSITO: "hormail" é um domínio de
// forma válida. Não é papel do bot adivinhar erro de digitação de domínio — quem
// confere o cadastro é o atendente, e recusar aqui travaria quem escreveu certo
// num domínio que não conhecemos.
eq("domínio com typo passa (esperado)", extrairEmail("g.smota@hormail.com"), "g.smota@hormail.com");

/* ================================================================== *
 * CPF / CNPJ
 * ================================================================== */
console.log("  extrairDoc — CPF e CNPJ pelo TAMANHO");

eq("CPF pontuado", extrairDoc("123.456.789-01"), "12345678901");
eq("CPF só dígitos", extrairDoc("12345678901"), "12345678901");
eq("CPF em frase", extrairDoc("meu cpf é 123.456.789-01"), "12345678901");
eq("CNPJ", extrairDoc("12.345.678/0001-95"), "12345678000195");
eq("dígitos de menos", extrairDoc("1234567890"), null);
eq("dígitos de mais", extrairDoc("123456789012"), null);
eq("sem número", extrairDoc("não tenho"), null);
// ⚠️ Não confere dígito verificador de propósito: aqui o objetivo é separar
// "respondeu o documento" de "fez outra pergunta". Recusar por dígito travaria
// quem digitou um número errado, e quem confere o cadastro é o atendente.
eq("CPF inválido no dígito passa (esperado)", extrairDoc("111.111.111-11"), "11111111111");

console.log("  extrairEmailOuDoc — o nó do financeiro pede os dois");
eq("e-mail vence", extrairEmailOuDoc("joao@gmail.com"), "joao@gmail.com");
eq("cai no documento", extrairEmailOuDoc("123.456.789-01"), "12345678901");
eq("nenhum dos dois", extrairEmailOuDoc("bom dia, tudo bem?"), null);

/* ================================================================== *
 * Teto do nome — a regressão que cortava nome brasileiro
 * ================================================================== */
console.log("  limitarNome — o corte que truncava sobrenome");

eq("teto é 6 palavras", MAX_PALAVRAS_NOME, 6);
// ⚠️ [real] Com o teto antigo de 4, este virava "Mário José Coppini da" — cortado
// depois da preposição, com cara de erro de digitação do cliente.
eq(
  "nome de 5 palavras sobrevive [real]",
  limitarNome("Mário José Coppini da Silva"),
  "Mário José Coppini da Silva",
);
eq(
  "nome de 6 palavras sobrevive",
  limitarNome("Maria das Graças Ferreira dos Santos"),
  "Maria das Graças Ferreira dos Santos",
);
eq("nome de 4 continua igual", limitarNome("Allyson Luiz Cordeiro Pinto"), "Allyson Luiz Cordeiro Pinto");
eq("nome simples", limitarNome("João"), "João");
eq("espaços colapsam", limitarNome("  João    Lucas  "), "João Lucas");
// O teto continua existindo: a resposta pode ser uma frase.
eq(
  "frase longa é cortada em 6",
  limitarNome("um dois tres quatro cinco seis sete oito"),
  "um dois tres quatro cinco seis",
);
// Rede de caracteres: uma "palavra" pode ser uma linha sem espaço, e o nome vai
// para o card do funil e para a base de contatos.
eq("palavra gigante é cortada em 80", limitarNome("a".repeat(200)).length, 80);


/* ================================================================== *
 * O texto que o bot envia — a quebra de linha
 * ==================================================================
 *
 * 🔴 Relato de 2026-09-14: "no bot da mensagem de fim de semana, ao pular
 * linha, quando o bot responde, não pula na mensagem".
 *
 * A limpeza do texto usava `\s`, e `\s` INCLUI `\n` — então `\s{2,} -> " "`
 * engolia a linha em branco entre parágrafos. E era intermitente, o que fazia
 * parecer defeito do WhatsApp: um Enter sobrevivia (um caractere só), dois não.
 * Cada asserção abaixo é uma forma de pular linha que tem de chegar inteira.
 */
const { renderTextoDoBot } = await import("../src/lib/bot/texto.ts");
const r = (t, v = { first_name: "Ana" }) => renderTextoDoBot(t, v);

eq("um Enter é preservado", r("Olá!\nBom dia."), "Olá!\nBom dia.");
// 🔴 O caso do relato: parágrafo separado por linha em branco.
eq(
  "linha em branco entre parágrafos",
  r("Olá!\n\nNosso horário é 9h30 às 18h."),
  "Olá!\n\nNosso horário é 9h30 às 18h.",
);
// ⚠️ CRLF são DOIS caracteres de espaço — colar do Word/Bloco de Notas caía aqui.
eq("CRLF do Windows vira quebra, não espaço", r("Olá!\r\nBom dia."), "Olá!\nBom dia.");
eq("CR sozinho (Mac antigo)", r("Olá!\rBom dia."), "Olá!\nBom dia.");
// Indentação sobrando não pode transformar a quebra em espaço.
eq("espaço grudado na quebra some", r("Olá!\n   Bom dia."), "Olá!\nBom dia.");
eq("espaço ANTES da quebra some", r("Olá!   \nBom dia."), "Olá!\nBom dia.");
// Lista de linhas: era o pior sintoma, porque metade das quebras sobrevivia.
eq(
  "lista com título e itens",
  r("Horários:\n\n- Seg a sex\n- Sáb fechado"),
  "Horários:\n\n- Seg a sex\n- Sáb fechado",
);
// Teto: três Enters não viram um buraco no balão.
eq("no máximo uma linha em branco", r("a\n\n\n\nb"), "a\n\nb");
eq("quebras nas pontas somem", r("\n\nOlá!\n\n"), "Olá!");

/*
 * ⚠️ A limpeza tinha de CONTINUAR existindo — ela é o que evita "Perfeito, !" e
 * o espaço duplo quando `{{first_name}}` sai da frase. O erro nunca foi limpar;
 * foi limpar a QUEBRA junto com o espaço.
 */
eq("dois espaços ainda viram um", r("Olá   mundo"), "Olá mundo");
eq("espaço antes de pontuação some", r("Olá , tudo bem ?"), "Olá, tudo bem?");
eq("variável é trocada", r("Oi {{first_name}}!"), "Oi Ana!");
eq("sem nome, some o placeholder e a vírgula", r("Perfeito, {{first_name}}!", {}), "Perfeito!");
// ⚠️ O mesmo defeito por outra porta: com `\s*`, remover o placeholder no fim da
// linha comia a quebra e colava as duas linhas.
eq(
  "placeholder no fim da linha não come a quebra",
  r("{{first_name}}, bom dia!\nSeu horário é 9h.", {}),
  "Bom dia!\nSeu horário é 9h.",
);
eq("variável ausente vira vazio", r("Curso: {{curso}}.", { first_name: "Ana" }), "Curso:.");

/* ---------------------------------------------------------------- */
console.log("");
if (falhas.length) {
  for (const f of falhas) console.error(`  ✗ ${f}`);
  console.error(`\n  ${ok} passaram, ${falhas.length} FALHARAM\n`);
  process.exit(1);
}
console.log(`  ✓ ${ok} asserções passaram\n`);
