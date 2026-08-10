"use client";

import { useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ArrowLeft, Eye, Send, TestTube2, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDbContacts } from "@/lib/data/repos/db/contacts";
import { useContactsModule } from "@/lib/data/repos/db/contacts-module";
import { campaignActions, useDbCampaign } from "@/lib/data/repos/db/campaigns";
import { renderCampaignEmail } from "@/lib/email/marketing-template";
import { matchesConditions } from "@/components/contacts/module-tabs";
import { RichTextEditor } from "./rich-text-editor";
import { CAMPAIGN_TEMPLATES } from "./campaign-templates";
import type { Audience } from "@/lib/marketing/types";
import type { Contact } from "@/lib/data/types";
import { cn } from "@/lib/utils";

function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, name: string) => vars[name] ?? "");
}

function eligible(c: Contact): boolean {
  return Boolean(c.email && c.email.trim()) && !c.dnd;
}

export function CampaignComposer({
  campaignId,
  onClose,
  onSaved,
}: {
  campaignId: string | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const existing = useDbCampaign(campaignId ?? "");
  const { contacts } = useDbContacts();
  const { smartLists, fields } = useContactsModule();

  const [id, setId] = useState<string | null>(campaignId);
  const [name, setName] = useState(existing?.name ?? "Nova campanha");
  const [subject, setSubject] = useState(existing?.subject ?? "");
  const [replyTo, setReplyTo] = useState(existing?.replyTo ?? "");
  const [bodyHtml, setBodyHtml] = useState(existing?.bodyHtml ?? "<p>Escreva aqui…</p>");
  const [audience, setAudience] = useState<Audience>(existing?.audience ?? { type: "all", value: null });
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");

  const editorRef = useRef<Editor | null>(null);
  const insert = (text: string) => editorRef.current?.chain().focus().insertContent(text).run();

  const tags = useMemo(() => {
    const set = new Set<string>();
    contacts.forEach((c) => c.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [contacts]);

  // Contatos elegíveis do público escolhido (estimativa; o banco reforça na materialização).
  const audienceContacts = useMemo(() => {
    const base = contacts.filter(eligible);
    if (audience.type === "all") return base;
    if (audience.type === "tag") return base.filter((c) => audience.value && c.tags.includes(audience.value));
    if (audience.type === "smart_list") {
      const sl = smartLists.find((s) => s.id === audience.value);
      if (!sl) return [];
      return base.filter((c) => matchesConditions(c, sl.conditions));
    }
    return base;
  }, [contacts, audience, smartLists]);

  const preview = useMemo(() => {
    const sample = audienceContacts[0] ?? contacts[0];
    const vars: Record<string, string> = {
      nome: sample ? [sample.firstName, sample.lastName].filter(Boolean).join(" ") : "Maria",
      email: sample?.email ?? "maria@exemplo.com",
      ...(sample?.customFields ?? {}),
    };
    return renderCampaignEmail({
      subject: fillTemplate(subject, vars),
      bodyHtml: fillTemplate(bodyHtml, vars),
      unsubscribeUrl: "#",
    });
  }, [subject, bodyHtml, audienceContacts, contacts]);

  async function ensureSaved(): Promise<string | null> {
    setSaving(true);
    try {
      const payload = {
        name: name.trim() || "Nova campanha",
        subject,
        replyTo: replyTo.trim() || null,
        bodyHtml,
        bodyText: "",
        audience,
      };
      if (id) {
        const ok = await campaignActions.update(id, payload);
        return ok ? id : null;
      }
      const newId = await campaignActions.create(payload);
      if (newId) setId(newId);
      return newId;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDraft() {
    const saved = await ensureSaved();
    if (saved) {
      toast.success("Rascunho salvo");
      onSaved(saved);
    } else {
      toast.error("Não foi possível salvar");
    }
  }

  async function handleTest() {
    const saved = await ensureSaved();
    if (!saved) return toast.error("Salve o rascunho primeiro");
    const res = await fetch(`/api/marketing/campaigns/${saved}/test`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) toast.success(`Teste enviado para ${json.to}`);
    else toast.error(json.error ?? "Falha ao enviar teste");
  }

  async function publish(mode: "now" | "scheduled", scheduledAt?: string) {
    const saved = await ensureSaved();
    if (!saved) return toast.error("Salve o rascunho primeiro");
    const contactIds =
      audience.type === "smart_list" ? audienceContacts.map((c) => c.id) : undefined;
    const res = await fetch(`/api/marketing/campaigns/${saved}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, scheduledAt, contactIds }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      await campaignActions.refresh(saved);
      toast.success(mode === "now" ? "Campanha em envio!" : "Campanha agendada!");
      onSaved(saved);
    } else {
      toast.error(json.error ?? "Falha ao publicar");
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={onClose}>
            <ArrowLeft className="size-3.5" /> Voltar
          </Button>
          <h1 className="text-lg font-bold text-slate-900">Compor campanha</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={saving} onClick={handleSaveDraft}>
            Salvar rascunho
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={saving} onClick={handleTest}>
            <TestTube2 className="size-3.5" /> Enviar teste
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={saving} onClick={() => setScheduleOpen(true)}>
            <Timer className="size-3.5" /> Agendar
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={saving}
            onClick={() => {
              if (window.confirm(`Enviar agora para ${audienceContacts.length} contato(s)?`)) void publish("now");
            }}
          >
            <Send className="size-3.5" /> Enviar agora
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Coluna principal */}
        <div className="space-y-3 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome interno</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Responder para (opcional)</Label>
              <Input
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                placeholder="contato@suaempresa.com"
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Assunto</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto do e-mail" className="h-8 text-xs" />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-500">Inserir:</span>
            <VarChip onClick={() => insert("{{nome}}")}>{"{{nome}}"}</VarChip>
            <VarChip onClick={() => insert("{{email}}")}>{"{{email}}"}</VarChip>
            {fields.map((f) => (
              <VarChip key={f.id} onClick={() => insert(`{{${f.name}}}`)}>{`{{${f.name}}}`}</VarChip>
            ))}
          </div>

          <RichTextEditor value={bodyHtml} onChange={setBodyHtml} onEditorReady={(e) => (editorRef.current = e)} />
        </div>

        {/* Coluna lateral */}
        <div className="space-y-3">
          <div className="rounded-xl border bg-white p-4">
            <p className="mb-2 text-xs font-semibold text-slate-800">Modelos</p>
            <div className="grid grid-cols-2 gap-1.5">
              {CAMPAIGN_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setSubject(t.subject);
                    setBodyHtml(t.html);
                    editorRef.current?.commands.setContent(t.html);
                    toast.info(`Modelo "${t.name}" aplicado`);
                  }}
                  title={t.description}
                  className="rounded-lg border px-2.5 py-2 text-left text-[11px] font-medium text-slate-700 hover:border-indigo-300 hover:bg-indigo-50"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border bg-white p-4">
            <p className="mb-2 text-xs font-semibold text-slate-800">Público</p>
            <Select
              value={audience.type}
              onValueChange={(v) => v && setAudience({ type: v as Audience["type"], value: null })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue>
                  {audience.type === "all" ? "Todos os contatos" : audience.type === "tag" ? "Por tag" : "Lista inteligente"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos os contatos</SelectItem>
                <SelectItem value="tag" className="text-xs">Por tag</SelectItem>
                <SelectItem value="smart_list" className="text-xs">Lista inteligente</SelectItem>
              </SelectContent>
            </Select>

            {audience.type === "tag" && (
              <Select value={audience.value ?? ""} onValueChange={(v) => setAudience({ type: "tag", value: v })}>
                <SelectTrigger className="mt-2 h-8 text-xs">
                  <SelectValue>{audience.value || "Escolha a tag"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {tags.map((t) => (
                    <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {audience.type === "smart_list" && (
              <Select value={audience.value ?? ""} onValueChange={(v) => setAudience({ type: "smart_list", value: v })}>
                <SelectTrigger className="mt-2 h-8 text-xs">
                  <SelectValue>
                    {smartLists.find((s) => s.id === audience.value)?.name || "Escolha a lista"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {smartLists.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <p className="mt-3 text-xs text-slate-500">
              <span className="text-2xl font-bold text-indigo-600">{audienceContacts.length}</span> destinatário(s) elegível(is)
            </p>
            <p className="text-[11px] text-slate-400">Sem e-mail, DND ou descadastrados são ignorados no envio.</p>
          </div>

          <Button variant="outline" size="sm" className="h-8 w-full gap-1.5 text-xs" onClick={() => setPreviewOpen(true)}>
            <Eye className="size-3.5" /> Pré-visualizar
          </Button>
        </div>
      </div>

      {/* Prévia */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Prévia · {subject || "(sem assunto)"}</DialogTitle>
          </DialogHeader>
          <iframe title="Prévia do e-mail" srcDoc={preview.html} className="h-[60vh] w-full rounded-lg border" />
        </DialogContent>
      </Dialog>

      {/* Agendamento */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Agendar envio</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Data e hora</Label>
            <Input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <DialogFooter>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!scheduleAt}
              onClick={async () => {
                setScheduleOpen(false);
                await publish("scheduled", new Date(scheduleAt).toISOString());
              }}
            >
              Agendar para {audienceContacts.length} contato(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VarChip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 font-mono text-[11px] text-indigo-700",
        "hover:bg-indigo-100",
      )}
    >
      {children}
    </button>
  );
}
