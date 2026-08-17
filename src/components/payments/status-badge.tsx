"use client";

import { Badge } from "@/components/ui/badge";
import { classifyGuruStatus, guruStatusLabel } from "@/lib/data/guru";
import { cn } from "@/lib/utils";

/**
 * Selo de status de venda/assinatura da Guru. Morava dentro de
 * `pagamentos/page.tsx`; saiu para cá quando o detalhe do lead passou a mostrar
 * as mesmas vendas — duas cópias da tabela de cores acabariam divergindo, e o
 * mesmo status apareceria verde num lugar e cinza no outro.
 */
export function guruStatusBadgeClass(status: string | null): string {
  switch (classifyGuruStatus(status)) {
    case "aprovado":
      return "bg-emerald-100 text-emerald-700";
    case "pendente":
    case "atrasado":
      return "bg-amber-100 text-amber-700";
    case "recusado":
    case "reembolsado":
    case "chargeback":
    case "cancelado":
    case "expirado":
      return "bg-red-100 text-red-600";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export function GuruStatusBadge({ status }: { status: string | null }) {
  return (
    <Badge variant="secondary" className={cn(guruStatusBadgeClass(status))}>
      {guruStatusLabel(status)}
    </Badge>
  );
}
