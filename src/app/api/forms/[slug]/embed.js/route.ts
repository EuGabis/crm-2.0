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
  /*
   * Um controle por tipo. Sem estilo próprio de propósito: herda o CSS do site.
   * ⚠️ "multi" são caixas de seleção com o MESMO name; o envio junta as marcadas
   * — \`form.elements[name].value\` devolveria só uma.
   */
  var INPUT = { email: "email", tel: "tel", number: "number", date: "date", time: "time", datetime: "datetime-local" };
  F.fields.forEach(function(f){
    var wrap = document.createElement("p");
    var label = document.createElement("label");
    label.textContent = f.label + (f.required ? " *" : "");
    label.setAttribute("for", "litf_" + f.key);
    wrap.appendChild(label); wrap.appendChild(document.createElement("br"));
    var opts = f.options || [];
    if (f.type === "multi" || f.type === "radio") {
      opts.forEach(function(o, k){
        var l = document.createElement("label");
        var c = document.createElement("input");
        c.type = f.type === "multi" ? "checkbox" : "radio"; c.name = f.key; c.value = o; if (k === 0) c.id = "litf_" + f.key;
        // Grupo de botões aceita "required" nativo; caixas de seleção não (ver valor()).
        if (f.type === "radio" && f.required) c.required = true;
        l.appendChild(c); l.appendChild(document.createTextNode(" " + o));
        wrap.appendChild(l); wrap.appendChild(document.createElement("br"));
      });
    } else {
      var input;
      if (f.type === "textarea") input = document.createElement("textarea");
      else if (f.type === "select") {
        input = document.createElement("select");
        var vazio = document.createElement("option"); vazio.value = ""; vazio.textContent = "Selecione...";
        input.appendChild(vazio);
        opts.forEach(function(o){ var op = document.createElement("option"); op.value = o; op.textContent = o; input.appendChild(op); });
      } else { input = document.createElement("input"); input.type = INPUT[f.type] || "text"; }
      input.id = "litf_" + f.key; input.name = f.key; if (f.required) input.required = true;
      wrap.appendChild(input);
    }
    form.appendChild(wrap);
  });
  function valor(f){
    if (f.type === "multi") {
      var marcados = [];
      form.querySelectorAll('input[type="checkbox"]').forEach(function(c){ if (c.name === f.key && c.checked) marcados.push(c.value); });
      return marcados;
    }
    if (f.type === "radio") {
      var marcado = form.querySelector('input[type="radio"][name="' + f.key + '"]:checked');
      return marcado ? marcado.value : "";
    }
    var el = form.elements[f.key]; return (el && el.value) || "";
  }
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
    e.preventDefault();
    // O navegador não valida "pelo menos uma caixa marcada" sozinho.
    var faltou = F.fields.filter(function(f){ return f.required && f.type === "multi" && !valor(f).length; })[0];
    if (faltou) { msg.textContent = "Escolha ao menos uma opção em: " + faltou.label; return; }
    btn.disabled = true; msg.textContent = "Enviando...";
    var payload = {}; F.fields.forEach(function(f){ payload[f.key] = valor(f); });
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
