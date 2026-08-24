/**
 * Endereço de discagem do aparelho a partir de um telefone do CRM.
 *
 * O telefone é digitado à mão no cadastro, então chega com parênteses, hífen,
 * espaço e às vezes o "+55" — e o `tel:` só é confiável com dígitos. O "+" é
 * preservado porque, sem ele, um número com DDI vira ramal de outro país no
 * celular de quem clica.
 *
 * Vive aqui, e não dentro de um componente, porque o mesmo botão "Ligar"
 * aparece no card do funil e no cabeçalho da conversa — duas cópias da
 * normalização divergiriam no primeiro número esquisito.
 */
export function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits ? `tel:+${digits}` : "tel:";
}
