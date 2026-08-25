"use client";

import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowDownUp, Loader2, Search, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { conversationActions } from "@/lib/data/repos/db/conversations";
import { useSectorConversations, sectorActions } from "@/lib/data/repos/db/sector";
import { useMyMembership, useTeam } from "@/lib/data/repos/db/team";
import { cn } from "@/lib/utils";

/** Há quanto tempo sem atividade — vira selo de "parada". */
function idleInfo(iso: string | null): { label: string; tone: "ok" | "warn" | "bad" } {
  if (!iso) return { label: "—", tone: "ok" };
  const ms = Date.now() - new Date(iso).getTime();
  const h = ms / 3_600_000;
  const label = formatDistanceToNow(new Date(iso), { locale: ptBR, addSuffix: false });
  if (h >= 24) return { label, tone: "bad" };
  if (h >= 3) return { label, tone: "warn" };
  return { label, tone: "ok" };
}

function statusLabel(c: { closedAt: string | null; archivedAt: string | null; assignedTo: string | null }) {
  if (c.archivedAt) return "Arquivada";
  if (c.closedAt) return "Finalizada";
  if (!c.assignedTo) return "Sem responsável";
  return "Em atendimento";
}

export function SectorReport() {
  const { rows, loading, reload } = useSectorConversations();
  const { members } = useTeam();
  const { me } = useMyMembership();
  const [query, setQuery] = useState("");
  const [oldestFirst, setOldestFirst] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const nameOf = (userId: string | null) =>
    userId ? members.find((m) => m.userId === userId)?.name ?? "Usuário" : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;
    if (q) {
      out = out.filter((c) => {
        const nome = `${c.contactFirst} ${c.contactLast}`.toLowerCase();
        const resp = (nameOf(c.assignedTo) ?? "").toLowerCase();
        return nome.includes(q) || c.contactPhone.toLowerCase().includes(q) || resp.includes(q);
      });
    }
    // "Mais paradas primeiro" = menor last_message_at primeiro.
    return [...out].sort((a, b) => {
      const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return oldestFirst ? ta - tb : tb - ta;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, oldestFirst, members]);

  const assumir = async (convId: string, prevOwner: string | null) => {
    setBusy(convId);
    const ok = await sectorActions.takeOver(convId);
    if (ok) {
      const actor = nameOf(me?.userId ?? null) ?? "Você";
      const from = nameOf(prevOwner);
      await conversationActions.logEvent(
        convId,
        from ? `${actor} assumiu a conversa de ${from}` : `${actor} assumiu a conversa`
      );
      toast.success("Conversa assumida — está na sua caixa de Conversas");
      await reload();
    } else {
      toast.error("Não foi possível assumir esta conversa");
    }
    setBusy(null);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-slate-900">Conversas do setor</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {loading ? "..." : `${filtered.length} conversa(s)`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar contato, telefone ou responsável"
              className="h-8 w-72 pl-8 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setOldestFirst((v) => !v)}
          >
            <ArrowDownUp className="size-3.5" />
            {oldestFirst ? "Mais paradas" : "Mais recentes"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
          <Loader2 className="size-4 animate-spin" /> Carregando conversas do setor...
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UserCheck}
          title="Nenhuma conversa no setor"
          description="Quando houver conversas neste departamento, elas aparecem aqui — e você pode assumir a de outro atendente."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-xs">
            <thead className="border-b bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Contato</th>
                <th className="px-3 py-2.5 text-left font-medium">Responsável</th>
                <th className="px-3 py-2.5 text-left font-medium">Status</th>
                <th className="px-3 py-2.5 text-left font-medium">Parada há</th>
                <th className="px-3 py-2.5 text-left font-medium">Última mensagem</th>
                <th className="px-3 py-2.5 text-right font-medium">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((c) => {
                const idle = idleInfo(c.lastMessageAt);
                const owner = nameOf(c.assignedTo);
                const isMine = c.assignedTo && c.assignedTo === me?.userId;
                return (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-800">
                        {`${c.contactFirst} ${c.contactLast}`.trim() || c.contactPhone || "Sem nome"}
                      </div>
                      <div className="text-[11px] text-slate-400">{c.contactPhone}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {owner ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Avatar className="size-5">
                            <AvatarFallback className="bg-indigo-500 text-[9px] font-bold text-white">
                              {owner.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-slate-700">{owner}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">Sem responsável</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{statusLabel(c)}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          idle.tone === "bad"
                            ? "bg-rose-100 text-rose-700"
                            : idle.tone === "warn"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-500"
                        )}
                      >
                        {idle.label}
                      </span>
                    </td>
                    <td className="max-w-[240px] truncate px-3 py-2.5 text-slate-500">
                      {c.lastMessagePreview || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {isMine ? (
                        <span className="text-[11px] text-slate-400">Sua</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-[11px]"
                          disabled={busy === c.id}
                          onClick={() => void assumir(c.id, c.assignedTo)}
                        >
                          {busy === c.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <UserCheck className="size-3" />
                          )}
                          Assumir
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
