export const brand = {
  name: "Lito CRM",
  shortName: "Lito",
  tagline: "Seu negócio inteiro em um lugar",
} as const;

/**
 * Marca usada nos E-MAILS (remetente, cabeçalho das campanhas e rodapé). É separada
 * da marca do app: os e-mails falam com o cliente final em nome da empresa.
 * `address`: endereço postal no rodapé — exigido por leis anti-spam (CAN-SPAM) e melhora
 * a entregabilidade. EDITE com o endereço real da empresa.
 */
export const emailBrand = {
  name: "Lito Aviation Academy",
  shortName: "Lito",
  address: "Lito Aviation Academy · Rua Brás Cubas, 231 · Vila Lanzara, Guarulhos/SP · CEP 07115-080",
} as const;
