"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Download, LayoutTemplate, Loader2, MessageSquare, Send, User, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { contactName } from "@/lib/data/repos/contacts";
import { useDbContacts } from "@/lib/data/repos/db/contacts";
import {
  conversationActions,
  useConversations,
  useConvStore,
  useTemplateIntentStore,
} from "@/lib/data/repos/db/conversations";
import { useIsSupervisor, useSectorConversations, sectorActions } from "@/lib/data/repos/db/sector";
import { useMyMembership, useTeam } from "@/lib/data/repos/db/team";
import { useWhatsappChannels } from "@/lib/data/repos/db/whatsapp";
import { channelLabel } from "@/components/shared/channel-icon";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/data/types";

const STATUS_STYLE: Record<string, string> = {
  Aberta: "bg-indigo-100 text-indigo-700",
  "No bot": "bg-violet-100 text-violet-700",
  "Aguardando distribuição": "bg-amber-100 text-amber-700",
  "Na fila": "bg-sky-100 text-sky-700",
  Finalizada: "bg-emerald-100 text-emerald-700",
  Arquivada: "bg-slate-100 text-slate-500",
};

const STATUS_OPTIONS = ["Aberta", "No bot", "Aguardando distribuição", "Na fila", "Finalizada", "Arquivada"];

/** Estado real da conversa (o que aparece na coluna Status do relatório). */
function statusOf(c: Conversation): string {
  if (c.closedAt) return "Finalizada";
  if (c.archivedAt) return "Arquivada";
  if (c.awaitingDistribution) return "Aguardando distribuição";
  if (!c.assignedTo && c.botPaused === false) return "No bot";
  if (c.assignedTo) return "Aberta";
  return "Na fila"; // sem dono e fora do bot — na fila do setor
}

interface Row {
  id: string;
  contactId: string;
  nome: string;
  numero: string;
  email: string;
  status: string;
  canal: string;
  tipo: string;
  atendente: string;
  numeroAssociado: string;
  inicio: string | null;
  channelId: string | null;
  assignedToId: string | null;
  /** Janela de 24h aberta? (última entrada < 24h). WhatsApp only. */
  windowOpen: boolean;
}

/** Status a partir de campos soltos (usado na visão de setor, sem o objeto Conversation). */
function statusFrom(c: {
  closedAt: string | null;
  archivedAt: string | null;
  assignedTo: string | null;
}): string {
  if (c.closedAt) return "Finalizada";
  if (c.archivedAt) return "Arquivada";
  if (c.assignedTo) return "Aberta";
  return "Na fila";
}

const PER_PAGE = 25;

export function ConversationsReport({ onOpen }: { onOpen?: (conversationId: string) => void }) {
  const conversations = useConversations("all");
  const { contacts } = useDbContacts();
  const { channels } = useWhatsappChannels();
  const { members } = useTeam();
  const { isAdmin, me } = useMyMembership();
  const messages = useConvStore((s) => s.messages);
  // Supervisor (setor colaborativo/admin) vê TODAS as conversas do setor — vindas
  // da função sector_conversations, que não passa pela RLS da caixa (privada).
  const isSupervisor = useIsSupervisor();
  const { rows: sectorConvs, reload: reloadSector } = useSectorConversations();
  const [distributing, setDistributing] = useState(false);
  const [assuming, setAssuming] = useState<string | null>(null);

  const assumir = async (row: Row) => {
    setAssuming(row.id);
    const ok = await sectorActions.takeOver(row.id);
    if (ok) {
      const actor = (me ? memberMap.get(me.userId) : null) ?? "Você";
      const from = row.assignedToId ? memberMap.get(row.assignedToId) : null;
      await conversationActions.logEvent(
        row.id,
        from ? `${actor} assumiu a conversa de ${from}` : `${actor} assumiu a conversa`
      );
      toast.success("Conversa assumida — está na sua caixa de Conversas");
      await reloadSector();
    } else {
      toast.error("Não foi possível assumir esta conversa");
    }
    setAssuming(null);
  };

  const awaitingCount = useMemo(
    () => conversations.filter((c) => c.awaitingDistribution).length,
    [conversations],
  );

  async function distribute(pct: number) {
    setDistributing(true);
    try {
      const res = await fetch("/api/leads/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pct }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        const n = json.distributed ?? 0;
        n > 0
          ? toast.success(`${n} lead(s) distribuído(s) para quem está online`)
          : toast.info("Ninguém online no pool agora — nada distribuído");
      } else {
        toast.error(json.error ?? "Não foi possível distribuir");
      }
    } finally {
      setDistributing(false);
    }
  }

  const [statusF, setStatusF] = useState("todos");
  const [canalF, setCanalF] = useState("todos");
  const [numeroF, setNumeroF] = useState("todos"); // channelId
  const [atendenteF, setAtendenteF] = useState("todos"); // userId | "sem"
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const contactMap = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const memberMap = useMemo(() => new Map(members.map((m) => [m.userId, m.name])), [members]);
  const channelMap = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  // Conversas que têm ao menos uma mensagem de entrada = "Receptivo".
  const inboundSet = useMemo(() => {
    const s = new Set<string>();
    for (const m of messages) if (m.direction === "in") s.add(m.conversationId);
    return s;
  }, [messages]);
  // Última mensagem de ENTRADA por conversa (as recentes já estão no store). Base
  // da janela de 24h: janela aberta = houve entrada há menos de 24h.
  const lastInAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const msg of messages) {
      if (msg.direction !== "in") continue;
      const t = new Date(msg.at).getTime();
      if (t > (m.get(msg.conversationId) ?? 0)) m.set(msg.conversationId, t);
    }
    return m;
  }, [messages]);
  const isWindowOpen = (convId: string) => {
    const t = lastInAt.get(convId);
    return !!t && Date.now() - t < 24 * 60 * 60 * 1000;
  };

  const rows: Row[] = useMemo(() => {
    // SUPERVISOR: monta a partir das conversas do SETOR (todas, de todos os
    // atendentes). Caso contrário, das conversas que a RLS deixa ver (as minhas).
    if (isSupervisor && sectorConvs.length > 0) {
      return sectorConvs.map((c) => {
        const ch = c.channelId ? channelMap.get(c.channelId) : undefined;
        const nome = `${c.contactFirst} ${c.contactLast}`.trim();
        return {
          id: c.id,
          contactId: c.contactId ?? "",
          nome: nome || c.contactPhone || "—",
          numero: c.contactPhone || "—",
          email: c.contactEmail || "—",
          status: statusFrom(c),
          canal: channelLabel(c.channel as Conversation["channel"]),
          tipo: c.inbound ? "Receptivo" : "Ativo",
          atendente: c.assignedTo ? memberMap.get(c.assignedTo) ?? "—" : "NA",
          numeroAssociado: ch ? ch.phoneE164 || ch.name : "—",
          inicio: c.createdAt ?? c.lastMessageAt ?? null,
          channelId: c.channelId,
          assignedToId: c.assignedTo,
          windowOpen: isWindowOpen(c.id),
        };
      });
    }
    return conversations.map((c) => {
      // O store de contatos é paginado (não tem todos) — então usamos o nome/
      // telefone/e-mail que a conversa já traz embutido do banco, com o store só
      // como reforço. Antes caía tudo em "—".
      const contact = contactMap.get(c.contactId);
      const ch = c.channelId ? channelMap.get(c.channelId) : undefined;
      const embName = `${c.contactFirstName ?? ""} ${c.contactLastName ?? ""}`.trim();
      return {
        id: c.id,
        contactId: c.contactId,
        nome: (contact ? contactName(contact) : embName) || "—",
        numero: contact?.phone || c.contactPhone || "—",
        email: contact?.email || c.contactEmail || "—",
        status: statusOf(c),
        canal: channelLabel(c.channel),
        tipo: inboundSet.has(c.id) ? "Receptivo" : "Ativo",
        atendente: c.assignedTo ? memberMap.get(c.assignedTo) ?? "—" : "NA",
        numeroAssociado: ch ? ch.phoneE164 || ch.name : "—",
        inicio: c.createdAt ?? c.lastMessageAt ?? null,
        channelId: c.channelId ?? null,
        assignedToId: c.assignedTo ?? null,
        windowOpen: isWindowOpen(c.id),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupervisor, sectorConvs, conversations, contactMap, channelMap, memberMap, inboundSet, lastInAt]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const deTs = de ? new Date(`${de}T00:00:00`).getTime() : null;
    const ateTs = ate ? new Date(`${ate}T23:59:59`).getTime() : null;
    return rows.filter((r) => {
      if (statusF !== "todos" && r.status !== statusF) return false;
      if (canalF !== "todos" && r.canal !== canalF) return false;
      if (numeroF !== "todos" && (r.channelId ?? "") !== numeroF) return false;
      if (atendenteF !== "todos") {
        if (atendenteF === "sem" ? !!r.assignedToId : r.assignedToId !== atendenteF) return false;
      }
      if (deTs || ateTs) {
        const t = r.inicio ? new Date(r.inicio).getTime() : 0;
        if (deTs && t < deTs) return false;
        if (ateTs && t > ateTs) return false;
      }
      if (term && !(r.nome.toLowerCase().includes(term) || r.numero.includes(term))) return false;
      return true;
    });
  }, [rows, conversations, statusF, canalF, numeroF, atendenteF, de, ate, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageClamped = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageClamped - 1) * PER_PAGE, pageClamped * PER_PAGE);

  const resetPage = () => setPage(1);

  const exportCsv = () => {
    const head = [
      "Nome",
      "Número",
      "E-mail",
      "Status",
      "Canal",
      "Tipo",
      "Atendente",
      "WhatsApp associado",
      "Início da conversa",
    ];
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = filtered.map((r) =>
      [
        r.nome,
        r.numero,
        r.email,
        r.status,
        r.canal,
        r.tipo,
        r.atendente,
        r.numeroAssociado,
        r.inicio ? format(new Date(r.inicio), "dd/MM/yyyy HH:mm") : "",
      ]
        .map(esc)
        .join(","),
    );
    const csv = [head.map(esc).join(","), ...lines].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conversas-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selCls =
    "h-8 rounded-md border bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-300";

  return (
    <div className="space-y-3">
      {isAdmin && awaitingCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">
            <strong>{awaitingCount}</strong> lead(s) quente(s){" "}
            <strong>aguardando distribuição</strong> — ficaram no bot por não ter ninguém online.
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-amber-700">Distribuir agora:</span>
            {[
              { label: "Todos", pct: 100 },
              { label: "50%", pct: 50 },
              { label: "30%", pct: 30 },
            ].map((o) => (
              <button
                key={o.pct}
                disabled={distributing}
                onClick={() => distribute(o.pct)}
                className="flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                <Send className="size-3" /> {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{filtered.length.toLocaleString("pt-BR")}</span>{" "}
          {filtered.length === 1 ? "registro" : "registros"}
          {filtered.length !== rows.length && ` (de ${rows.length.toLocaleString("pt-BR")})`}
        </p>
        <button
          onClick={exportCsv}
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <Download className="size-3.5" /> Exportar
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusF}
          onChange={(e) => {
            setStatusF(e.target.value);
            resetPage();
          }}
          className={selCls}
        >
          <option value="todos">Status: todos</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={numeroF}
          onChange={(e) => {
            setNumeroF(e.target.value);
            resetPage();
          }}
          className={selCls}
        >
          <option value="todos">WhatsApp associado: todos</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.phoneE164 || c.name}
            </option>
          ))}
        </select>
        <select
          value={atendenteF}
          onChange={(e) => {
            setAtendenteF(e.target.value);
            resetPage();
          }}
          className={selCls}
        >
          <option value="todos">Atendente: todos</option>
          <option value="sem">Sem atendente</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={de}
          onChange={(e) => {
            setDe(e.target.value);
            resetPage();
          }}
          title="Início da conversa — de"
          className={selCls}
        />
        <input
          type="date"
          value={ate}
          onChange={(e) => {
            setAte(e.target.value);
            resetPage();
          }}
          title="Início da conversa — até"
          className={selCls}
        />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            resetPage();
          }}
          placeholder="Buscar nome ou número"
          className={cn(selCls, "min-w-48 flex-1")}
        />
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-xs">
          <thead className="border-b bg-slate-50 text-left text-slate-500">
            <tr>
              {["Nome", "Número", "E-mail", "Status", "Canal", "Tipo", "Atendente", "WhatsApp associado", "Início", "Ações"].map(
                (h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="px-3 py-2 font-medium text-slate-800">
                  <Link href={`/contatos/${r.contactId}`} className="hover:text-indigo-600 hover:underline">
                    {r.nome}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.numero}</td>
                <td className="px-3 py-2 text-slate-600">{r.email}</td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-600",
                    )}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">{r.canal}</td>
                <td className="px-3 py-2 text-slate-600">{r.tipo}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.atendente}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.numeroAssociado}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                  {r.inicio ? format(new Date(r.inicio), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <div className="flex items-center gap-1">
                    {/* Estado da janela de 24h (só WhatsApp). Verde = aberta,
                        âmbar = fechada (só template retoma). */}
                    <span
                      title={
                        !r.channelId
                          ? "—"
                          : r.windowOpen
                            ? "Janela de 24h aberta"
                            : "Janela de 24h fechada — só template"
                      }
                      className={cn(
                        "mr-0.5 size-2 shrink-0 rounded-full",
                        !r.channelId
                          ? "bg-slate-300"
                          : r.windowOpen
                            ? "bg-emerald-500"
                            : "bg-amber-500"
                      )}
                    />
                    <Link
                      href={`/contatos/${r.contactId}`}
                      title="Abrir contato"
                      className="flex size-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      <User className="size-3.5" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => onOpen?.(r.id)}
                      title="Abrir conversa"
                      className="flex size-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                    >
                      <MessageSquare className="size-3.5" />
                    </button>
                    {!r.windowOpen && r.channelId && (
                      <button
                        type="button"
                        onClick={() => {
                          useTemplateIntentStore.getState().request(r.id);
                          onOpen?.(r.id);
                        }}
                        title="Janela de 24h fechada — enviar template"
                        className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                      >
                        <LayoutTemplate className="size-3.5" /> Template
                      </button>
                    )}
                    {isSupervisor && r.assignedToId !== me?.userId && (
                      <button
                        type="button"
                        onClick={() => void assumir(r)}
                        disabled={assuming === r.id}
                        title="Assumir esta conversa (vai para a sua caixa)"
                        className="flex size-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-emerald-600 disabled:opacity-50"
                      >
                        {assuming === r.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <UserCheck className="size-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-slate-400">
                  Nenhuma conversa com esses filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {filtered.length > PER_PAGE && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            Página {pageClamped} de {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pageClamped <= 1}
              className="rounded-md border px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={pageClamped >= totalPages}
              className="rounded-md border px-2 py-1 hover:bg-slate-50 disabled:opacity-40"
            >
              Próximo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
