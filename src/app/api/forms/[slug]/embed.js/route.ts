import { createAdminClient } from "@/lib/supabase/admin";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const dynamic = "force-dynamic";

function js(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://lito-crm.vercel.app";

  let form: any = null;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("forms")
      .select("slug, fields, active")
      .eq("slug", slug)
      .maybeSingle();
    form = data;
  } catch {
    return js(`console.error("[Lito Forms] servidor sem credenciais");`, 503);
  }
  if (!form || !form.active) {
    return js(`console.warn("[Lito Forms] formulário indisponível:", ${JSON.stringify(slug)});`);
  }

  const config = JSON.stringify({
    slug: form.slug,
    fields: form.fields ?? [],
    endpoint: `${base.replace(/\/$/, "")}/api/forms/${form.slug}/submit`,
  });

  // O script renderiza o form (sem estilo) onde o <script> está e envia por fetch.
  const body = `(function(){
  var F = ${config};
  var mount = document.getElementById("lito-form-" + F.slug) || document.currentScript.parentNode;
  var form = document.createElement("form");
  F.fields.forEach(function(f){
    var wrap = document.createElement("p");
    var label = document.createElement("label");
    label.textContent = f.label + (f.required ? " *" : "");
    label.setAttribute("for", "litf_" + f.key);
    var input = f.type === "textarea" ? document.createElement("textarea") : document.createElement("input");
    if (f.type !== "textarea") input.type = (f.type === "email" ? "email" : f.type === "tel" ? "tel" : "text");
    input.id = "litf_" + f.key; input.name = f.key; if (f.required) input.required = true;
    wrap.appendChild(label); wrap.appendChild(document.createElement("br")); wrap.appendChild(input);
    form.appendChild(wrap);
  });
  // honeypot oculto
  var hp = document.createElement("input");
  hp.type = "text"; hp.name = "_hp"; hp.tabIndex = -1; hp.autocomplete = "off";
  hp.style.position = "absolute"; hp.style.left = "-9999px"; hp.setAttribute("aria-hidden", "true");
  form.appendChild(hp);
  var btn = document.createElement("button"); btn.type = "submit"; btn.textContent = "Enviar";
  form.appendChild(btn);
  var msg = document.createElement("p");
  form.appendChild(msg);
  form.addEventListener("submit", function(e){
    e.preventDefault(); btn.disabled = true; msg.textContent = "Enviando...";
    var payload = {}; F.fields.forEach(function(f){ payload[f.key] = (form.elements[f.key]||{}).value || ""; });
    payload._hp = hp.value;
    fetch(F.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(function(r){ return r.json(); })
      .then(function(res){
        if (!res.ok) { msg.textContent = res.error || "Não foi possível enviar."; btn.disabled = false; return; }
        if (res.action === "redirect" && res.value) { window.location.href = res.value; return; }
        form.innerHTML = ""; msg.textContent = res.value || "Obrigado!"; form.appendChild(msg);
      })
      .catch(function(){ msg.textContent = "Erro de conexão."; btn.disabled = false; });
  });
  mount.appendChild(form);
})();`;

  return js(body);
}
