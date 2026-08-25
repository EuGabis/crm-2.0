"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { contactName } from "@/lib/data/repos/contacts";
import { createClient } from "@/lib/supabase/client";
import { dbContactActions, useDbStore } from "@/lib/data/repos/db/contacts";
import { logBulk, smartListActions, useModuleStore } from "@/lib/data/repos/db/contacts-module";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Contact } from "@/lib/data/types";

interface ParsedRow {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  doc?: string;
  company?: string;
  tags: string[];
}

interface ParseResult {
  rows: ParsedRow[];
  total: number;
  /** Linhas sem nome/e-mail/telefone — não dá para virar contato. */
  ignored: number;
  /** Repetidas DENTRO do arquivo (mesmo telefone, documento ou e-mail). */
  duplicates: number;
  /** Já existem no CRM (comparado com os contatos carregados). */
  existing: number;
  /** Cabeçalhos lidos — é o que a mensagem de erro mostra quando nada casa. */
  headers: string[];
}

/**
 * Mesma chave canônica de `private.phone_key` (migração 0047): só dígitos, sem o
 * 55 e ignorando o 9º dígito de celular. Repetida aqui porque a deduplicação do
 * arquivo acontece ANTES de qualquer ida ao banco — 50 mil consultas de "esse
 * telefone já existe?" seriam 50 mil viagens de rede.
 */
function phoneKey(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  const n = digits.length >= 12 && digits.startsWith("55") ? digits.slice(2) : digits;
  return n.length < 10 ? n : n.slice(0, 2) + n.slice(-8);
}

const docKey = (raw: string) => (raw ?? "").replace(/\D/g, "");

/** Chaves de identidade da linha, em ordem de confiança. Sem nenhuma, não dedupa. */
function identityKeys(r: { doc?: string; phone: string; email: string }): string[] {
  const out: string[] = [];
  const d = docKey(r.doc ?? "");
  if (d.length >= 11) out.push("d:" + d);
  const p = phoneKey(r.phone);
  if (p.length >= 10) out.push("p:" + p);
  const e = (r.email ?? "").trim().toLowerCase();
  if (e.includes("@")) out.push("e:" + e);
  return out;
}

const deaccent = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

/**
 * Tokeniza o CSV inteiro de uma vez (não linha a linha).
 *
 * ⚠️ A versão anterior fazia `text.split(/\r?\n/)` antes de olhar as aspas: um
 * endereço com quebra de linha dentro de `"..."` — comum em exportação de CRM —
 * virava duas linhas quebradas e arrastava todas as colunas seguintes.
 * Também remove o BOM: planilha salva como CSV pelo Excel começa com `﻿`,
 * o cabeçalho `nome` virava `﻿nome`, nenhuma coluna casava e a tela
 * respondia "CSV inválido" num arquivo perfeito.
 */
function tokenize(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      cur = "";
      rows.push(row);
      row = [];
    } else if (ch !== "\r") cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
}

function parseCsv(text: string, known: Set<string>): ParseResult {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.slice(0, clean.indexOf("\n") === -1 ? clean.length : clean.indexOf("\n"));
  const count = (re: RegExp) => firstLine.match(re)?.length ?? 0;
  // Tabulação entra na conta: exportação colada do Excel vem separada por TAB.
  const delim =
    count(/\t/g) > count(/;/g) && count(/\t/g) > count(/,/g)
      ? "\t"
      : count(/;/g) > count(/,/g)
        ? ";"
        : ",";

  const table = tokenize(clean, delim);
  const empty: ParseResult = {
    rows: [],
    total: 0,
    ignored: 0,
    duplicates: 0,
    existing: 0,
    headers: [],
  };
  if (table.length < 2) return empty;

  const header = table[0].map(deaccent);
  const idx = (...names: string[]) => header.findIndex((h) => names.includes(h));
  // Todas as colunas que casam (não só a 1ª) — usado para telefone, que em
  // alguns exports vem espalhado em `phone` (vazio) + `mobile`/`whatsapp` (cheio).
  const allIdx = (...names: string[]) =>
    header.map((h, i) => (names.includes(h) ? i : -1)).filter((i) => i >= 0);

  const iFull = idx("nome completo", "nome_completo", "full name", "fullname", "contato", "cliente");
  const iFirst = idx("nome", "primeiro nome", "first_name", "firstname", "first name", "name");
  const iLast = idx("sobrenome", "ultimo nome", "last_name", "lastname", "last name", "apelido");
  const iEmail = idx("email", "e-mail", "e mail", "mail", "email principal");
  // Telefone pode estar em várias colunas; pega o 1º valor NÃO-VAZIO por linha.
  const iPhones = allIdx(
    "telefone", "phone", "celular", "whatsapp", "fone", "telefone principal",
    "mobile", "telefone celular", "telefone_celular"
  );
  const iDoc = idx("documento", "cpf", "cnpj", "cpf/cnpj", "cpf_cnpj", "doc");
  const iCompany = idx("empresa", "company", "companies", "nome comercial", "organizacao", "organization");
  const iTags = idx("tags", "etiquetas", "marcadores", "tag");

  // Sem NENHUMA coluna de identificação não há contato para criar.
  if (iFull === -1 && iFirst === -1 && iEmail === -1 && iPhones.length === 0) {
    return { ...empty, headers: table[0] };
  }

  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  let ignored = 0;
  let duplicates = 0;
  let existing = 0;

  for (const cols of table.slice(1)) {
    const get = (i: number) => (i >= 0 ? (cols[i] ?? "").trim() : "");

    let firstName = get(iFirst);
    let lastName = get(iLast);
    const full = get(iFull);
    if (full && !firstName) {
      const parts = full.split(/\s+/);
      firstName = parts[0];
      lastName = parts.slice(1).join(" ");
      // "nome" + "nome completo" no mesmo arquivo: o completo só preenche o vazio.
    } else if (full && !lastName && full !== firstName) {
      lastName = full.slice(firstName.length).trim();
    }

    const email = get(iEmail);
    const phone = iPhones.map((i) => (cols[i] ?? "").trim()).find((v) => v) ?? "";
    const doc = get(iDoc);

    // Nome vazio mas com e-mail/telefone é contato de verdade (a coluna `first_name`
    // é NOT NULL, então precisa de ALGO): usa o e-mail/telefone como nome. Descartar
    // era jogar fora lead com contato válido — o oposto de "deixar no histórico".
    if (!firstName) firstName = email || phone;
    if (!firstName) {
      ignored++;
      continue;
    }

    const keys = identityKeys({ doc, phone, email });
    if (keys.some((k) => known.has(k))) {
      existing++;
      continue;
    }
    if (keys.length > 0 && keys.some((k) => seen.has(k))) {
      duplicates++;
      continue;
    }
    keys.forEach((k) => seen.add(k));

    rows.push({
      firstName,
      lastName,
      email,
      phone,
      doc: doc || undefined,
      company: get(iCompany) || undefined,
      tags: get(iTags)
        .split(/[|,;]/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    });
  }

  return {
    rows,
    total: table.length - 1,
    ignored,
    duplicates,
    existing,
    headers: table[0],
  };
}

const nf = new Intl.NumberFormat("pt-BR");

/**
 * Quais dessas chaves já existem no CRM.
 *
 * ⚠️ Isto era um `Set` montado a partir do array de contatos do store. A tela de
 * Contatos deixou de carregar os 41 mil (ela pagina no servidor), então esse
 * array vive vazio e a checagem sumiria EM SILÊNCIO — reimportar o mesmo
 * arquivo duplicaria o histórico inteiro. Agora quem responde é o banco
 * (`existing_contact_keys`), com as mesmas chaves: documento, telefone
 * normalizado e e-mail.
 */
async function fetchExistingKeys(rows: ParsedRow[]): Promise<Set<string>> {
  const locationId = useDbStore.getState().locationId;
  const out = new Set<string>();
  if (!locationId || rows.length === 0) return out;
  const supabase = createClient();
  // Lotes de 5000 linhas: o corpo da chamada leva as chaves do arquivo inteiro,
  // e 41 mil de uma vez é um payload grande demais para uma requisição só.
  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { data, error } = await supabase.rpc("existing_contact_keys", {
      p_location: locationId,
      p_docs: slice.map((r) => r.doc ?? "").filter(Boolean),
      p_phones: slice.map((r) => r.phone).filter(Boolean),
      p_emails: slice.map((r) => r.email).filter(Boolean),
    });
    // Falha aqui NÃO pode travar a importação: sem a resposta, o arquivo entra
    // inteiro (o dedupe interno do próprio arquivo continua valendo).
    if (error) return out;
    for (const row of (data ?? []) as { chave: string }[]) out.add(row.chave);
  }
  return out;
}

export function ImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(0);
  const [parsing, setParsing] = useState(false);
  // Opcional: transforma os importados numa lista inteligente (via tag = nome).
  const [listName, setListName] = useState("");
  // Linhas COMPLETAS do arquivo (sem tirar os que já existem). Ao montar uma
  // lista, precisamos enviar também os já existentes — o servidor não os duplica,
  // mas MARCA a tag neles (senão quem já estava no CRM ficaria fora da lista).
  const [fullRows, setFullRows] = useState<ParsedRow[]>([]);

  const reset = () => {
    setResult(null);
    setFileName(null);
    setDone(0);
    setListName("");
    setFullRows([]);
  };

  const onFile = async (file: File) => {
    setParsing(true);
    try {
      const text = await file.text();
      // Duas passadas: a primeira só para saber QUAIS chaves o arquivo traz, a
      // segunda já sabendo quais delas o CRM tem. Uma passada só exigiria mandar
      // o arquivo inteiro para o banco antes de saber se vale a pena.
      const primeira = parseCsv(text, new Set());
      const known = await fetchExistingKeys(primeira.rows);
      const parsed = known.size > 0 ? parseCsv(text, known) : primeira;
      // Guarda o arquivo INTEIRO (com os já existentes) para o caso de montar lista.
      setFullRows(primeira.rows);
      if (parsed.rows.length === 0 && primeira.rows.length === 0) {
        toast.error(
          parsed.headers.length > 0
            ? `Nenhuma coluna reconhecida. O arquivo tem: ${parsed.headers.slice(0, 8).join(", ")}. Renomeie o cabeçalho para nome, sobrenome, email, telefone, documento, empresa ou tags.`
            : "Não encontrei linhas no arquivo. A 1ª linha precisa ser o cabeçalho (ex.: nome;sobrenome;email;telefone)."
        );
        return;
      }
      setFileName(file.name);
      setResult(parsed);
      setDone(0);
    } finally {
      setParsing(false);
    }
  };

  const run = async () => {
    if (!result) return;
    // Lista inteligente: marca todo importado com a tag (= nome da lista, em
    // minúsculas, como o parser já grava tags) e cria a lista casando essa tag.
    const listTrim = listName.trim();
    const tag = listTrim.toLowerCase();
    // Com lista: envia o arquivo INTEIRO (o servidor não duplica os já existentes,
    // mas marca a tag neles). Sem lista: só os novos (pré-filtrados).
    const base = listTrim ? fullRows : result.rows;
    const rows = tag
      ? base.map((r) => (r.tags.includes(tag) ? r : { ...r, tags: [...r.tags, tag] }))
      : base;
    setImporting(true);
    setDone(0);
    const r = await dbContactActions.bulkInsert(rows, (d) => setDone(d));
    setImporting(false);

    const merged = r.merged ?? 0;
    const processed = r.inserted + merged;
    if (processed > 0) {
      await logBulk(
        `Importação CSV — ${fileName ?? "arquivo"}${listTrim ? ` (lista: ${listTrim})` : ""}`,
        processed
      );
    }
    // Nada inserido NEM marcado: só é erro se não foi porque todos já estavam ok.
    if (processed === 0) {
      if (r.skipped > 0 && !r.error) {
        toast.info(
          `Nada a fazer: os ${nf.format(r.skipped)} contato(s) já existiam${listTrim ? " e já estavam na lista" : ""} (nenhum duplicado criado).`
        );
        reset();
        onImported?.();
        onOpenChange(false);
        return;
      }
      toast.error(`A importação falhou${r.error ? `: ${r.error}` : ""}`);
      return;
    }
    // Cria a lista inteligente (se ainda não houver uma com esse nome).
    if (listTrim) {
      const exists = useModuleStore
        .getState()
        .smartLists.some((l) => l.name.trim().toLowerCase() === tag);
      if (!exists) {
        const ok = await smartListActions.add(listTrim, [
          { field: "Tag", operator: "é", value: tag },
        ]);
        if (!ok) toast.warning(`Feito, mas não criei a lista "${listTrim}"`);
      }
    }
    const partes: string[] = [];
    if (r.inserted) partes.push(`${nf.format(r.inserted)} novo(s)`);
    if (merged) partes.push(`${nf.format(merged)} já existente(s) marcado(s)`);
    const resumo = partes.join(" + ") || `${nf.format(processed)} contato(s)`;
    const naLista = listTrim ? ` na lista "${listTrim}"` : "";
    if (r.failed > 0) {
      toast.warning(
        `${resumo}${naLista}; ${nf.format(r.failed)} ficaram de fora${r.error ? ` (${r.error})` : ""}`
      );
    } else {
      toast.success(`${resumo}${naLista}`);
    }
    reset();
    onImported?.();
    onOpenChange(false);
  };

  const total = result?.rows.length ?? 0;
  const listMode = listName.trim().length > 0;
  // Em modo lista enviamos o arquivo inteiro (marca a tag nos já existentes);
  // fora dele, só os novos pré-filtrados.
  const sendCount = listMode ? fullRows.length : total;
  const canImport = sendCount > 0;
  const pct = sendCount > 0 ? Math.min(100, Math.round((done / sendCount) * 100)) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Fechar no meio não cancela os lotes já em voo — melhor não deixar fechar.
        if (importing) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar contatos (CSV)</DialogTitle>
        </DialogHeader>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void onFile(f);
          }}
        />
        <div className="space-y-1">
          <Label className="text-xs">Transformar em lista inteligente (opcional)</Label>
          <Input
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            placeholder="Ex.: Formulário MMA"
            disabled={importing}
            className="h-8 text-xs"
          />
          <p className="text-[11px] text-slate-400">
            Se preencher, os contatos importados recebem essa etiqueta e viram uma
            lista inteligente com esse nome — sempre em sincronia.
          </p>
        </div>
        {!result ? (
          <button
            disabled={parsing}
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 py-10 text-indigo-600 hover:bg-indigo-50 disabled:opacity-60"
          >
            <UploadCloud className="size-8" />
            <span className="text-sm font-semibold">
              {parsing ? "Lendo o arquivo..." : "Escolher arquivo CSV"}
            </span>
            <span className="px-6 text-center text-[11px] text-indigo-400">
              Cabeçalhos aceitos: nome, sobrenome (ou nome completo), email, telefone,
              documento (CPF/CNPJ), empresa, tags. Separador , ; ou tabulação.
            </span>
          </button>
        ) : (
          <div className="space-y-3 rounded-lg border bg-slate-50 p-4 text-sm">
            <p className="font-semibold text-slate-800">{fileName}</p>
            <p className="text-xs text-slate-600">
              {listMode ? (
                <>
                  <span className="font-semibold text-slate-900">{nf.format(fullRows.length)}</span>{" "}
                  contato(s) do arquivo entram na lista{" "}
                  <span className="font-medium text-indigo-600">{listName.trim()}</span> — os que já
                  existem recebem a etiqueta (sem duplicar).
                </>
              ) : (
                <>
                  <span className="font-semibold text-slate-900">{nf.format(total)}</span> contato(s)
                  novos de {nf.format(result.total)} linha(s).
                </>
              )}
              {(result.rows[0] ?? fullRows[0]) && (
                <>
                  {" "}
                  Exemplo:{" "}
                  <span className="font-medium text-slate-700">
                    {(result.rows[0] ?? fullRows[0]).firstName}{" "}
                    {(result.rows[0] ?? fullRows[0]).lastName} ·{" "}
                    {(result.rows[0] ?? fullRows[0]).email ||
                      (result.rows[0] ?? fullRows[0]).phone ||
                      "—"}
                  </span>
                </>
              )}
            </p>
            {(result.existing > 0 || result.duplicates > 0 || result.ignored > 0) && (
              <ul className="space-y-0.5 text-[11px] text-slate-500">
                {result.existing > 0 && (
                  <li>
                    {nf.format(result.existing)} já existem no CRM
                    {listMode ? " (recebem a etiqueta)" : " (ignorados)"}
                  </li>
                )}
                {result.duplicates > 0 && (
                  <li>{nf.format(result.duplicates)} repetidos no próprio arquivo</li>
                )}
                {result.ignored > 0 && (
                  <li>{nf.format(result.ignored)} sem nome, e-mail e telefone</li>
                )}
              </ul>
            )}
            {importing && (
              <div className="space-y-1">
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  {nf.format(done)} de {nf.format(sendCount)} — não feche esta janela.
                </p>
              </div>
            )}
            {!importing && sendCount > 5000 && (
              <p className="text-[11px] text-amber-700">
                Arquivo grande: a importação vai em lotes e pode levar alguns minutos.
                Deixe a aba aberta.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={importing} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!canImport || importing} onClick={run}>
            {importing
              ? `Importando ${pct}%`
              : listMode
                ? `Importar ${nf.format(sendCount)} para a lista`
                : `Importar ${sendCount ? nf.format(sendCount) : ""}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Exporta os contatos para CSV e registra no log de ações em massa. */
export function exportContactsCsv(contacts: Contact[]) {
  if (contacts.length === 0) {
    toast.error("Nada para exportar");
    return;
  }
  const esc = (v: string) => `"${(v ?? "").replaceAll('"', '""')}"`;
  const header = "nome;sobrenome;email;telefone;documento;empresa;tags";
  const lines = contacts.map((c) =>
    [c.firstName, c.lastName, c.email, c.phone, c.doc ?? "", c.company ?? "", c.tags.join("|")]
      .map(esc)
      .join(";")
  );
  const blob = new Blob(["﻿" + [header, ...lines].join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `contatos-lito-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  void logBulk("Exportação de contatos (CSV)", contacts.length);
  toast.success(
    `${contacts.length} contato(s) exportado(s) — ${contacts.length === 1 ? "" : "ex.: "}${contactName(contacts[0])}${contacts.length > 1 ? "..." : ""}`
  );
}
