"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useApptStore } from "@/lib/data/repos/db/appointments";
import { useModuleStore } from "@/lib/data/repos/db/contacts-module";
import { usePipelineDbStore } from "@/lib/data/repos/db/pipeline";

/**
 * Relê os dados da tela ao TROCAR DE PÁGINA.
 *
 * As stores do CRM carregam UMA VEZ por sessão (`if (loaded || loading) return`)
 * — decisão certa para não repetir consulta a cada navegação, e que virou
 * problema quando passou a existir quem escreve no banco sem ser o usuário: o
 * bot do WhatsApp criou um lead e o card só aparecia depois de um F5. Voltar
 * para uma tela é o momento natural de revalidar.
 *
 * Mora no shell, num só lugar, em vez de um `useEffect` de reload em cada
 * página: espalhado, a próxima tela nasceria sem revalidação e ninguém
 * lembraria do porquê.
 *
 * Silencioso por definição: cada `reload()` acrescenta/substitui dados sem tocar
 * em `loading`/`loaded`, então nenhuma tela volta para "Carregando...". Falha de
 * rede é ignorada — melhor dado velho na tela do que tela vazia.
 *
 * Conversas fica de fora de propósito: tem Realtime + `useInboxLiveSync`, com
 * varredura própria a cada 15 s.
 */

/** Prefixo da rota -> o que revalidar ao entrar nela. */
const ROUTE_RELOADS: { prefix: string; reload: () => Promise<void> }[] = [
  // Leads e painel leem o mesmo funil.
  { prefix: "/leads", reload: () => usePipelineDbStore.getState().reload() },
  { prefix: "/dashboard", reload: () => usePipelineDbStore.getState().reload() },
  // /contatos NÃO relê a lista de contatos: a tela pagina no servidor e relê a
  // própria página. Revalidar aqui voltaria a baixar os 41 mil a cada entrada
  // na rota — exatamente o que a tela deixou de fazer.
  { prefix: "/contatos", reload: () => useModuleStore.getState().reload() },
  { prefix: "/calendarios", reload: () => useApptStore.getState().reload() },
];

export function RouteRevalidator() {
  const pathname = usePathname();
  // A primeira montagem não revalida: o `load()` da própria página acabou de
  // buscar os dados, e uma segunda leitura no mesmo instante é desperdício.
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!pathname) return;
    for (const { prefix, reload } of ROUTE_RELOADS) {
      if (pathname.startsWith(prefix)) void reload();
    }
  }, [pathname]);

  return null;
}
