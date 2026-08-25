"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Download, Filter, Plus, Upload } from "lucide-react";
import { SubNav } from "@/components/layout/subnav";
import { DataTable, type Column } from "@/components/shared/data-table";
import { FilterDrawer, type FilterCondition } from "@/components/shared/filter-drawer";
import { ChannelIcon } from "@/components/shared/channel-icon";
import { BulkActions } from "@/components/contacts/bulk-actions";
import { ContactFormDialog } from "@/components/contacts/contact-form-dialog";
import { ImportDialog, exportContactsCsv } from "@/components/contacts/import-export";
import {
  BulkLogTab,
  CompaniesTab,
  FieldsTab,
  SmartListsTab,
  TasksTab,
} from "@/components/contacts/module-tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { contactName } from "@/lib/data/repos/contacts";
import { fetchAllMatching, useContactsSearch } from "@/lib/data/repos/db/contacts-search";
import type { Contact } from "@/lib/data/types";

const TABS = [
  { label: "Contatos" },
  { label: "Listas inteligentes" },
  { label: "Ações em massa" },
  { label: "Tarefas" },
  { label: "Empresas" },
  { label: "Configurações" },
];

const FILTER_FIELDS = ["Nome", "E-mail", "Telefone", "Empresa", "Tag"];

function avatarColor(id: string) {
  const colors = ["bg-indigo-500", "bg-pink-500", "bg-emerald-500", "bg-amber-500", "bg-sky-500"];
  return colors[id.split("").reduce((s, ch) => s + ch.charCodeAt(0), 0) % colors.length];
}

const PAGE_SIZE = 12;

export default function ContatosPage() {
  const router = useRouter();
  const [tab, setTab] = useState("Contatos");
  const [filterOpen, setFilterOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [exporting, setExporting] = useState(false);

  // Busca, ordenação e página vivem AQUI (e não dentro da tabela) porque agora
  // são os parâmetros de uma consulta ao banco, não estado de desenho.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);

  const { rows, total, loading, error, refresh } = useContactsSearch({
    query,
    conditions,
    sort,
    page,
    pageSize: PAGE_SIZE,
  });

  // Trocar o filtro reinicia a paginação: a página 7 do filtro antigo não tem
  // relação nenhuma com o novo, e cair numa página vazia parece "sem resultado".
  const applyConditions = (conds: FilterCondition[]) => {
    setConditions(conds);
    setPage(0);
  };

  const applySmartList = (conds: FilterCondition[]) => {
    applyConditions(conds);
    setTab("Contatos");
  };

  const exportar = async () => {
    setExporting(true);
    const t = toast.loading("Preparando a exportação...");
    // Exporta o FILTRO INTEIRO, não a página na tela — mas buscando do servidor,
    // que é o único lugar onde os 41 mil existem.
    const all = await fetchAllMatching({ query, conditions, sort }, (done, tot) =>
      toast.loading(`Preparando a exportação... ${done.toLocaleString("pt-BR")} de ${tot.toLocaleString("pt-BR")}`, { id: t })
    );
    toast.dismiss(t);
    setExporting(false);
    exportContactsCsv(all);
  };

  const columns: Column<Contact>[] = [
    {
      key: "nome",
      header: "Nome do Contato",
      sortable: true,
      sortValue: (c) => contactName(c),
      render: (c) => (
        <div className="flex items-center gap-2">
          <Avatar className="size-7">
            <AvatarFallback className={`${avatarColor(c.id)} text-[10px] font-bold text-white`}>
              {(c.firstName[0] ?? "?").toUpperCase()}
              {(c.lastName[0] ?? "").toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="font-medium text-slate-800">{contactName(c)}</span>
        </div>
      ),
    },
    { key: "telefone", header: "Telefone", render: (c) => <span className="text-slate-600">{c.phone || "—"}</span> },
    { key: "email", header: "E-mail", render: (c) => <span className="text-slate-600">{c.email || "—"}</span> },
    {
      key: "empresa",
      header: "Nome comercial",
      sortable: true,
      sortValue: (c) => c.company ?? "",
      render: (c) => <span className="text-slate-600">{c.company ?? "—"}</span>,
    },
    {
      key: "criado",
      header: "Criado (-03)",
      sortable: true,
      sortValue: (c) => c.createdAt,
      render: (c) => (
        <span className="text-slate-500">
          {format(new Date(c.createdAt), "d MMM yyyy HH:mm", { locale: ptBR })}
        </span>
      ),
    },
    {
      key: "atividade",
      header: "Última atividade",
      sortable: true,
      sortValue: (c) => c.lastActivityAt,
      render: (c) => (
        <span className="flex items-center gap-1.5 text-slate-500">
          <ChannelIcon channel={c.lastActivityChannel} size={16} />
          {formatDistanceToNow(new Date(c.lastActivityAt), { locale: ptBR, addSuffix: true })}
        </span>
      ),
    },
    {
      key: "tags",
      header: "Tags",
      render: (c) => (
        <div className="flex flex-wrap gap-1">
          {c.tags.map((t) => (
            <Badge key={t} variant="secondary" className="text-[10px]">
              {t}
            </Badge>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div>
      <SubNav tabs={TABS} active={tab} onChange={setTab} />
      <div className="p-6">
        {tab === "Contatos" ? (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-bold text-slate-900">Contatos</h1>
                <Badge variant="secondary">
                  {loading && rows.length === 0
                    ? "Carregando..."
                    : `${total.toLocaleString("pt-BR")} contatos`}
                </Badge>
                {conditions.length > 0 && (
                  <button
                    onClick={() => applyConditions([])}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    Limpar {conditions.length} filtro(s)
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setFilterOpen(true)}
                >
                  <Filter className="size-3.5" /> Filtros avançados
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={exporting || total === 0}
                  onClick={() => void exportar()}
                >
                  <Download className="size-3.5" /> Exportar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setImportOpen(true)}
                >
                  <Upload className="size-3.5" /> Importar
                </Button>
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setFormOpen(true)}>
                  <Plus className="size-3.5" /> Adicionar Contato
                </Button>
              </div>
            </div>
            {error && (
              <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}
            <DataTable
              data={rows}
              columns={columns}
              selectable
              searchPlaceholder="Pesquisar por nome, e-mail, telefone ou empresa"
              bulkBar={(ids, clear) => (
                <BulkActions
                  ids={ids}
                  clear={() => {
                    clear();
                    // A ação em massa mexeu no banco; a página na tela veio de
                    // uma consulta e não se corrige sozinha.
                    refresh();
                  }}
                />
              )}
              pageSize={PAGE_SIZE}
              onRowClick={(c) => router.push(`/contatos/${c.id}`)}
              server={{
                total,
                page,
                onPageChange: setPage,
                query,
                onQueryChange: (q) => {
                  setQuery(q);
                  setPage(0);
                },
                sort,
                onSortChange: setSort,
                loading,
              }}
            />
          </>
        ) : tab === "Listas inteligentes" ? (
          <SmartListsTab onApply={applySmartList} onImport={() => setImportOpen(true)} />
        ) : tab === "Ações em massa" ? (
          <BulkLogTab />
        ) : tab === "Tarefas" ? (
          <TasksTab />
        ) : tab === "Empresas" ? (
          <CompaniesTab />
        ) : (
          <FieldsTab />
        )}
      </div>
      <FilterDrawer
        open={filterOpen}
        onOpenChange={setFilterOpen}
        fields={FILTER_FIELDS}
        onApply={applyConditions}
      />
      <ContactFormDialog open={formOpen} onOpenChange={setFormOpen} onCreated={refresh} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={refresh} />
    </div>
  );
}
