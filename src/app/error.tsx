"use client";

import { useEffect } from "react";

/**
 * Tela de erro do app.
 *
 * 🔴 **Código velho depois de deploy** (2026-10-05). A cada deploy os pedaços de
 * JavaScript mudam de nome. Uma aba aberta antes disso, ao navegar para outra
 * tela, pede um pedaço que não existe mais e cai aqui — foi o "Calendários não
 * funciona" e a conversa "congelada" do mesmo dia, depois de mais de dez deploys.
 * Nesse caso a saída é recarregar, e a tela faz isso SOZINHA, uma vez.
 *
 * ⚠️ Uma vez só (marca em sessionStorage por 1 min): se o erro voltar depois do
 * recarregamento, não é código velho, e recarregar em laço esconderia o defeito.
 *
 * ⚠️ Nos outros casos a mensagem e o código (`digest`) aparecem na tela. A
 * versão anterior descartava o erro, e "Algo deu errado" sem motivo obrigava a
 * pedir F12 a quem só queria trabalhar.
 */
const CHAVE = "lito.recarregou-apos-erro";

function ehCodigoVelho(error: Error): boolean {
  const texto = `${error?.name ?? ""} ${error?.message ?? ""}`;
  return /ChunkLoadError|Loading (CSS )?chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    texto
  );
}

function jaRecarregou(): boolean {
  try {
    const t = Number(sessionStorage.getItem(CHAVE) ?? 0);
    return Date.now() - t < 60_000;
  } catch {
    return true; // sem storage, não arrisca laço
  }
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const velho = ehCodigoVelho(error);

  useEffect(() => {
    console.error("[erro da tela]", error);
    if (velho && !jaRecarregou()) {
      try {
        sessionStorage.setItem(CHAVE, String(Date.now()));
      } catch {
        /* segue sem a marca */
      }
      window.location.reload();
    }
  }, [error, velho]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center">
      <h1 className="text-xl font-bold text-slate-900">
        {velho ? "O CRM foi atualizado" : "Algo deu errado"}
      </h1>
      <p className="max-w-md text-sm text-slate-500">
        {velho
          ? "Esta aba estava com a versão anterior. Recarregue a página para continuar."
          : "Ocorreu um erro inesperado nesta tela."}
      </p>
      {!velho && (error?.message || error?.digest) && (
        <p className="max-w-lg break-words rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-[11px] text-slate-600">
          {error.message}
          {error.digest ? ` · código ${error.digest}` : ""}
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-600"
        >
          Recarregar a página
        </button>
        {!velho && (
          <button
            onClick={reset}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Tentar novamente
          </button>
        )}
      </div>
    </div>
  );
}
