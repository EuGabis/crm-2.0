import { createClient } from "@/lib/supabase/server";
import { numberDiagnostics } from "@/lib/whatsapp/client";
import { appBaseUrl } from "@/lib/config/app-url";
import {
  avaliarCron,
  avaliarHttp,
  formatarMinutos,
  minutosDesde,
  piorStatus,
  porLimite,
  type Checagem,
  type Status,
} from "@/lib/saude/avaliar";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TEMPO_LIMITE_MS = 8000;

/** fetch com tempo limite e duração medida — a falha vira dado, não exceção. */
async function medir(url: string, init?: RequestInit) {
  const inicio = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TEMPO_LIMITE_MS), cache: "no-store" });
    const corpo = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, ms: Date.now() - inicio, corpo, erro: null as string | null };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "sem resposta em 8 s" : e.message) : String(e);
    return { ok: false, status: 0, ms: Date.now() - inicio, corpo: null, erro: msg };
  }
}

function porLatencia(ms: number): Status {
  return porLimite(ms, 1500, 4000);
}

/**
 * Saúde do sistema — Configurações → Saúde. Só administrador.
 *
 * Junta o retrato do banco (`public.saude_sistema`, migração 202610051500) com
 * checagens VIVAS nos serviços externos. Cada checagem é isolada: o painel
 * existe para o dia em que algo está quebrado, então uma falha aqui é DADO na
 * resposta, nunca uma exceção que derruba a tela inteira.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "não autenticado" }, { status: 401 });

  const { data: membro } = await supabase
    .from("location_members")
    .select("location_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membro) return Response.json({ error: "empresa não encontrada" }, { status: 400 });
  if (membro.role !== "admin") return Response.json({ error: "apenas administradores" }, { status: 403 });

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supaKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  const inicioBanco = Date.now();
  const [banco, auth, resend, openai] = await Promise.all([
    supabase.rpc("saude_sistema", { p_location: membro.location_id }).then(
      (r) => ({ ...r, ms: Date.now() - inicioBanco }),
      (e) => ({ data: null, error: { message: String(e), code: "" }, ms: Date.now() - inicioBanco })
    ),
    medir(`${supaUrl}/auth/v1/health`, { headers: { apikey: supaKey } }),
    process.env.RESEND_API_KEY
      ? medir("https://api.resend.com/domains", {
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        })
      : Promise.resolve(null),
    process.env.OPENAI_API_KEY
      ? medir("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        })
      : Promise.resolve(null),
  ]);

  const c: Checagem[] = [];
  const add = (x: Checagem) => c.push(x);
  const d: any = banco.data ?? {};
  const agora = Date.now();

  // ---------------- Aplicação ----------------
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";
  add({
    id: "versao", grupo: "Aplicação", nome: "Versão no ar", status: "info",
    resumo: `commit ${commit}${process.env.VERCEL_REGION ? ` · região ${process.env.VERCEL_REGION}` : ""}`,
    detalhe: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0],
  });
  const ENVS: [string, boolean][] = [
    ["SUPABASE_SERVICE_ROLE_KEY", true], ["AUTOMATION_SECRET", true], ["RESEND_API_KEY", true],
    ["WHATSAPP_TOKEN", true], ["WHATSAPP_APP_SECRET", true], ["WHATSAPP_VERIFY_TOKEN", true],
    ["OPENAI_API_KEY", true], ["GURU_SYNC_SECRET", true], ["RESEND_WEBHOOK_SECRET", false],
    ["NEXT_PUBLIC_APP_URL", false],
  ];
  const faltando = ENVS.filter(([k]) => !process.env[k]);
  add({
    id: "envs", grupo: "Aplicação", nome: "Variáveis de ambiente",
    status: faltando.some(([, obrigatoria]) => obrigatoria) ? "falha" : faltando.length ? "atencao" : "ok",
    resumo: faltando.length ? `${faltando.length} faltando` : `${ENVS.length} configuradas`,
    detalhe: faltando.length ? `Faltam na Vercel: ${faltando.map(([k]) => k).join(", ")}` : undefined,
  });
  const envUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (envUrl && envUrl.replace(/\/+$/, "") !== appBaseUrl()) {
    add({
      id: "dominio", grupo: "Aplicação", nome: "Domínio configurado", status: "atencao",
      resumo: `NEXT_PUBLIC_APP_URL = ${envUrl}`,
      detalhe: `Aponta para um domínio aposentado; os links usam ${appBaseUrl()}. Troque na Vercel e refaça o deploy.`,
    });
  }

  // ---------------- Banco ----------------
  if (banco.error) {
    add({
      id: "banco", grupo: "Banco de dados", nome: "Consulta de saúde", status: "falha",
      resumo: `erro ${banco.error.code ?? ""}`.trim(),
      detalhe: /saude_sistema/.test(banco.error.message) || banco.error.code === "PGRST202"
        ? "Aplique a migração 202610051500_saude_do_sistema.sql no SQL Editor."
        : banco.error.message,
    });
  } else {
    add({
      id: "latencia", grupo: "Banco de dados", nome: "Tempo de resposta", status: porLatencia(banco.ms),
      resumo: `${banco.ms} ms para montar este retrato`,
      detalhe: banco.ms > 1500 ? "O banco está respondendo devagar — veja as consultas lentas abaixo." : undefined,
    });
    const b = d.banco ?? {};
    if (b.erro) {
      add({ id: "pg", grupo: "Banco de dados", nome: "Conexões", status: "atencao", resumo: "sem acesso", detalhe: b.erro });
    } else {
      const uso = b.max_conexoes ? b.conexoes / b.max_conexoes : 0;
      add({
        id: "conexoes", grupo: "Banco de dados", nome: "Conexões",
        status: porLimite(uso, 0.7, 0.9),
        resumo: `${b.conexoes} de ${b.max_conexoes} · ${b.ativas} executando · ${b.tamanho_mb} MB`,
        detalhe: b.idle_em_transacao > 0 ? `${b.idle_em_transacao} conexão(ões) paradas no meio de uma transação.` : undefined,
      });
      const lentas: any[] = b.lentas ?? [];
      const pior = lentas.reduce((m, x) => Math.max(m, Number(x.segundos) || 0), 0);
      add({
        id: "lentas", grupo: "Banco de dados", nome: "Consultas lentas agora",
        status: lentas.length === 0 ? "ok" : pior >= 30 || lentas.length >= 5 ? "falha" : "atencao",
        resumo: lentas.length === 0 ? "nenhuma acima de 3 s" : `${lentas.length} acima de 3 s · a mais longa ${pior} s`,
        detalhe: lentas.length
          ? lentas.slice(0, 3).map((x) => `${x.segundos}s · ${x.consulta}`).join("\n")
          : undefined,
      });
    }
  }
  add({
    id: "auth", grupo: "Banco de dados", nome: "Login (Supabase Auth)",
    status: auth.ok ? porLatencia(auth.ms) : "falha",
    resumo: auth.ok ? `respondendo · ${auth.ms} ms` : auth.erro ?? `HTTP ${auth.status}`,
  });

  // ---------------- Rotinas automáticas ----------------
  if (Array.isArray(d.crons)) {
    const NOMES: Record<string, string> = {
      "lito-automation-tick": "Automações, agendadas, transcrição e rodízio",
      "lito-marketing-tick": "Envio de e-mail marketing",
      "lito-guru-sync": "Sincronização da Guru",
      "lito-lead-sweep": "Varredura de leads",
      "lito-aniversarios": "Aniversários",
    };
    for (const job of d.crons) {
      const r = avaliarCron(
        { nome: job.nome, agenda: job.agenda, ativo: job.ativo, ultimo_inicio: job.ultimo_inicio, ultimo_status: job.ultimo_status, mensagem: job.mensagem },
        agora
      );
      add({ id: `cron-${job.nome}`, grupo: "Rotinas automáticas", nome: NOMES[job.nome] ?? job.nome, ...r });
    }
  } else if (d.crons?.erro) {
    add({ id: "crons", grupo: "Rotinas automáticas", nome: "pg_cron", status: "atencao", resumo: "sem acesso", detalhe: d.crons.erro });
  }
  if (d.http && !d.http.erro) {
    const r = avaliarHttp(d.http.por_status ?? {});
    const erros: any[] = d.http.erros ?? [];
    add({
      id: "http", grupo: "Rotinas automáticas", nome: "Chamadas dos crons ao CRM", ...r,
      detalhe: [r.detalhe, ...erros.filter((e) => e.status).slice(0, 2).map((e) => `${e.status}: ${e.erro}`)]
        .filter(Boolean).join("\n") || undefined,
    });
  }

  // ---------------- Filas ----------------
  const f = d.filas ?? {};
  if (!f.erro && Object.keys(f).length) {
    add({
      id: "fila-automacoes", grupo: "Filas", nome: "Automações",
      status: f.automacoes_atrasadas > 0 ? porLimite(f.automacoes_atrasadas, 1, 20) : porLimite(f.automacoes_falhas_24h, 5, 50),
      resumo: `${f.automacoes_atrasadas} atrasadas · ${f.automacoes_falhas_24h} falhas em 24h`,
      detalhe: f.automacao_ultimo_erro ? `Último erro: ${f.automacao_ultimo_erro}` : undefined,
    });
    add({
      id: "fila-agendadas", grupo: "Filas", nome: "Mensagens agendadas",
      status: piorStatus([porLimite(f.agendadas_atrasadas, 1, 10), porLimite(f.agendadas_falhas_24h, 3, 20)]),
      resumo: `${f.agendadas_atrasadas} atrasadas · ${f.agendadas_falhas_24h} falharam em 24h`,
    });
    add({
      id: "fila-transcricao", grupo: "Filas", nome: "Transcrição de áudios",
      status: piorStatus([porLimite(f.transcricao_pendente, 20, 100), porLimite(f.transcricao_falhas_24h, 5, 30)]),
      resumo: `${f.transcricao_pendente} na fila · ${f.transcricao_falhas_24h} falhas em 24h`,
    });
    const horas = Number(f.leads_na_fila_horas ?? 0);
    add({
      id: "fila-leads", grupo: "Filas", nome: "Leads aguardando distribuição",
      status: f.leads_na_fila === 0 ? "ok" : porLimite(horas, 1, 4),
      resumo: f.leads_na_fila === 0 ? "fila vazia" : `${f.leads_na_fila} na fila · o mais antigo espera ${horas.toString().replace(".", ",")} h`,
      detalhe: f.leads_na_fila > 0 ? "Fora do expediente é normal: o lead espera alguém do setor ficar online." : undefined,
    });
    add({
      id: "fila-email", grupo: "Filas", nome: "E-mail marketing",
      status: "info",
      resumo: f.campanhas_enviando ? `${f.campanhas_enviando} campanha(s) enviando · ${f.emails_pendentes} e-mails na fila` : "nenhuma campanha enviando",
    });
  } else if (f.erro) {
    add({ id: "filas", grupo: "Filas", nome: "Filas", status: "atencao", resumo: "sem acesso", detalhe: f.erro });
  }

  // ---------------- WhatsApp ----------------
  const canais: any[] = Array.isArray(d.whatsapp) ? d.whatsapp.filter((w: any) => w.ativo) : [];
  const meta = await Promise.all(
    canais.map(async (w) => {
      const inicio = Date.now();
      try {
        const info = await Promise.race([
          numberDiagnostics(w.phone_number_id),
          new Promise((_, rej) => setTimeout(() => rej(new Error("sem resposta em 8 s")), TEMPO_LIMITE_MS)),
        ]);
        return { info: info as any, erro: null as string | null, ms: Date.now() - inicio };
      } catch (e) {
        return { info: null, erro: e instanceof Error ? e.message : String(e), ms: Date.now() - inicio };
      }
    })
  );
  canais.forEach((w, i) => {
    const m = meta[i];
    const qualidade = m.info?.quality_rating as string | undefined;
    const statusMeta: Status = m.erro
      ? "falha"
      : qualidade === "RED" ? "falha" : qualidade === "YELLOW" ? "atencao" : "ok";
    const falhas = Number(w.falhas_24h ?? 0), saidas = Number(w.saidas_24h ?? 0);
    const taxa = saidas ? falhas / saidas : 0;
    const desdeEntrada = minutosDesde(w.ultima_entrada, agora);
    add({
      id: `wa-${w.id}`, grupo: "WhatsApp", nome: `${w.nome}${w.telefone ? ` · ${w.telefone}` : ""}`,
      status: piorStatus([statusMeta, falhas >= 3 ? porLimite(taxa, 0.1, 0.3) : "ok"]),
      resumo: [
        m.erro ? "Meta não respondeu" : `Meta: ${m.info?.status ?? "?"} · qualidade ${qualidade ?? "?"} · ${m.ms} ms`,
        `${saidas} enviadas / ${falhas} falhas em 24h`,
        desdeEntrada === null ? "sem mensagem recebida em 7 d" : `última recebida ${formatarMinutos(desdeEntrada)}`,
      ].join(" · "),
      detalhe: m.erro ?? (w.ultimo_erro ? `Última falha: ${w.ultimo_erro}` : undefined),
    });
  });

  // ---------------- Integrações externas ----------------
  if (resend === null) {
    add({ id: "resend", grupo: "Integrações", nome: "Resend (e-mail)", status: "falha", resumo: "RESEND_API_KEY ausente" });
  } else if (!resend.ok) {
    add({
      id: "resend", grupo: "Integrações", nome: "Resend (e-mail)", status: "falha",
      resumo: resend.erro ?? `HTTP ${resend.status}`,
      detalhe: resend.status === 401 ? "Chave do Resend inválida ou revogada." : resend.corpo?.message,
    });
  } else {
    const dominios: any[] = resend.corpo?.data ?? [];
    const naoVerificados = dominios.filter((x) => x.status !== "verified");
    add({
      id: "resend", grupo: "Integrações", nome: "Resend (e-mail)",
      status: dominios.length === 0 ? "atencao" : naoVerificados.length ? "atencao" : porLatencia(resend.ms),
      resumo: `${dominios.map((x) => `${x.name} (${x.status === "verified" ? "verificado" : x.status})`).join(", ") || "nenhum domínio"} · ${resend.ms} ms`,
      detalhe: naoVerificados.length ? "Domínio não verificado: e-mails desse remetente não são entregues." : undefined,
    });
  }

  if (openai === null) {
    add({ id: "openai", grupo: "Integrações", nome: "OpenAI (Lita, transcrição)", status: "falha", resumo: "OPENAI_API_KEY ausente" });
  } else {
    const ia = d.ia ?? {};
    const falhasIa = Number(ia.falhas_24h ?? 0), okIa = Number(ia.sucesso_24h ?? 0);
    add({
      id: "openai", grupo: "Integrações", nome: "OpenAI (Lita, transcrição)",
      status: !openai.ok ? "falha" : falhasIa > 0 && falhasIa >= okIa ? "falha" : falhasIa > 0 ? "atencao" : porLatencia(openai.ms),
      resumo: `${openai.ok ? `chave válida · ${openai.ms} ms` : openai.erro ?? `HTTP ${openai.status}`} · ${okIa} ok / ${falhasIa} falhas em 24h`,
      detalhe: !openai.ok
        ? openai.status === 401 ? "Chave da OpenAI inválida ou revogada." : openai.corpo?.error?.message
        : ia.ultimo_erro
          ? `Última falha: ${ia.ultimo_erro}`
          : "A chave valida, mas crédito esgotado só aparece ao gerar — use o diagnóstico completo.",
    });
  }

  const g = d.guru ?? {};
  if (!g.erro && g.conectada) {
    const desde = minutosDesde(g.ultimo_sync, agora);
    const desdeVenda = minutosDesde(g.ultima_venda, agora);
    add({
      id: "guru", grupo: "Integrações", nome: "Guru (pagamentos)",
      status: desde === null ? "atencao" : porLimite(desde, 10, 60),
      resumo: `sincronizado ${desde === null ? "nunca" : formatarMinutos(desde)} · último evento recebido ${desdeVenda === null ? "nunca" : formatarMinutos(desdeVenda)}`,
      detalhe: desde !== null && desde >= 10 ? "A sincronização deveria rodar a cada minuto — confira o cron e o GURU_SYNC_SECRET." : undefined,
    });
  } else if (!g.erro) {
    add({ id: "guru", grupo: "Integrações", nome: "Guru (pagamentos)", status: "info", resumo: "não conectada" });
  }

  return Response.json({ medidoEm: new Date().toISOString(), checagens: c });
}

