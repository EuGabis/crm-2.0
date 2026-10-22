/**
 * GET /api/whatsapp/rastreio.js — script para colar no site:
 *   <script src="https://www.litocrm.app/api/whatsapp/rastreio.js" async></script>
 *
 * 1. Guarda gclid/gbraid/wbraid/fbclid/UTMs da URL de chegada (primeiro toque,
 *    30 dias) — o visitante pode navegar antes de clicar no botão.
 * 2. Em todo clique num link wa.me / api.whatsapp.com: gera um código curto,
 *    registra o clique no CRM (sendBeacon, não atrasa) e acrescenta
 *    "(cód. XXXXXX)" à mensagem pronta do link. O webhook acha o código na 1ª
 *    mensagem e liga o lead ao clique.
 * ⚠️ Sem dependência e sem quebrar o botão: qualquer erro deixa o link seguir
 * como sempre.
 */
const SCRIPT = String.raw`(function(){
  try {
    var API = ORIGEM + "/api/whatsapp/clique";
    var KEY = "lito_origem";
    var CAMPOS = ["gclid","gbraid","wbraid","fbclid","utm_source","utm_medium","utm_campaign","utm_term","utm_content"];
    var ALF = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    var qs = new URLSearchParams(location.search), achou = {}, tem = false;
    CAMPOS.forEach(function(c){ var v = qs.get(c); if (v) { achou[c] = v; tem = true; } });
    var salvo = null;
    try { salvo = JSON.parse(localStorage.getItem(KEY) || "null"); } catch(e) {}
    if (salvo && Date.now() - salvo.t > 30*864e5) salvo = null;
    if (tem) { salvo = { t: Date.now(), d: achou, pagina: location.href, referrer: document.referrer }; try { localStorage.setItem(KEY, JSON.stringify(salvo)); } catch(e) {} }
    function codigo(){ var s=""; for (var i=0;i<6;i++) s+=ALF[Math.floor(Math.random()*ALF.length)]; return s; }
    function telDoLink(u){
      var m = u.pathname.match(/\/(\d{10,15})/); if (m) return m[1];
      return (u.searchParams.get("phone") || "").replace(/\D/g, "");
    }
    document.addEventListener("click", function(ev){
      try {
        var a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
        if (!a) return;
        var u = new URL(a.href, location.href);
        if (!/(^|\.)wa\.me$|api\.whatsapp\.com$|web\.whatsapp\.com$/.test(u.hostname)) return;
        var tel = telDoLink(u); if (!tel) return;
        var cod = codigo();
        var dados = { codigo: cod, telefone: tel, pagina: (salvo && salvo.pagina) || location.href, referrer: (salvo && salvo.referrer) || document.referrer };
        if (salvo) CAMPOS.forEach(function(c){ if (salvo.d[c]) dados[c] = salvo.d[c]; });
        var corpo = JSON.stringify(dados);
        if (!(navigator.sendBeacon && navigator.sendBeacon(API, corpo))) fetch(API, { method: "POST", body: corpo, keepalive: true, mode: "cors" });
        var txt = u.searchParams.get("text") || "";
        u.searchParams.set("text", (txt ? txt + " " : "") + "(cód. " + cod + ")");
        a.href = u.toString();
      } catch(e) {}
    }, true);
  } catch(e) {}
})();`;

export function GET(req: Request) {
  const origem = new URL(req.url).origin;
  return new Response(`var ORIGEM=${JSON.stringify(origem)};\n${SCRIPT}`, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
