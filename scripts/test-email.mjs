// Envia um e-mail de teste com o template real de convite.
// Uso: node scripts/test-email.mjs destinatario@exemplo.com
//
// Lê RESEND_API_KEY e EMAIL_FROM do .env.local.
// Domínio news.litoaviation.com verificado no Resend: entrega para
// qualquer destinatário (remetente nao-responder@news.litoaviation.com).
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resend } from "resend";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const read = (key) => env.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim().replace(/^"|"$/g, "");

const apiKey = read("RESEND_API_KEY");
if (!apiKey) {
  console.error("RESEND_API_KEY não encontrada no .env.local");
  process.exit(1);
}

const to = process.argv[2];
if (!to) {
  console.error("Informe o destinatário: node scripts/test-email.mjs voce@exemplo.com");
  process.exit(1);
}

// Reaproveita o template TypeScript sem precisar compilar o projeto
const src = readFileSync(new URL("../src/lib/email/invite-template.ts", import.meta.url), "utf8");
const js = src
  .replace(
    /import \{ brand \}.*\n/,
    'const brand = { name: "Lito CRM", shortName: "Lito", tagline: "Seu negócio inteiro em um lugar" };\n'
  )
  .replace(/export interface[\s\S]*?\n\}\n/, "")
  .replace(/: InviteEmailData/g, "")
  .replace(/: \{ subject: string; html: string; text: string \}/g, "")
  .replace(/: string/g, "")
  .replace(/export function/g, "function");

const tmpFile = join(tmpdir(), `lito-invite-template-${Date.now()}.mjs`);
writeFileSync(tmpFile, `${js}\nexport { renderInviteEmail };`);

try {
  const { renderInviteEmail } = await import(`file://${tmpFile}`);
  const { subject, html, text } = renderInviteEmail({
    inviterName: "Gabriel Pereira",
    companyName: "Lito Comercial",
    role: "user",
    signupUrl: "http://localhost:3000/login",
    email: to,
  });

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: read("EMAIL_FROM") || "Lito CRM <nao-responder@news.litoaviation.com>",
    to,
    subject,
    html,
    text,
  });

  if (error) {
    console.error("Falha no envio:", error.message);
    process.exitCode = 1;
  } else {
    console.log(`OK: e-mail enviado para ${to} (id ${data?.id})`);
  }
} finally {
  try {
    unlinkSync(tmpFile);
  } catch {}
}
