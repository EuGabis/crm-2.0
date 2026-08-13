# Agentes de IA — abas restantes reais — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar reais as abas do `/agentes-ia` que ainda eram mock (Content AI, Modelos de agente, Logs) reusando a fundação de IA, e marcar honestamente como "em breve" as que dependem do que ainda não temos (IA de voz, Base de Conhecimento).

**Architecture:** Extrair cada aba real num componente em `src/components/ai/` (como o `ConversationAiTab` já existente) e ligá-lo na página. Content AI usa `aiActions.generate`; Modelos usa `aiAgentActions.create/update` + navegação; Logs usa `useAiLogs`. IA de voz e Base de Conhecimento viram `EmptyState`. Sem migração, sem rota nova.

**Tech Stack:** Next.js (App Router) · TypeScript · Tailwind · shadcn/ui (Base UI) · repos existentes (`db/ai.ts`, `db/ai-agents.ts`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-13-agentes-ia-abas-reais-design.md`. Convenções: `AGENTS.md`.
- **Sem migração, sem rota nova.** Só front-end reusando o que já está em produção:
  - `aiActions.generate({ system?, prompt, feature? }): Promise<{ ok, text?, error? }>` — de `@/lib/data/repos/db/ai`.
  - `useAiLogs(limit): { logs: AiLog[]; ready }`; `AiLog = { id, feature, model, prompt, response, promptTokens, completionTokens, createdAt }` — de `@/lib/data/repos/db/ai`.
  - `aiAgentActions.create({name}): Promise<{ ok, id?, error? }>` e `aiAgentActions.update(id, patch): Promise<boolean>` — de `@/lib/data/repos/db/ai-agents`.
- **Base UI, não Radix:** `Select`/`SelectValue` com children explícito; `onValueChange` recebe `string | null` (guardar com `v && ...`); sem `asChild`.
- **Sem runner de testes:** verificação = `npx tsc --noEmit` **e** `npm run build` limpos (o build do Next roda eslint e ACUSA import/variável não usado — usar isso para garantir que não sobrou órfão). Rodar do repo `C:\Users\Gabriel\Documents\crm 2.0` (NÃO de worktree).
- **Texto pt-BR.** Estilo `AGENTS.md`: h1 `text-lg font-bold text-slate-900`; cards `rounded-xl border bg-white`; tabelas `text-xs`; botões `h-8 text-xs`; badge sucesso `bg-emerald-100 text-emerald-700`; primário indigo.
- **Commits `feat(ia): ...`.** Branch → PR → squash na `main`. Área do Claude B (UI/IA).
- **Não alterar** o `ConversationAiTab` nem a aba "Começando".

---

## File Structure

**Criar:**
- `src/components/ai/content-ai-tab.tsx` — aba Content AI real.
- `src/components/ai/agent-templates-tab.tsx` — aba Modelos de agente real.
- `src/components/ai/ai-logs-tab.tsx` — aba Logs real.

**Modificar:**
- `src/app/(app)/agentes-ia/page.tsx` — trocar os blocos inline de Content AI, Modelos, Logs pelos componentes; trocar IA de voz e Base de Conhecimento por `EmptyState` "em breve"; remover mocks/estado/imports órfãos.

**Referência (ler, não modificar):**
- `src/components/ai/conversation-ai-tab.tsx` — padrão de componente de aba.
- `src/components/shared/empty-state.tsx` (ou equivalente) — confirmar nome/props do `EmptyState`.

---

## Task 1: Content AI real

Extrai a aba Content AI num componente que gera texto de verdade. Deliverable: componente pronto + build limpo.

**Files:**
- Create: `src/components/ai/content-ai-tab.tsx`

**Interfaces:**
- Consumes: `aiActions.generate` de `@/lib/data/repos/db/ai`.
- Produces: `export function ContentAiTab()`.

- [ ] **Step 1: Confirmar o EmptyState e o padrão**

Antes de escrever, abrir `src/components/ai/conversation-ai-tab.tsx` (padrão de imports/estilo). Não é necessário `EmptyState` aqui.

- [ ] **Step 2: Escrever o componente**

Create `src/components/ai/content-ai-tab.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Copy, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { aiActions } from "@/lib/data/repos/db/ai";

const FORMATS: Record<string, string> = {
  "Post Instagram":
    "um post para Instagram: curto, com emojis e hashtags relevantes ao final",
  "E-mail": "um e-mail de marketing: comece com uma linha 'Assunto:' e depois o corpo",
  Anúncio: "um anúncio curto e persuasivo, com uma chamada para ação (CTA) clara",
};

export function ContentAiTab() {
  const [format, setFormat] = useState("Post Instagram");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    const p = prompt.trim();
    if (!p) return toast.error("Descreva o que você quer criar");
    setLoading(true);
    setResult(null);
    const system = `Você é redator de marketing e vendas do Lito CRM. Escreva em português do Brasil, tom persuasivo e claro. Formato: ${FORMATS[format]}. Devolva apenas o texto final, pronto para publicar, sem comentários seus.`;
    const res = await aiActions.generate({ feature: "content", system, prompt: p });
    setLoading(false);
    if (res.ok) setResult(res.text ?? "");
    else toast.error(res.error ?? "Falha ao gerar");
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      toast.success("Copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  return (
    <>
      <h1 className="mb-1 text-lg font-bold text-slate-900">Content AI</h1>
      <p className="mb-4 text-xs text-slate-500">
        Gere textos de marketing e vendas prontos para usar nos seus canais.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">O que você quer criar?</Label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ex.: um texto convidando leads para testar o CRM por 7 dias grátis"
                className="min-h-24 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Formato</Label>
              <Select value={format} onValueChange={(v) => v && setFormat(v)}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue>{format}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(FORMATS).map((f) => (
                    <SelectItem key={f} value={f} className="text-xs">
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" className="h-8 text-xs" onClick={generate} disabled={loading}>
              <Sparkles className="size-3.5" /> {loading ? "Gerando..." : "Gerar"}
            </Button>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Resultado</h2>
            {result && (
              <button onClick={copy} className="flex items-center gap-1 text-[11px] text-indigo-600 hover:underline">
                <Copy className="size-3" /> Copiar
              </button>
            )}
          </div>
          {result ? (
            <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{result}</p>
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-center text-xs text-slate-400">
              {loading ? "Gerando conteúdo..." : "O conteúdo gerado aparecerá aqui."}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros. (Ainda não ligado na página — só compila.)

- [ ] **Step 4: Commit**

```bash
git add src/components/ai/content-ai-tab.tsx
git commit -m "feat(ia): aba Content AI real (gera texto via OpenAI)"
```

---

## Task 2: Modelos de agente real

Extrai a aba que cria um agente real a partir de um modelo. Deliverable: componente pronto + build limpo.

**Files:**
- Create: `src/components/ai/agent-templates-tab.tsx`

**Interfaces:**
- Consumes: `aiAgentActions` de `@/lib/data/repos/db/ai-agents`.
- Produces: `export function AgentTemplatesTab({ onUsed }: { onUsed: () => void })` — `onUsed` é chamado após criar o agente (a página troca para a aba "Conversation AI").

- [ ] **Step 1: Escrever o componente**

Create `src/components/ai/agent-templates-tab.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { aiAgentActions } from "@/lib/data/repos/db/ai-agents";

interface Template {
  name: string;
  description: string;
  personality: string;
  goal: string;
}

const AGENT_TEMPLATES: Template[] = [
  {
    name: "SDR de qualificação",
    description:
      "Qualifica leads com perguntas de orçamento, prazo e necessidade antes de passar ao time comercial.",
    personality:
      "Você é um SDR simpático e objetivo do Lito CRM. Faz perguntas de qualificação de forma leve e consultiva, uma de cada vez, sem parecer interrogatório.",
    goal: "Descobrir orçamento, prazo e necessidade do lead e, quando qualificado, encaminhar ao time comercial.",
  },
  {
    name: "Suporte N1",
    description:
      "Responde dúvidas frequentes usando a Base de Conhecimento e transfere casos complexos para humanos.",
    personality:
      "Você é um atendente de suporte paciente e claro do Lito CRM. Explica em passos simples e confirma se resolveu.",
    goal: "Resolver dúvidas comuns rapidamente e transferir para um humano quando o caso for complexo.",
  },
  {
    name: "Recuperação de carrinho",
    description:
      "Aborda contatos que abandonaram o checkout com ofertas e responde objeções em tempo real.",
    personality:
      "Você é um vendedor persuasivo e cordial do Lito CRM. Aborda quem abandonou o checkout com empatia e senso de oportunidade.",
    goal: "Reengajar o contato, responder objeções e levá-lo a concluir a compra.",
  },
  {
    name: "Agendadora de reuniões",
    description:
      "Negocia horários e marca demonstrações direto no calendário conectado, sem intervenção humana.",
    personality:
      "Você é uma assistente de agendamento eficiente e educada do Lito CRM. Propõe horários de forma clara e confirma os detalhes.",
    goal: "Negociar um horário e marcar uma demonstração com o contato.",
  },
];

export function AgentTemplatesTab({ onUsed }: { onUsed: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  const use = async (t: Template) => {
    setBusy(t.name);
    const created = await aiAgentActions.create({ name: t.name });
    if (!created.ok || !created.id) {
      setBusy(null);
      return toast.error(created.error ?? "Não foi possível criar o agente");
    }
    await aiAgentActions.update(created.id, { personality: t.personality, goal: t.goal });
    setBusy(null);
    toast.success("Agente criado a partir do modelo");
    onUsed();
  };

  return (
    <>
      <h1 className="mb-1 text-lg font-bold text-slate-900">Modelos de agente</h1>
      <p className="mb-4 text-xs text-slate-500">
        Comece com um modelo pronto e personalize a personalidade e as metas depois.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {AGENT_TEMPLATES.map((t) => (
          <div key={t.name} className="flex flex-col rounded-xl border bg-white p-4">
            <span className="mb-2 flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
              <Sparkles className="size-4" />
            </span>
            <p className="text-sm font-semibold text-slate-800">{t.name}</p>
            <p className="mt-1 flex-1 text-xs text-slate-500">{t.description}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 h-8 text-xs"
              onClick={() => use(t)}
              disabled={busy !== null}
            >
              {busy === t.name ? "Criando..." : "Usar modelo"}
            </Button>
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/agent-templates-tab.tsx
git commit -m "feat(ia): aba Modelos de agente cria agente real"
```

---

## Task 3: Logs real

Extrai a aba Logs mostrando os `ai_logs` reais. Deliverable: componente pronto + build limpo.

**Files:**
- Create: `src/components/ai/ai-logs-tab.tsx`

**Interfaces:**
- Consumes: `useAiLogs` de `@/lib/data/repos/db/ai`.
- Produces: `export function AiLogsTab()`.

- [ ] **Step 1: Confirmar EmptyState**

Abrir `src/components/shared/` e confirmar o nome/caminho e as props do componente de estado vazio (ex.: `EmptyState` com `title`/`description`/`icon`). Usar o que existir; se o formato divergir do abaixo, adaptar e registrar no relatório. Se não houver, usar um bloco simples `rounded-xl border border-dashed p-8 text-center`.

- [ ] **Step 2: Escrever o componente**

Create `src/components/ai/ai-logs-tab.tsx` (ajuste o import/props do EmptyState conforme o Step 1):

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { useAiLogs } from "@/lib/data/repos/db/ai";

const FEATURE_LABEL: Record<string, string> = {
  generate: "Geração de texto",
  content: "Content AI",
  "agent-test": "Teste de bot",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function AiLogsTab() {
  const { logs, ready } = useAiLogs(30);

  return (
    <>
      <h1 className="mb-1 text-lg font-bold text-slate-900">Logs de atividade da IA</h1>
      <p className="mb-4 text-xs text-slate-500">
        Últimas gerações e testes executados pela sua IA.
      </p>
      {ready && logs.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-8 text-center">
          <p className="text-sm font-semibold text-slate-700">Nenhuma atividade ainda</p>
          <p className="mt-1 text-xs text-slate-500">
            Gere um conteúdo no Content AI ou teste um bot no Conversation AI para ver os registros aqui.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-[11px] text-slate-400">
                <th className="px-4 py-2.5 font-medium">Data/hora</th>
                <th className="px-4 py-2.5 font-medium">Recurso</th>
                <th className="px-4 py-2.5 font-medium">Modelo</th>
                <th className="px-4 py-2.5 font-medium">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5 text-slate-500">{formatDateTime(log.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant="secondary">{FEATURE_LABEL[log.feature] ?? log.feature}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{log.model}</td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {log.promptTokens + log.completionTokens}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/ai/ai-logs-tab.tsx
git commit -m "feat(ia): aba Logs mostra ai_logs reais"
```

---

## Task 4: Ligar na página + "em breve" + limpeza

Liga os 3 componentes na página, troca IA de voz e Base de Conhecimento por "em breve", e remove todo o mock/estado/imports órfãos. Deliverable: página real + build limpo (sem símbolo não usado).

**Files:**
- Modify: `src/app/(app)/agentes-ia/page.tsx`

**Interfaces:**
- Consumes: `ContentAiTab`, `AgentTemplatesTab`, `AiLogsTab` (Tasks 1-3).

- [ ] **Step 1: Trocar os blocos das abas**

Em `src/app/(app)/agentes-ia/page.tsx`:
- Imports novos:
  ```tsx
  import { ContentAiTab } from "@/components/ai/content-ai-tab";
  import { AgentTemplatesTab } from "@/components/ai/agent-templates-tab";
  import { AiLogsTab } from "@/components/ai/ai-logs-tab";
  ```
- Substituir o bloco inteiro `{tab === "Content AI" && ( ... )}` por `{tab === "Content AI" && <ContentAiTab />}`.
- Substituir `{tab === "Modelos de agente" && ( ... )}` por `{tab === "Modelos de agente" && <AgentTemplatesTab onUsed={() => setTab("Conversation AI")} />}`.
- Substituir `{tab === "Logs" && ( ... )}` por `{tab === "Logs" && <AiLogsTab />}`.
- Manter `{tab === "Conversation AI" && <ConversationAiTab />}` e o bloco "Começando" intactos.

- [ ] **Step 2: IA de voz e Base de Conhecimento → "em breve"**

Substituir o bloco `{tab === "IA de voz" && ( ... )}` por um estado honesto (ícone `Mic`):
```tsx
{tab === "IA de voz" && (
  <div className="mx-auto max-w-lg rounded-xl border border-dashed bg-white p-8 text-center">
    <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
      <Mic className="size-5" />
    </span>
    <h1 className="text-lg font-bold text-slate-900">IA de voz — em breve</h1>
    <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
      Um agente que atende ligações por telefone e agenda compromissos por voz. Precisa de um
      provedor de voz conectado — chega numa próxima etapa.
    </p>
  </div>
)}
```
Substituir o bloco `{tab === "Base de Conhecimento" && ( ... )}` por (ícone `FileText`):
```tsx
{tab === "Base de Conhecimento" && (
  <div className="mx-auto max-w-lg rounded-xl border border-dashed bg-white p-8 text-center">
    <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
      <FileText className="size-5" />
    </span>
    <h1 className="text-lg font-bold text-slate-900">Base de Conhecimento — em breve</h1>
    <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
      Em breve você poderá subir PDFs e URLs para a IA responder com base nas informações da sua
      empresa (RAG). Estamos preparando essa etapa.
    </p>
  </div>
)}
```

- [ ] **Step 3: Remover mocks, estado e imports órfãos**

Remover do `page.tsx` (agora sem uso): as constantes `KNOWLEDGE_SOURCES`, `AGENT_TEMPLATES`, `CONTENT_SAMPLES`, `AI_LOGS`; os estados `voice`, `afterHours`, `contentFormat`, `contentPrompt`, `contentResult`. Manter `COMPARISON` (aba Começando) e o estado `tab`.
Depois, remover imports que ficarem sem uso — conferir cada um contra o que sobrou (Começando usa `Badge`, `Button`, `brand`; IA de voz "em breve" usa `Mic`; Base "em breve" usa `FileText`). Provavelmente saem: `Input`, `Label`, `Select*`, `Switch`, `Textarea`, `Sparkles`, `KpiCard`, `cn`, `toast` — **mas confirme um a um**; só remova o que o build acusar/estiver sem uso. O `SubNav` e `TABS` continuam.

- [ ] **Step 4: Verificar build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros e **sem warning de import/variável não usada**. Corrigir até zerar.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/agentes-ia/page.tsx"
git commit -m "feat(ia): liga abas reais e marca IA de voz/Base de Conhecimento como em breve"
```

---

## Handoff (Gabriel — fora do código)

Nenhum passo novo além dos já pendentes da fundação: `OPENAI_API_KEY` na Vercel (sem ela o
Content AI mostra erro honesto). Migrações `0026_ai_logs` + `0030_ai_agents` já precisavam ser
aplicadas para o Conversation AI/Logs — mesmas de antes.

## Self-Review (autor do plano)

- **Cobertura da spec:** Content AI real → Task 1; Modelos cria agente real → Task 2; Logs reais →
  Task 3; wiring + "em breve" (voz/KB) + limpeza → Task 4. "Começando" intacta (constraint). ✓
- **Consistência de tipos:** `aiActions.generate({system,prompt,feature})` (Task 1) e `useAiLogs`/`AiLog`
  (Task 3) batem com `db/ai.ts` (lido); `aiAgentActions.create({name})→{ok,id}` + `update(id,{personality,goal})→bool`
  (Task 2) batem com `db/ai-agents.ts`. `onUsed: () => void` (Task 2) consumido como `onUsed={() => setTab("Conversation AI")}` (Task 4). ✓
- **Sem placeholders:** todo componente tem código real; verificação por tsc/build (projeto sem runner). ✓
- **Base UI:** `Select` com `SelectValue` children + `onValueChange={(v) => v && ...}` (Task 1). ✓
- **Ponto de atenção:** o EmptyState "em breve" foi feito com bloco inline (border-dashed) para não
  depender do nome/props exatos de um componente compartilhado; Task 3 confere o EmptyState real só
  para o caso "sem logs" e cai no bloco inline se divergir.
