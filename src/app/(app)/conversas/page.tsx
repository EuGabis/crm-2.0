"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarClock, Link2, Phone, Plus, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SubNav } from "@/components/layout/subnav";
import { Composer } from "@/components/inbox/composer";
import { ContactPanel } from "@/components/inbox/contact-panel";
import { ConversationList } from "@/components/inbox/conversation-list";
import { Thread } from "@/components/inbox/thread";
import { ViewsRail } from "@/components/inbox/views-rail";
import { ConversationsReport } from "@/components/inbox/conversations-report";
import { TemplatesTab } from "@/components/whatsapp/templates-tab";
import { TemplateLogsTab } from "@/components/whatsapp/template-logs-tab";
import { DataTable, type Column } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiCard } from "@/components/shared/kpi-card";
import { ChannelIcon, channelLabel } from "@/components/shared/channel-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { contactName } from "@/lib/data/repos/contacts";
import { useDbContacts } from "@/lib/data/repos/db/contacts";
import { useWhatsappChannels } from "@/lib/data/repos/db/whatsapp";
import {
  conversationActions,
  scheduleActions,
  snippetActions,
  useConvStore,
  useConversation,
  useConversations,
  useScheduledMessages,
  useSnippets,
} from "@/lib/data/repos/db/conversations";
import { useTeam } from "@/lib/data/repos/db/team";
import { brand } from "@/lib/config/brand";
import type { Channel, ScheduleStatus } from "@/lib/data/types";

const TABS = [
  { label: "Conversas" },
  { label: "Relatório" },
  { label: "Templates" },
  { label: "Agendadas" },
  { label: "Ações manuais" },
  { label: "Trechos" },
  { label: "Links de acionamento" },
  { label: "Estatísticas" },
  { label: "Configurações" },
];

/**
 * Templates da Meta + rastreio (Logs) dentro da própria aba Conversas — o mesmo
 * conteúdo de /whatsapp, pra criar/ver template sem trocar de módulo.
 */
function TemplatesPanel() {
  const [sub, setSub] = useState<"templates" | "logs">("templates");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b">
        {(
          [
            ["templates", "Templates"],
            ["logs", "Logs"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSub(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium ${
              sub === key
                ? "border-indigo-500 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {sub === "templates" ? <TemplatesTab /> : <TemplateLogsTab />}
    </div>
  );
}

/**
 * `useSearchParams` obriga um limite de Suspense — sem ele o build falha ao
 * pré-renderizar /conversas.
 */
export default function ConversasPage() {
  return (
    <Suspense fallback={null}>
      <ConversasPageInner />
    </Suspense>
  );
}

function ConversasPageInner() {
  const [tab, setTab] = useState("Conversas");
  const conversations = useConversations();
  // ?c=<id> vem do card do kanban ("Abrir conversa") — abre direto naquela.
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(
    () => searchParams.get("c")
  );
  const [newOpen, setNewOpen] = useState(false);
  const selectedConversation = useConversation(selectedId);

  // seleciona a primeira conversa quando os dados chegam
  useEffect(() => {
    if (!selectedId && conversations.length > 0) setSelectedId(conversations[0].id);
  }, [conversations, selectedId]);

  return (
    <div className="flex h-full flex-col">
      <SubNav tabs={TABS} active={tab} onChange={setTab} />
      {tab !== "Conversas" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {tab === "Relatório" && <ConversationsReport />}
          {tab === "Templates" && <TemplatesPanel />}
          {tab === "Agendadas" && <AgendadasTab />}
          {tab === "Ações manuais" && <AcoesManuaisTab />}
          {tab === "Trechos" && <TrechosTab />}
          {tab === "Links de acionamento" && <LinksTab />}
          {tab === "Estatísticas" && <EstatisticasTab />}
          {tab === "Configurações" && <ConfiguracoesTab />}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ViewsRail onNew={() => setNewOpen(true)} onSelectConversation={setSelectedId} />
          <ConversationList
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNew={() => setNewOpen(true)}
          />
          {selectedId ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Thread conversationId={selectedId} onDeleted={() => setSelectedId(null)} />
              <Composer conversationId={selectedId} />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50">
              <p className="text-sm text-slate-400">
                {conversations.length === 0
                  ? "Nenhuma conversa ainda — comece uma com um contato"
                  : "Selecione uma conversa"}
              </p>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setNewOpen(true)}>
                <Plus className="size-3.5" /> Nova conversa
              </Button>
            </div>
          )}
          {selectedConversation && (
            <ContactPanel
              contactId={selectedConversation.contactId}
              conversationId={selectedConversation.id}
            />
          )}
        </div>
      )}
      <NewConversationDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  );
}

/* ---------- Nova conversa ---------- */

const CHANNELS: Channel[] = ["whatsapp", "instagram", "facebook", "sms", "email"];

function NewConversationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { contacts } = useDbContacts();
  const { channels } = useWhatsappChannels();
  const activeChannels = channels.filter((c) => c.active);
  const [contactId, setContactId] = useState("");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [channelId, setChannelId] = useState("");
  const [saving, setSaving] = useState(false);

  // Número padrão = o primeiro ativo; o usuário troca se quiser.
  useEffect(() => {
    if (channel === "whatsapp" && !channelId && activeChannels.length) {
      setChannelId(activeChannels[0].id);
    }
  }, [channel, channelId, activeChannels]);

  const create = async () => {
    if (!contactId) {
      toast.error("Escolha um contato");
      return;
    }
    if (channel === "whatsapp" && activeChannels.length && !channelId) {
      toast.error("Escolha o número de WhatsApp");
      return;
    }
    setSaving(true);
    // WhatsApp com número escolhido = conversa travada nesse número.
    const id =
      channel === "whatsapp" && channelId
        ? await conversationActions.openForChannel(contactId, channelId)
        : await conversationActions.open(contactId, channel);
    setSaving(false);
    if (!id) {
      toast.error("Não foi possível abrir a conversa");
      return;
    }
    onCreated(id);
    setContactId("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Contato *</Label>
            <Select value={contactId} onValueChange={(v) => setContactId(v ?? "")}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue>
                  {contactId
                    ? contactName(contacts.find((c) => c.id === contactId)!)
                    : "Selecionar contato"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {contacts.slice(0, 100).map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {contactName(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {contacts.length === 0 && (
              <p className="text-[11px] text-amber-600">
                Você ainda não tem contatos — crie um no módulo Contatos primeiro.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Canal</Label>
            <Select value={channel} onValueChange={(v) => v && setChannel(v as Channel)}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue>{channelLabel(channel)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">
                    {channelLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {channel === "whatsapp" && activeChannels.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Número (WhatsApp associado) *</Label>
              <Select value={channelId} onValueChange={(v) => setChannelId(v ?? "")}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue>
                    {(() => {
                      const ch = activeChannels.find((c) => c.id === channelId);
                      return ch ? ch.phoneE164 || ch.name : "Selecionar número";
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {activeChannels.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.name}
                      {c.phoneE164 ? ` · ${c.phoneE164}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-slate-400">A conversa fica travada neste número.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={create} disabled={saving}>
            {saving ? "Abrindo..." : "Abrir conversa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Agendadas (log real — migração 0028) ---------- */

const SCHEDULE_BADGE: Record<ScheduleStatus, { label: string; className: string }> = {
  pendente: { label: "Pendente", className: "bg-amber-100 text-amber-700" },
  enviando: { label: "Enviando", className: "bg-sky-100 text-sky-700" },
  enviada: { label: "Enviada", className: "bg-emerald-100 text-emerald-700" },
  falhou: { label: "Falhou", className: "bg-rose-100 text-rose-700" },
  cancelada: { label: "Cancelada", className: "bg-slate-100 text-slate-500" },
};

function AgendadasTab() {
  const scheduled = useScheduledMessages();
  const conversations = useConversations();
  const { contacts } = useDbContacts();
  const { members } = useTeam();
  const loaded = useConvStore((s) => s.loaded);

  const rows = useMemo(
    () =>
      scheduled.map((m) => {
        const conv = conversations.find((c) => c.id === m.conversationId);
        const contact = conv ? contacts.find((x) => x.id === conv.contactId) : null;
        return {
          ...m,
          contato: contact ? contactName(contact) : "—",
          quem: members.find((x) => x.userId === m.scheduledBy)?.name ?? "—",
        };
      }),
    [scheduled, conversations, contacts, members]
  );

  const pendentes = rows.filter((r) => r.scheduleStatus === "pendente").length;
  const enviadas = rows.filter((r) => r.scheduleStatus === "enviada").length;
  const falhas = rows.filter((r) => r.scheduleStatus === "falhou").length;

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: "contato",
      header: "Contato",
      sortable: true,
      sortValue: (r) => r.contato,
      render: (r) => <span className="font-medium text-slate-800">{r.contato}</span>,
    },
    {
      key: "canal",
      header: "Canal",
      render: (r) => (
        <span className="flex items-center gap-1.5 text-slate-600">
          <ChannelIcon channel={r.channel} size={14} /> {channelLabel(r.channel)}
        </span>
      ),
    },
    {
      key: "mensagem",
      header: "Mensagem",
      render: (r) => (
        <span className="block max-w-xs truncate text-slate-500">
          {r.internal ? "Comentário interno · " : ""}
          {r.body}
        </span>
      ),
    },
    {
      key: "quem",
      header: "Agendada por",
      sortable: true,
      sortValue: (r) => r.quem,
      render: (r) => <span className="text-slate-600">{r.quem}</span>,
    },
    {
      key: "quando",
      header: "Para quando",
      sortable: true,
      sortValue: (r) => r.scheduledFor ?? "",
      render: (r) =>
        r.scheduledFor
          ? format(new Date(r.scheduledFor), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
          : "—",
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (r) => r.scheduleStatus ?? "",
      render: (r) => {
        const badge = SCHEDULE_BADGE[r.scheduleStatus as ScheduleStatus];
        return (
          <span className="flex flex-col gap-0.5">
            <span
              className={`w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
            >
              {badge.label}
            </span>
            {r.scheduleError && (
              <span className="max-w-[220px] text-[10px] leading-tight text-rose-500">
                {r.scheduleError}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "disparada",
      header: "Disparada em",
      render: (r) =>
        r.dispatchedAt
          ? format(new Date(r.dispatchedAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
          : "—",
    },
    {
      key: "acao",
      header: "",
      render: (r) =>
        r.scheduleStatus === "pendente" ? (
          <button
            onClick={async () => {
              if (!window.confirm("Cancelar este agendamento?")) return;
              (await scheduleActions.cancel(r.id))
                ? toast.success("Agendamento cancelado")
                : toast.error("Não foi possível cancelar — pode já ter sido disparada");
            }}
            className="text-[11px] font-medium text-slate-400 hover:text-red-500"
          >
            Cancelar
          </button>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold text-slate-900">Mensagens agendadas</h1>
        <Badge variant="secondary">{rows.length} no total</Badge>
      </div>
      {rows.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <KpiCard label="Pendentes" value={String(pendentes)} hint="Aguardando a hora marcada" />
          <KpiCard label="Enviadas" value={String(enviadas)} />
          <KpiCard label="Falharam" value={String(falhas)} hint="Veja o motivo na coluna Status" />
        </div>
      )}
      {loaded && rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Nenhuma mensagem agendada"
          description="Ao escrever na conversa, use o relógio do composer para programar o envio. O disparo acontece sozinho na hora marcada e o histórico fica aqui."
        />
      ) : (
        <DataTable data={rows} columns={columns} pageSize={15} />
      )}
    </div>
  );
}

/* ---------- Ações manuais (depende de Automações — fase futura) ---------- */

function AcoesManuaisTab() {
  return (
    <div>
      <h1 className="mb-4 text-lg font-bold text-slate-900">Ações manuais</h1>
      <EmptyState
        icon={Phone}
        title="Nenhuma ação manual pendente"
        description="Quando suas automações incluírem etapas manuais (ligar, enviar SMS), a fila aparece aqui. Chega junto com o módulo de Automações real."
      />
    </div>
  );
}

/* ---------- Trechos (reais) ---------- */

function TrechosTab() {
  const snippets = useSnippets();
  const loaded = useConvStore((s) => s.loaded);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim() || !content.trim()) {
      toast.error("Preencha nome e conteúdo");
      return;
    }
    setSaving(true);
    const ok = await snippetActions.add(name.trim(), content.trim());
    setSaving(false);
    if (!ok) {
      toast.error("Não foi possível salvar o trecho");
      return;
    }
    toast.success(`Trecho "${name.trim()}" criado — disponível no composer`);
    setName("");
    setContent("");
    setDialogOpen(false);
  };

  const columns: Column<(typeof snippets)[number]>[] = [
    {
      key: "nome",
      header: "Nome",
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => <span className="font-medium text-slate-800">{r.name}</span>,
    },
    {
      key: "conteudo",
      header: "Conteúdo",
      render: (r) => <span className="block max-w-xl truncate text-slate-500">{r.content}</span>,
    },
    {
      key: "acao",
      header: "",
      render: (r) => (
        <button
          onClick={async () => {
            if (!window.confirm(`Excluir o trecho "${r.name}"?`)) return;
            (await snippetActions.remove(r.id))
              ? toast.success("Trecho excluído")
              : toast.error("Não foi possível excluir");
          }}
          className="text-slate-300 hover:text-red-500"
        >
          <Trash2 className="size-3.5" />
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-slate-900">Trechos</h1>
          <Badge variant="secondary">{snippets.length} trechos</Badge>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setDialogOpen(true)}>
          <Plus className="size-3.5" /> Novo trecho
        </Button>
      </div>
      {loaded && snippets.length === 0 ? (
        <EmptyState
          icon={Smartphone}
          title="Nenhum trecho ainda"
          description="Crie respostas rápidas para inserir com um clique no composer da conversa."
          cta={
            <Button size="sm" className="text-xs" onClick={() => setDialogOpen(true)}>
              <Plus className="size-3.5" /> Criar trecho
            </Button>
          }
        />
      ) : (
        <DataTable data={snippets} columns={columns} pageSize={10} />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo trecho</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Tabela de preços"
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Conteúdo</Label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Olá! Nossos planos começam em..."
                className="min-h-24 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={create} disabled={saving}>
              {saving ? "Salvando..." : "Criar trecho"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- Links de acionamento (depende de Automações — fase futura) ---------- */

function LinksTab() {
  return (
    <div>
      <h1 className="mb-4 text-lg font-bold text-slate-900">Links de acionamento</h1>
      <EmptyState
        icon={Link2}
        title="Nenhum link de acionamento"
        description={`Links rastreáveis (${brand.shortName.toLowerCase()}.link/...) que disparam automações ao serem clicados. Chegam junto com o módulo de Automações real.`}
      />
    </div>
  );
}

/* ---------- Estatísticas (reais) ---------- */

const ALL_CHANNELS: Channel[] = ["whatsapp", "instagram", "facebook", "sms", "email"];

function EstatisticasTab() {
  const conversations = useConversations();
  const messages = useConvStore((s) => s.messages);

  const hoje = format(new Date(), "yyyy-MM-dd");
  const stats = useMemo(() => {
    const porCanal: Record<Channel, number> = {
      whatsapp: 0,
      instagram: 0,
      facebook: 0,
      sms: 0,
      email: 0,
    };
    conversations.forEach((c) => {
      porCanal[c.channel] += 1;
    });
    const abertas = conversations.filter((c) => !c.closedAt && !c.archivedAt);
    return {
      porCanal,
      abertas: abertas.length,
      finalizadas: conversations.filter((c) => !!c.closedAt).length,
      arquivadas: conversations.filter((c) => !!c.archivedAt).length,
      slaEstourado: abertas.filter((c) => c.slaDays > 0).length,
      totalMensagens: messages.length,
      mensagensHoje: messages.filter((m) => m.at.slice(0, 10) === hoje).length,
      enviadas: messages.filter((m) => m.direction === "out" && !m.internal).length,
    };
  }, [conversations, messages, hoje]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-bold text-slate-900">Estatísticas de conversas</h1>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Conversas abertas"
          value={String(stats.abertas)}
          hint="Fora as finalizadas e arquivadas"
        />
        <KpiCard
          label="Finalizadas"
          value={String(stats.finalizadas)}
          hint={`${stats.arquivadas} arquivadas`}
        />
        <KpiCard label="Mensagens hoje" value={String(stats.mensagensHoje)} />
        <KpiCard label="Mensagens enviadas (total)" value={String(stats.enviadas)} />
        <KpiCard
          label="SLA estourado"
          value={String(stats.slaEstourado)}
          hint="Conversas sem resposta acima do SLA alvo"
        />
      </div>
      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold text-slate-800">Conversas por canal</p>
        </div>
        <table className="w-full text-xs">
          <tbody>
            {ALL_CHANNELS.map((ch) => {
              const count = stats.porCanal[ch];
              const pct = stats.abertas > 0 ? Math.round((count / stats.abertas) * 100) : 0;
              return (
                <tr key={ch} className="border-b last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2 font-medium text-slate-700">
                      <ChannelIcon channel={ch} size={18} /> {channelLabel(ch)}
                    </span>
                  </td>
                  <td className="w-40 px-4 py-2.5">
                    <div className="h-1.5 w-full rounded-full bg-slate-100">
                      <div
                        className="h-1.5 rounded-full bg-indigo-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{count}</td>
                  <td className="w-16 px-4 py-2.5 text-right text-slate-400">{pct}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Configurações ---------- */

function ConfiguracoesTab() {
  const [notificacoes, setNotificacoes] = useState(true);
  const [atribuicao, setAtribuicao] = useState(true);
  const [respostaAuto, setRespostaAuto] = useState(false);
  const [marcarLida, setMarcarLida] = useState(true);
  const [slaAlvo, setSlaAlvo] = useState("4");

  const toggles = [
    {
      label: "Notificações de novas mensagens",
      description: "Receber alerta no navegador quando uma conversa chegar",
      value: notificacoes,
      set: setNotificacoes,
    },
    {
      label: "Atribuição automática",
      description: "Distribuir novas conversas entre a equipe (round-robin)",
      value: atribuicao,
      set: setAtribuicao,
    },
    {
      label: "Resposta automática fora do horário",
      description: "Enviar mensagem padrão fora do horário comercial",
      value: respostaAuto,
      set: setRespostaAuto,
    },
    {
      label: "Marcar como lida ao abrir",
      description: "Zerar contador de não lidas ao visualizar a conversa",
      value: marcarLida,
      set: setMarcarLida,
    },
  ];

  return (
    <div className="max-w-xl">
      <h1 className="mb-4 text-lg font-bold text-slate-900">Configurações da caixa de entrada</h1>
      <div className="space-y-3 rounded-xl border bg-white p-5">
        {toggles.map((t) => (
          <div key={t.label} className="flex items-center justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
            <div>
              <p className="text-xs font-semibold text-slate-800">{t.label}</p>
              <p className="text-[11px] text-slate-500">{t.description}</p>
            </div>
            <Switch checked={t.value} onCheckedChange={(v) => t.set(Boolean(v))} />
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 pt-1">
          <div>
            <p className="text-xs font-semibold text-slate-800">SLA alvo de resposta</p>
            <p className="text-[11px] text-slate-500">Tempo máximo para responder um lead</p>
          </div>
          <Select value={slaAlvo} onValueChange={(v) => v && setSlaAlvo(v)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue>{slaAlvo} horas</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {["1", "2", "4", "8", "24"].map((h) => (
                <SelectItem key={h} value={h} className="text-xs">
                  {h} horas
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          className="text-xs"
          onClick={() => toast.success("Preferências salvas (sessão)")}
        >
          Salvar
        </Button>
      </div>
    </div>
  );
}
