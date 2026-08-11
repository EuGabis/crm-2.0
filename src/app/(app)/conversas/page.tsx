"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Link2, Phone, Plus, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SubNav } from "@/components/layout/subnav";
import { Composer } from "@/components/inbox/composer";
import { ContactPanel } from "@/components/inbox/contact-panel";
import { ConversationList } from "@/components/inbox/conversation-list";
import { Thread } from "@/components/inbox/thread";
import { ViewsRail } from "@/components/inbox/views-rail";
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
import {
  conversationActions,
  snippetActions,
  useConvStore,
  useConversation,
  useConversations,
  useSnippets,
} from "@/lib/data/repos/db/conversations";
import { brand } from "@/lib/config/brand";
import type { Channel } from "@/lib/data/types";

const TABS = [
  { label: "Conversas" },
  { label: "Ações manuais" },
  { label: "Trechos" },
  { label: "Links de acionamento" },
  { label: "Estatísticas" },
  { label: "Configurações" },
];

export default function ConversasPage() {
  const [tab, setTab] = useState("Conversas");
  const conversations = useConversations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
          {tab === "Ações manuais" && <AcoesManuaisTab />}
          {tab === "Trechos" && <TrechosTab />}
          {tab === "Links de acionamento" && <LinksTab />}
          {tab === "Estatísticas" && <EstatisticasTab />}
          {tab === "Configurações" && <ConfiguracoesTab />}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ViewsRail onNew={() => setNewOpen(true)} />
          <ConversationList
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNew={() => setNewOpen(true)}
          />
          {selectedId ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Thread conversationId={selectedId} />
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
          {selectedConversation && <ContactPanel contactId={selectedConversation.contactId} />}
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
  const [contactId, setContactId] = useState("");
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!contactId) {
      toast.error("Escolha um contato");
      return;
    }
    setSaving(true);
    const id = await conversationActions.open(contactId, channel);
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
    return {
      porCanal,
      abertas: conversations.length,
      slaEstourado: conversations.filter((c) => c.slaDays > 0).length,
      totalMensagens: messages.length,
      mensagensHoje: messages.filter((m) => m.at.slice(0, 10) === hoje).length,
      enviadas: messages.filter((m) => m.direction === "out" && !m.internal).length,
    };
  }, [conversations, messages, hoje]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-bold text-slate-900">Estatísticas de conversas</h1>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Conversas abertas" value={String(stats.abertas)} />
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
