import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { renderInviteEmail } from "@/lib/email/invite-template";
import { senderAddress } from "@/lib/email/sender";

interface InviteBody {
  email?: string;
  role?: "admin" | "user";
  onlyAssigned?: boolean;
  permissions?: Record<string, boolean>;
  /** Departamento que a pessoa assume ao entrar (migração 0033). */
  departmentId?: string | null;
}

/**
 * Cria o convite e envia o e-mail com a identidade do Lito CRM.
 *
 * Segurança: a sessão é validada no servidor e a criação passa pela RLS
 * (apenas administradores da empresa conseguem inserir em `invitations`).
 * A chave do Resend nunca sai do servidor.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  let body: InviteBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const role = body.role === "admin" ? "admin" : "user";
  if (!email || !email.includes("@")) {
    return Response.json({ error: "Informe um e-mail válido" }, { status: 400 });
  }

  // Empresa do usuário + confirmação de que ele é administrador
  const { data: membership } = await supabase
    .from("location_members")
    .select("location_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return Response.json({ error: "Empresa não encontrada" }, { status: 400 });
  }
  if (membership.role !== "admin") {
    return Response.json(
      { error: "Apenas administradores podem convidar pessoas" },
      { status: 403 }
    );
  }

  const [{ data: location }, { data: profile }] = await Promise.all([
    supabase.from("locations").select("name, logo_url").eq("id", membership.location_id).maybeSingle(),
    supabase.from("profiles").select("name").eq("id", user.id).maybeSingle(),
  ]);

  // Cria o convite (RLS reforça a permissão de admin)
  const { data: invite, error } = await supabase
    .from("invitations")
    .insert({
      location_id: membership.location_id,
      email,
      role,
      only_assigned: role === "admin" ? false : Boolean(body.onlyAssigned),
      permissions: role === "admin" ? {} : (body.permissions ?? {}),
      department_id: role === "admin" ? null : (body.departmentId ?? null),
      created_by: user.id,
    })
    .select()
    .single();

  if (error || !invite) {
    const message =
      error?.code === "23505"
        ? "Já existe um convite pendente para este e-mail"
        : error?.code === "42P01"
          ? "Aplique a migração 0004 no Supabase para habilitar convites"
          : "Não foi possível criar o convite";
    return Response.json({ error: message }, { status: 400 });
  }

  // Envia o e-mail personalizado
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return Response.json({
      invite,
      emailSent: false,
      warning:
        "Convite criado, mas o envio de e-mail não está configurado (RESEND_API_KEY ausente). Envie o link manualmente.",
    });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const { subject, html, text } = renderInviteEmail({
    inviterName: profile?.name ?? "Um administrador",
    companyName: location?.name ?? "sua empresa",
    role,
    signupUrl: `${origin}/login`,
    email,
    logoUrl: location?.logo_url ?? undefined,
  });

  try {
    const resend = new Resend(apiKey);
    // Reply-To = e-mail de quem convidou (respostas vão para o admin) — melhora a
    // reputação (não é "no-reply puro"). List-Unsubscribe via mailto agrada o Outlook.
    const inviter = user.email ?? undefined;
    const { error: sendError } = await resend.emails.send({
      from: senderAddress(),
      to: email,
      subject,
      html,
      text,
      ...(inviter ? { replyTo: inviter } : {}),
      ...(inviter
        ? {
            headers: {
              "List-Unsubscribe": `<mailto:${inviter}?subject=Unsubscribe>`,
            },
          }
        : {}),
    });
    if (sendError) {
      return Response.json({
        invite,
        emailSent: false,
        warning: `Convite criado, mas o e-mail não pôde ser enviado (${sendError.message}). Envie o link manualmente.`,
      });
    }
  } catch {
    return Response.json({
      invite,
      emailSent: false,
      warning: "Convite criado, mas o e-mail não pôde ser enviado. Envie o link manualmente.",
    });
  }

  return Response.json({ invite, emailSent: true });
}
