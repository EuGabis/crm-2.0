"use client";

import { Badge } from "@/components/ui/badge";
import { useAiLogs } from "@/lib/data/repos/db/ai";

const FEATURE_LABEL: Record<string, string> = {
  generate: "Geração de texto",
  content: "Content AI",
  "agent-test": "Teste de bot",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function AiLogsTab() {
  const { logs, ready } = useAiLogs(30);

  return (
    <>
      <h1 className="mb-1 text-lg font-bold text-slate-900">Logs de atividade da IA</h1>
      <p className="mb-4 text-xs text-slate-500">
        Últimas gerações e testes executados pela sua IA.
      </p>
      {!ready ? (
        <div className="rounded-xl border bg-white p-8 text-center text-xs text-slate-400">Carregando...</div>
      ) : logs.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-white p-8 text-center">
          <p className="text-sm font-semibold text-slate-700">Nenhuma atividade ainda</p>
          <p className="mt-1 text-xs text-slate-500">
            Gere um conteúdo no Content AI ou teste um bot no Conversation AI para ver os registros aqui.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-[11px] text-slate-400">
                <th className="px-4 py-2.5 font-medium">Data/hora</th>
                <th className="px-4 py-2.5 font-medium">Recurso</th>
                <th className="px-4 py-2.5 font-medium">Modelo</th>
                <th className="px-4 py-2.5 font-medium">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5 text-slate-500">{formatDateTime(log.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant="secondary">{FEATURE_LABEL[log.feature] ?? log.feature}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{log.model}</td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {log.promptTokens + log.completionTokens}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
