import Link from "next/link";

/** Moldura das páginas públicas (Privacidade / Termos). Sem sessão, sem shell. */
export function LegalPage({
  titulo,
  atualizado,
  children,
}: {
  titulo: string;
  atualizado: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-4 py-12 text-sm leading-relaxed text-slate-700">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Lito CRM</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{titulo}</h1>
        <p className="mt-1 text-xs text-slate-500">Última atualização: {atualizado}</p>
        <div className="mt-8 space-y-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:space-y-1">
          {children}
        </div>
        <p className="mt-12 border-t pt-4 text-xs text-slate-500">
          <Link href="/privacidade" className="underline">
            Política de Privacidade
          </Link>
          {" · "}
          <Link href="/termos" className="underline">
            Termos de Serviço
          </Link>
          {" · "}Contato: contato@litoaviation.com
        </p>
      </div>
    </main>
  );
}
