import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { appOrigin, enviarRedefinicao } from "@/lib/auth/recovery";

interface Body {
  userId?: string;
  /** "editar" (nome/e-mail/senha) ou "redefinir" (envia o link por e-mail). */
  acao?: "editar" | "redefinir";
  name?: string;
  email?: string;
  password?: string;
}

/**
 * Administração da CONTA de um membro: nome, e-mail, senha e link de redefinição.
 *
 * ⚠️ A sessão AUTORIZA e a service role EXECUTA (padrão de `resolveGuruUserToken`):
 * nome/e-mail/senha moram em `auth.users`, que só a API admin altera, e a policy
 * de `profiles` deixa cada um editar só o próprio perfil. Por isso a checagem
 * de que quem chama é ADMIN e de que o alvo é da MESMA empresa é feita aqui,
 * antes de qualquer escrita — a RLS não protege a service role.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Requisição inválida" }, { status: 400 });
  }
  const userId = body.userId?.trim();
  if (!userId) return Response.json({ error: "Usuário não informado" }, { status: 400 });

  const { data: meu } = await supabase
    .from("location_members")
    .select("location_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!meu) return Response.json({ error: "Empresa não encontrada" }, { status: 400 });
  if (meu.role !== "admin") {
    return Response.json({ error: "Apenas administradores podem editar usuários" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: alvo } = await admin
    .from("location_members")
    .select("user_id")
    .eq("location_id", meu.location_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!alvo) {
    return Response.json({ error: "Esta pessoa não faz parte da sua empresa" }, { status: 404 });
  }

  const { data: perfil } = await admin
    .from("profiles")
    .select("name, email")
    .eq("id", userId)
    .maybeSingle();

  if (body.acao === "redefinir") {
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    const email = authUser?.user?.email ?? perfil?.email;
    if (!email) return Response.json({ error: "Usuário sem e-mail" }, { status: 400 });
    const r = await enviarRedefinicao(email, appOrigin(request), perfil?.name ?? undefined);
    if (!r.ok) {
      return Response.json({ error: `Não foi possível gerar o link (${r.error})` }, { status: 400 });
    }
    return Response.json({
      ok: true,
      emailSent: r.emailSent,
      link: r.link,
      warning: r.emailSent
        ? undefined
        : `O e-mail não pôde ser enviado (${r.error}). Copie o link e envie à pessoa.`,
    });
  }

  // ---- editar ----
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";

  if (body.name !== undefined && !name) {
    return Response.json({ error: "O nome não pode ficar vazio" }, { status: 400 });
  }
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Informe um e-mail válido" }, { status: 400 });
  }
  if (password && password.length < 8) {
    return Response.json({ error: "A senha precisa ter pelo menos 8 caracteres" }, { status: 400 });
  }

  const authPatch: {
    email?: string;
    email_confirm?: boolean;
    password?: string;
    user_metadata?: Record<string, unknown>;
  } = {};
  // email_confirm: o admin está afirmando o endereço. Sem isso o Supabase manda
  // um e-mail de confirmação pelo SMTP embutido — o mesmo que não entrega — e a
  // troca fica pendente para sempre.
  if (email && email !== perfil?.email?.toLowerCase()) {
    authPatch.email = email;
    authPatch.email_confirm = true;
  }
  if (password) authPatch.password = password;
  if (name) authPatch.user_metadata = { name };

  if (Object.keys(authPatch).length > 0) {
    const { error } = await admin.auth.admin.updateUserById(userId, authPatch);
    if (error) {
      const msg = /already|registered|exists/i.test(error.message)
        ? "Este e-mail já é usado por outra conta"
        : error.message;
      return Response.json({ error: msg }, { status: 400 });
    }
  }

  const perfilPatch: Record<string, string> = {};
  if (name) perfilPatch.name = name;
  if (authPatch.email) perfilPatch.email = authPatch.email;
  if (Object.keys(perfilPatch).length > 0) {
    const { error } = await admin.from("profiles").update(perfilPatch).eq("id", userId);
    if (error) {
      return Response.json(
        { error: `Conta atualizada, mas o perfil não (${error.message})` },
        { status: 500 }
      );
    }
  }

  return Response.json({
    ok: true,
    name: perfilPatch.name ?? perfil?.name,
    email: perfilPatch.email ?? perfil?.email,
  });
}
