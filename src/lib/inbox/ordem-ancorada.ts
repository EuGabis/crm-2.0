/**
 * Congela a ORDEM da lista de conversas enquanto o vendedor está rolando.
 *
 * 🔴 O problema, relatado por quem atende: "com muitas mensagens, ele desce a
 * lista para procurar um contato, manda a mensagem, e a tela sobe para cima —
 * tem que descer tudo de novo."
 *
 * A causa é a ordenação: a lista é `last_message_at desc`, então a conversa que
 * ele acabou de responder PULA para o topo e empurra todas as outras uma casa
 * para baixo. O `scrollTop` do container não muda, mas o conteúdo debaixo dele
 * mudou — e o que estava sob o olho dele some. Mensagem nova de qualquer outro
 * cliente faz o mesmo, sem ele ter feito nada.
 *
 * ⚠️ A ordem congela; a LINHA não. Prévia, contador de não lidas, selo de
 * temperatura e etiqueta continuam chegando ao vivo — é só a POSIÇÃO que fica
 * parada, porque é ela que puxa o tapete. Congelar o conteúdo faria a lista
 * ficar velha em silêncio, que é bem pior.
 *
 * ⚠️ Conversa NOVA (que não estava na foto) entra no FIM, nunca no topo: no
 * topo ela empurraria a lista inteira para baixo — exatamente o efeito que esta
 * função existe para evitar. Ela sobe para o lugar certo assim que o usuário
 * volta ao topo e a ordem descongela.
 */
export function ordemAncorada<T extends { id: string }>(lista: T[], foto: string[] | null): T[] {
  if (!foto || foto.length === 0) return lista;

  const porId = new Map(lista.map((item) => [item.id, item]));
  const daFoto: T[] = [];
  for (const id of foto) {
    const item = porId.get(id);
    // Some da lista quem foi finalizado, arquivado ou saiu do filtro: a foto é
    // só a ORDEM, não uma cópia do conteúdo.
    if (item) {
      daFoto.push(item);
      porId.delete(id);
    }
  }
  // O que sobra é o que chegou depois da foto — na ordem em que a lista já os
  // trouxe (a mais recente primeiro).
  return [...daFoto, ...porId.values()];
}
