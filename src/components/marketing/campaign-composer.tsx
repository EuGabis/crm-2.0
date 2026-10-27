"use client";

import { useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  ArrowLeft,
  Eye,
  Loader2,
  Monitor,
  Paperclip,
  PenLine,
  Send,
  Smartphone,
  TestTube2,
  Timer,
  X,
} from "lucide-react";
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
import { useBrandBoards } from "@/lib/data/repos/db/brand-boards";
import { campaignActions, useDbCampaign } from "@/lib/data/repos/db/campaigns";
import { renderCampaignEmail } from "@/lib/email/marketing-template";
import { DESIGN_PADRAO, type DesignEmail } from "@/lib/email/design";
import { MAX_ANEXOS, formatarTamanho, type AnexoEmail } from "@/lib/email/anexos";
import { enviarMidiaDeEmail } from "@/lib/data/repos/db/email-midia";
import { useAccount } from "@/lib/data/repos/db/account";
import { PainelDesign } from "./painel-design";
import { matchesConditions } from "@/components/contacts/module-tabs";
import { RichTextEditor } from "./rich-text-editor";
import { CAMPAIGN_TEMPLATES } from "./campaign-templates";
import { valoresDoPublico, type Audience } from "@/lib/marketing/types";
import { MultiEscolha } from "./multi-escolha";
import type { Contact } from "@/lib/data/types";
import { cn } from "@/lib/utils";

function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, name: string) => vars[name] ?? "");
}

function eligible(c: Contact): boolean {
  return Boolean(c.email && c.email.trim()) && !c.dnd;
}

/*
 * Seletor do tipo de público. Tags e listas inteligentes usam `MultiEscolha`
 * (várias de uma vez). Nomes de lista inteligente e de tag passam de 30
 * caracteres ("Contatos reativação futura", "contatos venda guru webinar"), e o
 * Select nascia na largura do botão com o texto sem quebra — o nome saía
 * cortado e duas listas de começo igual ficavam indistinguíveis. Agora o botão
 * ocupa o painel, a lista abre ABAIXO dele (não sobre o item marcado) com
 * rolagem própria, e o nome longo quebra em vez de sumir.
 */
const LISTA = "w-(--anchor-width) max-h-72";

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
  const { contacts, loading: carregandoContatos } = useDbContacts();
  const { smartLists, fields } = useContactsModule();
  const { boards } = useBrandBoards();

  const [id, setId] = useState<string | null>(campaignId);
  const [name, setName] = useState(existing?.name ?? "Nova campanha");
  const [subject, setSubject] = useState(existing?.subject ?? "");
  const [replyTo, setReplyTo] = useState(existing?.replyTo ?? "");
  const [bodyHtml, setBodyHtml] = useState(existing?.bodyHtml ?? "<p>Escreva aqui…</p>");
  const [audience, setAudience] = useState<Audience>(existing?.audience ?? { type: "all", value: null });
  const [brandId, setBrandId] = useState("");
  const [design, setDesign] = useState<DesignEmail>(existing?.design ?? DESIGN_PADRAO);
  const [anexos, setAnexos] = useState<AnexoEmail[]>(existing?.attachments ?? []);
  const [subindo, setSubindo] = useState(0);
  const [aba, setAba] = useState<"escrever" | "ver">("escrever");
  const [tela, setTela] = useState<"pc" | "celular">("pc");
  const anexoRef = useRef<HTMLInputElement>(null);
  const { company } = useAccount();
  const paleta = boards.find((b) => b.id === brandId)?.palette ?? [];
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const editorRef = useRef<Editor | null>(null);
  const insert = (text: string) => editorRef.current?.chain().focus().insertContent(text).run();

  const tags = useMemo(() => {
    const set = new Set<string>();
    contacts.forEach((c) => c.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [contacts]);

  const escolhidos = useMemo(() => valoresDoPublico(audience), [audience]);
  const setEscolhidos = (v: string[]) =>
    setAudience((a) => ({ type: a.type, value: v[0] ?? null, values: v }));

  // Contatos elegíveis do público escolhido (estimativa; o banco reforça na
  // materialização). Com várias tags/listas o público é a UNIÃO — quem está em
  // duas listas recebe um e-mail só (o banco também deduplica por contato).
  const audienceContacts = useMemo(() => {
    const base = contacts.filter(eligible);
    if (audience.type === "all") return base;
    if (audience.type === "tag") {
      const alvo = new Set(escolhidos);
      return base.filter((c) => c.tags.some((t) => alvo.has(t)));
    }
    if (audience.type === "smart_list") {
      const listas = smartLists.filter((s) => escolhidos.includes(s.id));
      if (listas.length === 0) return [];
      return base.filter((c) => listas.some((sl) => matchesConditions(c, sl.conditions)));
    }
    return base;
  }, [contacts, audience.type, escolhidos, smartLists]);

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
      design,
      anexos,
    });
  }, [subject, bodyHtml, audienceContacts, contacts, design, anexos]);

  /** Anexos sobem em série; o que falha diz por quê e não trava os outros. */
  async function adicionarAnexos(files: File[]) {
    const vagas = MAX_ANEXOS - anexos.length;
    if (files.length > vagas) toast.error(`No máximo ${MAX_ANEXOS} arquivos por campanha`);
    const lote = files.slice(0, Math.max(0, vagas));
    setSubindo((n) => n + lote.length);
    for (const f of lote) {
      const r = await enviarMidiaDeEmail(f, "anexo");
      setSubindo((n) => n - 1);
      if (r.ok) setAnexos((a) => [...a, r.arquivo]);
      else toast.error(`${f.name}: ${r.erro}`);
    }
  }

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
        // `accent_color` acompanha o design: campanha lida por código antigo
        // (ou com a migração atrasada) ainda sai com a cor de destaque certa.
        accentColor: design.corDestaque,
        design,
        attachments: anexos,
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
    /*
     * ⚠️ Tag e lista mandam os ids resolvidos aqui: o banco (0010) só sabe
     * materializar UMA tag (`audience.value`), então com várias as demais
     * ficariam de fora. Com a carga de contatos ainda em andamento, a lista
     * estaria incompleta — e campanha enviada não tem desfazer.
     */
    if (audience.type !== "all" && carregandoContatos) {
      return toast.error("Aguarde carregar os contatos antes de enviar");
    }
    if (audience.type !== "all" && escolhidos.length === 0) {
      return toast.error(audience.type === "tag" ? "Escolha ao menos uma tag" : "Escolha ao menos uma lista");
    }
    const contactIds = audience.type === "all" ? undefined : audienceContacts.map((c) => c.id);
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
            onClick={() => setConfirmOpen(true)}
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

          <div className="flex items-center justify-between gap-2">
            <div className="flex rounded-lg border bg-white p-0.5">
              {(
                [
                  ["escrever", PenLine, "Escrever"],
                  ["ver", Eye, "Ver como fica"],
                ] as const
              ).map(([k, Icon, l]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAba(k)}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium",
                    aba === k ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50",
                  )}
                >
                  <Icon className="size-3.5" /> {l}
                </button>
              ))}
            </div>
            {aba === "ver" && (
              <div className="flex rounded-lg border bg-white p-0.5">
                {(
                  [
                    ["pc", Monitor, "Computador"],
                    ["celular", Smartphone, "Celular"],
                  ] as const
                ).map(([k, Icon, l]) => (
                  <button
                    key={k}
                    type="button"
                    title={l}
                    onClick={() => setTela(k)}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-md",
                      tela === k ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:text-slate-700",
                    )}
                  >
                    <Icon className="size-3.5" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* O editor fica MONTADO na aba de prévia (só escondido): desmontar
              perderia o histórico de desfazer e a seleção. */}
          <div className={cn(aba !== "escrever" && "hidden")}>
            <RichTextEditor
              value={bodyHtml}
              onChange={setBodyHtml}
              onEditorReady={(e) => (editorRef.current = e)}
              design={design}
              sugestoesCor={paleta}
            />
          </div>
          {aba === "ver" && (
            <div className="rounded-lg border bg-slate-100 p-3">
              <iframe
                title="Prévia do e-mail"
                srcDoc={preview.html}
                className="mx-auto block h-[70vh] rounded-md border bg-white transition-all"
                style={{ width: tela === "pc" ? "100%" : 390 }}
              />
            </div>
          )}

          <div className="rounded-xl border bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                <Paperclip className="size-3.5" /> Anexos
                {anexos.length > 0 && <span className="font-normal text-slate-400">({anexos.length})</span>}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                disabled={anexos.length >= MAX_ANEXOS}
                onClick={() => anexoRef.current?.click()}
              >
                {subindo > 0 ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
                Adicionar arquivo
              </Button>
              <input
                ref={anexoRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void adicionarAnexos(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </div>
            {anexos.length > 0 ? (
              <ul className="space-y-1.5">
                {anexos.map((a, i) => (
                  <li key={a.url} className="flex items-center gap-2 rounded-lg border bg-slate-50 px-2.5 py-1.5 text-xs">
                    <Paperclip className="size-3.5 shrink-0 text-slate-400" />
                    <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-slate-700 hover:underline">
                      {a.name}
                    </a>
                    <span className="shrink-0 text-slate-400">{formatarTamanho(a.size)}</span>
                    <button
                      type="button"
                      onClick={() => setAnexos((xs) => xs.filter((_, j) => j !== i))}
                      className="text-slate-400 hover:text-red-500"
                      aria-label={`Remover ${a.name}`}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void adicionarAnexos(Array.from(e.dataTransfer.files));
                }}
                className="rounded-lg border-2 border-dashed border-slate-200 p-4 text-center text-[11px] text-slate-400"
              >
                Arraste arquivos aqui (PDF, planilha, apresentação… até 20 MB cada)
              </p>
            )}
            <p className="mt-2 text-[10px] leading-snug text-slate-400">
              Os arquivos aparecem no fim do e-mail como botões de download. O envio em massa não
              aceita anexo direto no e-mail — e anexo pesado em campanha é um dos maiores motivos de
              cair no spam.
            </p>
          </div>
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

          {boards.length > 0 && (
            <div className="rounded-xl border bg-white p-4">
              <p className="mb-2 text-xs font-semibold text-slate-800">Marca</p>
              <Select
                value={brandId || "__default__"}
                onValueChange={(v) => {
                  if (!v || v === "__default__") return setBrandId("");
                  setBrandId(v);
                  const pal = boards.find((b) => b.id === v)?.palette ?? [];
                  // A marca sugere as cores; tudo continua editável no painel abaixo.
                  setDesign((d) => ({
                    ...d,
                    ...(pal[0] ? { corDestaque: pal[0] } : {}),
                    ...(pal[1] ? { corCabecalho: pal[1], corTitulo: pal[1] } : {}),
                  }));
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue>{boards.find((b) => b.id === brandId)?.name ?? "Nenhuma"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__" className="text-xs">Nenhuma</SelectItem>
                  {boards.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {paleta.length > 0 && (
                <div className="mt-2 flex gap-1">
                  {paleta.map((c) => (
                    <span key={c} className="size-5 rounded border" style={{ backgroundColor: c }} title={c} />
                  ))}
                </div>
              )}
            </div>
          )}

          <PainelDesign
            design={design}
            onChange={setDesign}
            sugestoesCor={paleta}
            logoEmpresa={company?.logoUrl || null}
          />

          <div className="rounded-xl border bg-white p-4">
            <p className="mb-2 text-xs font-semibold text-slate-800">Público</p>
            <Select
              value={audience.type}
              onValueChange={(v) => v && setAudience({ type: v as Audience["type"], value: null })}
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue>
                  {audience.type === "all" ? "Todos os contatos" : audience.type === "tag" ? "Por tag" : "Lista inteligente"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className={LISTA} alignItemWithTrigger={false}>
                <SelectItem value="all" className="text-xs">Todos os contatos</SelectItem>
                <SelectItem value="tag" className="text-xs">Por tag</SelectItem>
                <SelectItem value="smart_list" className="text-xs">Lista inteligente</SelectItem>
              </SelectContent>
            </Select>

            {audience.type === "tag" && (
              <MultiEscolha
                opcoes={tags.map((t) => ({ value: t, label: t }))}
                value={escolhidos}
                onChange={setEscolhidos}
                placeholder="Escolha as tags"
                vazio="Nenhuma tag encontrada"
              />
            )}

            {audience.type === "smart_list" && (
              <MultiEscolha
                opcoes={smartLists.map((sl) => ({ value: sl.id, label: sl.name }))}
                value={escolhidos}
                onChange={setEscolhidos}
                placeholder="Escolha as listas"
                vazio="Nenhuma lista encontrada"
              />
            )}

            <p className="mt-3 text-xs text-slate-500">
              {carregandoContatos && audience.type !== "all" ? (
                <span className="text-slate-400">Carregando contatos…</span>
              ) : (
                <>
                  <span className="text-2xl font-bold text-indigo-600">{audienceContacts.length}</span> destinatário(s) elegível(is)
                </>
              )}
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

      {/* Confirmação de envio */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Enviar campanha agora?</DialogTitle>
          </DialogHeader>
          <p className="text-xs leading-relaxed text-slate-500">
            A campanha vai ser enviada para{" "}
            <strong className="text-slate-800">{audienceContacts.length} contato(s)</strong> elegível(is).
            Essa ação não pode ser desfeita.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={async () => {
                setConfirmOpen(false);
                await publish("now");
              }}
            >
              <Send className="size-3.5" /> Enviar agora
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
