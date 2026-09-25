/**
 * "Este aviso é para mim?" — **meu, ou de ninguém**.
 *
 * Ver e ser avisado são coisas diferentes: a RLS decide o que cada um VÊ, e isto
 * decide quem é INTERROMPIDO. O "de ninguém" entra de propósito: compromisso da
 * empresa, tarefa sem responsável e conversa da caixa do grupo não podem virar
 * aviso que ninguém recebe.
 *
 * ⚠️ Uma função só para o sino e para o lembrete que abre na tela. Em 25/09 o
 * sino já filtrava e o lembrete não — o time inteiro recebeu, com botão de
 * "Concluir", a tarefa que era do Alberto. Duas cópias da regra divergem.
 */
export function ehParaMim(dono: string | null | undefined, eu: string | null | undefined): boolean {
  return !dono || dono === eu;
}
