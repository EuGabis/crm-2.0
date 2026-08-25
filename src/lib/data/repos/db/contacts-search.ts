"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDbStore } from "@/lib/data/repos/db/contacts";
import type { Contact } from "@/lib/data/types";
import type { FilterCondition } from "@/components/shared/filter-drawer";

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(row: any): Contact {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    doc: row.doc ?? undefined,
    company: row.company ?? undefined,
    tags: row.tags ?? [],
    ownerId: row.owner_id ?? "",
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at ?? row.created_at,
    lastActivityChannel: (row.last_activity_channel ?? "whatsapp") as Contact["lastActivityChannel"],
    dnd: row.dnd,
    customFields: row.custom_fields ?? {},
  };
}

/** Colunas da tabela → o `p_sort` que a função entende. */
const SORT_KEYS: Record<string, string> = {
  nome: "name",
  empresa: "company",
  criado: "created_at",
  atividade: "activity",
};

export interface ContactQuery {
  query: string;
  conditions: FilterCondition[];
  sort: { key: string; dir: "asc" | "desc" } | null;
  page: number;
  pageSize: number;
}

async function callSearch(
  locationId: string,
  q: ContactQuery
): Promise<{ rows: Contact[]; total: number } | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("search_contacts", {
    p_location: locationId,
    p_query: q.query,
    p_conditions: q.conditions,
    p_sort: q.sort ? (SORT_KEYS[q.sort.key] ?? "created_at") : "created_at",
    p_dir: q.sort?.dir ?? "desc",
    p_limit: q.pageSize,
    p_offset: q.page * q.pageSize,
  });
  if (error) return null;
  const rows = (data ?? []) as any[];
  return {
    rows: rows.map(mapRow),
    // `total` é a contagem do filtro inteiro e vem repetida em toda linha;
    // página vazia (fim da lista, ou filtro sem resultado) não traz nenhuma.
    total: rows.length > 0 ? Number(rows[0].total ?? 0) : 0,
  };
}

/**
 * Uma página de contatos, filtrada e contada PELO BANCO.
 *
 * ⚠️ O total só é confiável enquanto vem linha: numa página além do fim a
 * consulta devolve zero linhas e, com ele, zero total — o selo piscaria "0
 * contatos" ao passar do último. Por isso o último total conhecido é mantido
 * até uma resposta COM linhas trazer outro.
 */
export function useContactsSearch(q: ContactQuery) {
  const locationId = useDbStore((s) => s.locationId);
  // `ensureSession`, não `load`: aqui só se precisa saber a empresa — `load()`
  // baixaria os 41 mil contatos que esta tela existe para NÃO baixar.
  const load = useDbStore((s) => s.ensureSession);
  const [rows, setRows] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Cada busca carrega um número de sequência: a resposta de uma tecla antiga
  // não pode sobrescrever a da tecla mais nova (digitar "maria" dispara várias,
  // e elas não voltam na ordem em que saíram).
  const seq = useRef(0);
  const lastTotal = useRef(0);

  const { query, conditions, sort, page, pageSize } = q;
  const condKey = JSON.stringify(conditions);
  const sortKey = sort ? `${sort.key}:${sort.dir}` : "";

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!locationId) return;
    const mine = ++seq.current;
    // Debounce só para o que a pessoa DIGITA. Trocar de página ou de ordem é um
    // clique — esperar 300 ms ali só faria a tela parecer travada.
    const delay = query.trim() ? 300 : 0;
    const timer = setTimeout(async () => {
      // `setLoading` entra AQUI, e não no corpo do efeito: além de ser o que a
      // regra do React pede, evita que cada tecla digitada pisque "Carregando"
      // antes mesmo de a busca sair.
      setLoading(true);
      const res = await callSearch(locationId, {
        query,
        conditions: JSON.parse(condKey),
        sort,
        page,
        pageSize,
      });
      if (mine !== seq.current) return;
      if (!res) {
        setError("Não foi possível carregar os contatos");
        setLoading(false);
        return;
      }
      setError(null);
      setRows(res.rows);
      if (res.rows.length > 0) {
        lastTotal.current = res.total;
        setTotal(res.total);
      } else if (page === 0) {
        // Página 1 sem nenhuma linha é filtro sem resultado — aí o zero é real.
        lastTotal.current = 0;
        setTotal(0);
      } else {
        setTotal(lastTotal.current);
      }
      setLoading(false);
    }, delay);
    return () => clearTimeout(timer);
  }, [locationId, query, condKey, sortKey, page, pageSize, sort]);

  const refresh = useCallback(() => {
    seq.current++;
    setRows([]);
    setLoading(true);
    if (!locationId) return;
    void callSearch(locationId, { query, conditions, sort, page, pageSize }).then((res) => {
      if (!res) return;
      setRows(res.rows);
      if (res.rows.length > 0) setTotal(res.total);
      setLoading(false);
    });
  }, [locationId, query, conditions, sort, page, pageSize]);

  return { rows, total, loading, error, refresh };
}

/**
 * Todos os contatos que casam com o filtro — para a exportação CSV.
 *
 * Vai em páginas de 1000 porque o PostgREST corta a resposta nesse tamanho (o
 * mesmo corte que apagou o nome do contato nas conversas). `onProgress` existe
 * porque exportar 41 mil leva alguns segundos e uma tela parada nesse tempo
 * parece travada.
 */
export async function fetchAllMatching(
  q: Pick<ContactQuery, "query" | "conditions" | "sort">,
  onProgress?: (done: number, total: number) => void
): Promise<Contact[]> {
  const locationId = useDbStore.getState().locationId;
  if (!locationId) return [];
  const PAGE = 1000;
  const all: Contact[] = [];
  let total = 0;
  for (let page = 0; ; page++) {
    const res = await callSearch(locationId, { ...q, page, pageSize: PAGE });
    if (!res) break;
    all.push(...res.rows);
    if (page === 0) total = res.total;
    onProgress?.(all.length, total);
    if (res.rows.length < PAGE) break;
  }
  return all;
}

/** Quantos contatos casam com um conjunto de condições (selo das listas). */
export async function countMatching(conditions: FilterCondition[]): Promise<number> {
  const locationId = useDbStore.getState().locationId;
  if (!locationId) return 0;
  // Pede UMA linha só: o `total` vem em qualquer uma delas, e `limit 0` não
  // traria linha nenhuma — logo, nenhum total.
  const res = await callSearch(locationId, {
    query: "",
    conditions,
    sort: null,
    page: 0,
    pageSize: 1,
  });
  return res?.total ?? 0;
}

/** Empresas com a contagem de contatos — agregadas pelo banco. */
export function useContactCompanies() {
  const locationId = useDbStore((s) => s.locationId);
  // `ensureSession`, não `load`: aqui só se precisa saber a empresa — `load()`
  // baixaria os 41 mil contatos que esta tela existe para NÃO baixar.
  const load = useDbStore((s) => s.ensureSession);
  const [rows, setRows] = useState<
    { company: string; contatos: number; ultimoContato: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!locationId) return;
    let alive = true;
    void createClient()
      .rpc("contact_companies", { p_location: locationId })
      .then(({ data }: any) => {
        if (!alive) return;
        setRows(
          ((data ?? []) as any[]).map((r) => ({
            company: r.company,
            contatos: Number(r.contatos ?? 0),
            ultimoContato: r.ultimo_contato ?? null,
          }))
        );
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [locationId]);

  return { companies: rows, loading };
}

/**
 * Resolve contatos por id, em lote e com cache.
 *
 * Quem só precisa do NOME de alguns contatos (a lista de tarefas, por exemplo)
 * não tem por que carregar os 41 mil: `in("id", ids)` traz o punhado que
 * interessa. Os ids já conhecidos não são pedidos de novo.
 */
export function useContactsByIds(ids: (string | null | undefined)[]) {
  const [byId, setById] = useState<Map<string, Contact>>(new Map());
  const wanted = [...new Set(ids.filter((i): i is string => !!i))].sort().join(",");

  useEffect(() => {
    const list = wanted ? wanted.split(",") : [];
    const missing = list.filter((id) => !byId.has(id));
    if (missing.length === 0) return;
    let alive = true;
    void (async () => {
      const supabase = createClient();
      const found: Contact[] = [];
      // Lotes de 200: a lista de ids viaja na URL e uma `in(...)` gigante
      // estoura o limite de tamanho do endereço.
      for (let i = 0; i < missing.length; i += 200) {
        const { data } = await supabase
          .from("contacts")
          .select("*")
          .in("id", missing.slice(i, i + 200));
        found.push(...((data ?? []) as any[]).map(mapRow));
      }
      if (!alive || found.length === 0) return;
      setById((prev) => {
        const next = new Map(prev);
        found.forEach((c) => next.set(c.id, c));
        return next;
      });
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  return byId;
}
