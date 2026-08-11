import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { brand } from "@/lib/config/brand";
import { senderAddress } from "@/lib/email/sender";
import type { ActionResult, RunContext, Step } from "./types";

type Db = ReturnType<typeof createAdminClient>;

interface ContactRow {
  id: string;
  location_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company: string | null;
  tags: string[];
  owner_id: string | null;
  dnd: boolean;
  custom_fields: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function str(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value.trim() : "";
}

function num(config: Record<string, unknown>, key: string): number | null {
  const value = config[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Aceita `tag: "a"` ou `tags: ["a", "b"]`. */
function tagList(config: Record<string, unknown>): string[] {
  const raw = config.tags ?? config.tag;
  const items = Array.isArray(raw) ? raw : [raw];
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadContact(db: Db, contactId: string | null): Promise<ContactRow | null> {
  if (!contactId) return null;
  const { data } = await db
    .from("contacts")
    .select(
      "id, location_id, first_name, last_name, email, phone, company, tags, owner_id, dnd, custom_fields",
    )
    .eq("id", contactId)
    .maybeSingle();
  return (data as ContactRow | null) ?? null;
}

/**
 * Variáveis disponíveis nos templates: dados do contato + campos
 * personalizados (pelo próprio nome) + a marca.
 */
function templateVars(contact: ContactRow | null): Record<string, string> {
  const vars: Record<string, string> = { empresa_crm: brand.name };
  if (!contact) return vars;

  const fullName = `${contact.first_name} ${contact.last_name}`.trim();
  Object.assign(vars, {
    nome: contact.first_name,
    sobrenome: contact.last_name,
    nome_completo: fullName,
    email: contact.email,
    telefone: contact.phone,
    empresa: contact.company ?? "",
    tags: (contact.tags ?? []).join(", "),
  });

  for (const [key, value] of Object.entries(contact.custom_fields ?? {})) {
    if (value === null || value === undefined) continue;
    vars[key] = String(value);
  }
  return vars;
}

/** Substitui `{{variavel}}` pelo valor; o que não existir vira string vazia. */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, name: string) => vars[name] ?? "");
}

/** Deduz o status a partir do nome da fase — mesma regra de `db/pipeline.ts`. */
function statusForStageName(name: string): "open" | "won" | "lost" {
  const upper = name.toUpperCase();
  if (upper.includes("PERDID")) return "lost";
  if (upper.includes("ASSINOU") || upper.includes("GANHO") || upper.includes("GANHA")) return "won";
  return "open";
}

/** Oportunidade do run, ou a mais recente em aberto do contato. */
async function resolveOpportunityId(db: Db, ctx: RunContext): Promise<string | null> {
  if (ctx.opportunityId) return ctx.opportunityId;
  if (!ctx.contactId) return null;

  const { data } = await db
    .from("opportunities")
    .select("id")
    .eq("contact_id", ctx.contactId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Ações                                                               */
/* ------------------------------------------------------------------ */

/**
 * Executa um passo do workflow. Nunca lança: qualquer problema vira
 * `{ status: "error" }` para o motor decidir se repete ou falha o run.
 */
export async function runAction(step: Step, ctx: RunContext): Promise<ActionResult> {
  const db = createAdminClient();
  const config = step.config ?? {};

  // "esperar" e "webhook" não dependem do contato — resolvidos antes da carga.
  if (step.key === "esperar") {
    const minutes =
      (num(config, "minutes") ?? 0) +
      (num(config, "hours") ?? 0) * 60 +
      (num(config, "days") ?? 0) * 60 * 24;
    if (minutes <= 0) return { status: "skipped", message: "Espera sem duração definida" };
    const waitUntil = new Date(Date.now() + minutes * 60_000).toISOString();
    return { status: "ok", message: `Aguardando até ${waitUntil}`, waitUntil };
  }

  if (step.key === "enviar-whatsapp" || step.key === "enviar-sms") {
    return { status: "skipped", message: "Canal não conectado" };
  }

  const contact = await loadContact(db, ctx.contactId);
  const vars = templateVars(contact);

  switch (step.key) {
    case "adicionar-tag": {
      if (!contact) return { status: "skipped", message: "Sem contato no run" };
      const toAdd = tagList(config);
      if (toAdd.length === 0) return { status: "skipped", message: "Nenhuma tag configurada" };

      const current = contact.tags ?? [];
      const merged = Array.from(new Set([...current, ...toAdd]));
      if (merged.length === current.length) {
        return { status: "skipped", message: "Contato já tinha as tags" };
      }
      const { error } = await db.from("contacts").update({ tags: merged }).eq("id", contact.id);
      if (error) return { status: "error", message: error.message };
      return { status: "ok", message: `Tags adicionadas: ${toAdd.join(", ")}` };
    }

    case "remover-tag": {
      if (!contact) return { status: "skipped", message: "Sem contato no run" };
      const toRemove = tagList(config);
      if (toRemove.length === 0) return { status: "skipped", message: "Nenhuma tag configurada" };

      const remaining = (contact.tags ?? []).filter((tag) => !toRemove.includes(tag));
      if (remaining.length === (contact.tags ?? []).length) {
        return { status: "skipped", message: "Contato não tinha essas tags" };
      }
      const { error } = await db.from("contacts").update({ tags: remaining }).eq("id", contact.id);
      if (error) return { status: "error", message: error.message };
      return { status: "ok", message: `Tags removidas: ${toRemove.join(", ")}` };
    }

    case "atualizar-campo": {
      if (!contact) return { status: "skipped", message: "Sem contato no run" };
      const field = str(config, "field");
      if (!field) return { status: "skipped", message: "Campo não configurado" };

      const value = renderTemplate(str(config, "value"), vars);
      const customFields = { ...(contact.custom_fields ?? {}), [field]: value };
      const { error } = await db
        .from("contacts")
        .update({ custom_fields: customFields })
        .eq("id", contact.id);
      if (error) return { status: "error", message: error.message };
      return { status: "ok", message: `${field} = ${value}` };
    }

    case "atribuir-usuario": {
      if (!contact) return { status: "skipped", message: "Sem contato no run" };
      const userId = str(config, "userId");
      if (!userId) return { status: "skipped", message: "Usuário não configurado" };

      const { error } = await db.from("contacts").update({ owner_id: userId }).eq("id", contact.id);
      if (error) return { status: "error", message: error.message };
      return { status: "ok", message: "Contato atribuído" };
    }

    case "criar-oportunidade": {
      if (!contact) return { status: "skipped", message: "Sem contato no run" };
      const pipelineId = str(config, "pipelineId");
      const stageId = str(config, "stageId");
      if (!pipelineId || !stageId) {
        return { status: "skipped", message: "Pipeline ou fase não configurados" };
      }

      const name =
        renderTemplate(str(config, "name"), vars) ||
        `Oportunidade — ${vars.nome_completo || "contato"}`;
      const { error } = await db.from("opportunities").insert({
        location_id: ctx.locationId,
        contact_id: contact.id,
        pipeline_id: pipelineId,
        stage_id: stageId,
        name,
        source: str(config, "source") || "Automação",
        value: num(config, "value") ?? 0,
        owner_id: contact.owner_id,
      });
      if (error) return { status: "error", message: error.message };
      return { status: "ok", message: `Oportunidade criada: ${name}` };
    }

    case "mover-fase": {
      const stageId = str(config, "stageId");
      if (!stageId) return { status: "skipped", message: "Fase não configurada" };

      const opportunityId = await resolveOpportunityId(db, ctx);
      if (!opportunityId) return { status: "skipped", message: "Sem oportunidade para mover" };

      const { data: stage } = await db
        .from("stages")
        .select("name")
        .eq("id", stageId)
        .maybeSingle();
      const stageName = (stage as { name: string } | null)?.name ?? "";

      const { error } = await db
        .from("opportunities")
        .update({
          stage_id: stageId,
          status: statusForStageName(stageName),
          updated_at: new Date().toISOString(),
        })
        .eq("id", opportunityId);
      if (error) return { status: "error", message: error.message };
      return { status: "ok", message: `Movida para ${stageName || stageId}` };
    }

    case "criar-tarefa": {
      const title = renderTemplate(str(config, "title"), vars);
      if (!title) return { status: "skipped", message: "Título não configurado" };

      const dueInDays = num(config, "dueInDays");
      const dueAt =
        dueInDays === null
          ? null
          : new Date(Date.now() + dueInDays * 24 * 60 * 60_000).toISOString();

      const { error } = await db.from("tasks").insert({
        location_id: ctx.locationId,
        contact_id: ctx.contactId,
        assignee_id: str(config, "assigneeId") || contact?.owner_id || null,
        title,
        due_at: dueAt,
      });
      if (error) return { status: "error", message: error.message };
      return { status: "ok", message: `Tarefa criada: ${title}` };
    }

    case "criar-compromisso": {
      const title = renderTemplate(str(config, "title"), vars);
      if (!title) return { status: "skipped", message: "Título não configurado" };

      const inDays = num(config, "inDays") ?? 1;
      const durationMinutes = num(config, "durationMinutes") ?? 60;
      const startsAt = new Date(Date.now() + inDays * 24 * 60 * 60_000);
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

      const { error } = await db.from("appointments").insert({
        location_id: ctx.locationId,
        contact_id: ctx.contactId,
        title,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        calendar: str(config, "calendar") || "Reuniões",
        source: "crm",
      });
      if (error) return { status: "error", message: error.message };
      return { status: "ok", message: `Compromisso criado: ${title}` };
    }

    case "enviar-email": {
      if (!contact) return { status: "skipped", message: "Sem contato no run" };
      if (contact.dnd) return { status: "skipped", message: "Contato marcado como não perturbe" };
      if (!contact.email) return { status: "skipped", message: "Contato sem e-mail" };

      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) return { status: "skipped", message: "RESEND_API_KEY ausente" };

      const subject = renderTemplate(str(config, "subject"), vars);
      const body = renderTemplate(str(config, "body"), vars);
      if (!subject || !body) return { status: "skipped", message: "Assunto ou corpo vazios" };

      try {
        const resend = new Resend(apiKey);
        const { error } = await resend.emails.send({
          from: senderAddress(),
          to: contact.email,
          subject,
          html: body.includes("<") ? body : `<p>${body.replace(/\n/g, "<br />")}</p>`,
          text: body.replace(/<[^>]+>/g, ""),
        });
        if (error) return { status: "error", message: error.message };
        return { status: "ok", message: `E-mail enviado para ${contact.email}` };
      } catch (error) {
        return { status: "error", message: error instanceof Error ? error.message : "Falha no envio" };
      }
    }

    case "nota-interna": {
      if (!ctx.contactId) return { status: "skipped", message: "Sem contato no run" };
      const body = renderTemplate(str(config, "body") || str(config, "text"), vars);
      if (!body) return { status: "skipped", message: "Nota vazia" };

      const channel = str(config, "channel") || "email";

      // Reaproveita a conversa mais recente do contato; cria uma se não houver.
      const { data: existing } = await db
        .from("conversations")
        .select("id, channel")
        .eq("contact_id", ctx.contactId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      let conversation = existing as { id: string; channel: string } | null;
      if (!conversation) {
        const { data: created, error: createError } = await db
          .from("conversations")
          .insert({
            location_id: ctx.locationId,
            contact_id: ctx.contactId,
            channel,
          })
          .select("id, channel")
          .single();
        if (createError) return { status: "error", message: createError.message };
        conversation = created as { id: string; channel: string };
      }

      const { error } = await db.from("messages").insert({
        location_id: ctx.locationId,
        conversation_id: conversation.id,
        direction: "out",
        type: "text",
        channel: conversation.channel,
        body,
        internal: true,
      });
      if (error) return { status: "error", message: error.message };
      return { status: "ok", message: "Nota interna registrada" };
    }

    case "condicao": {
      const field = str(config, "field");
      const operator = str(config, "operator") || "igual";
      const expected = renderTemplate(str(config, "value"), vars);
      const actual = resolveConditionValue(contact, field, vars);
      const matched = evaluateCondition(actual, operator, expected);

      if (matched) return { status: "ok", message: `Condição atendida (${field})` };

      const elseStep = num(config, "elseStep");
      return {
        status: "skipped",
        message: `Condição não atendida (${field} ${operator} ${expected})`,
        jumpTo: elseStep ?? -1,
      };
    }

    case "webhook": {
      const url = str(config, "url");
      if (!url) return { status: "skipped", message: "URL não configurada" };
      if (!/^https?:\/\//i.test(url)) return { status: "error", message: "URL inválida" };

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId: ctx.runId,
            locationId: ctx.locationId,
            contactId: ctx.contactId,
            opportunityId: ctx.opportunityId,
            payload: ctx.payload,
            contact: contact
              ? {
                  id: contact.id,
                  nome: contact.first_name,
                  sobrenome: contact.last_name,
                  email: contact.email,
                  telefone: contact.phone,
                  empresa: contact.company,
                  tags: contact.tags,
                }
              : null,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          return { status: "error", message: `Webhook respondeu ${response.status}` };
        }
        return { status: "ok", message: `Webhook chamado (${response.status})` };
      } catch (error) {
        return {
          status: "error",
          message: error instanceof Error ? error.message : "Falha ao chamar webhook",
        };
      }
    }

    default:
      return { status: "skipped", message: `Ação desconhecida: ${step.key}` };
  }
}

/* ------------------------------------------------------------------ */
/* Condições                                                           */
/* ------------------------------------------------------------------ */

/** Resolve o valor do contato para a condição. `campo:X` lê um campo personalizado. */
function resolveConditionValue(
  contact: ContactRow | null,
  field: string,
  vars: Record<string, string>,
): string {
  if (!contact || !field) return "";
  if (field.startsWith("campo:")) {
    const name = field.slice("campo:".length);
    const value = (contact.custom_fields ?? {})[name];
    return value === null || value === undefined ? "" : String(value);
  }
  switch (field) {
    case "tags":
      return (contact.tags ?? []).join(",");
    case "email":
      return contact.email;
    case "telefone":
      return contact.phone;
    case "empresa":
      return contact.company ?? "";
    case "nome":
      return contact.first_name;
    default:
      return vars[field] ?? "";
  }
}

function evaluateCondition(actual: string, operator: string, expected: string): boolean {
  const a = actual.trim().toLowerCase();
  const b = expected.trim().toLowerCase();

  switch (operator) {
    case "igual":
      return a === b;
    case "diferente":
      return a !== b;
    case "contem":
      return a.includes(b);
    case "nao-contem":
      return !a.includes(b);
    case "vazio":
      return a === "";
    case "preenchido":
      return a !== "";
    case "maior":
      return Number(a) > Number(b);
    case "menor":
      return Number(a) < Number(b);
    default:
      return false;
  }
}
