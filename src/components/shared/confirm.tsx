"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Confirmação DENTRO do CRM, no lugar do `window.confirm`.
 *
 * O diálogo do navegador tem três problemas que não dependem de gosto:
 *   * é desenhado pelo sistema, com o texto "lito-crm.vercel.app diz" em cima —
 *     parece aviso do navegador, não do produto;
 *   * não distingue ação destrutiva de ação comum: "Excluir 12 contatos" e
 *     "Salvar" ganham o mesmo botão azul;
 *   * não aceita formatação nenhuma, então o aviso importante ("não tem
 *     desfazer") fica no meio de uma frase corrida.
 *
 * A API é PROMISE, de propósito: no ponto de uso a troca é linha por linha
 * (`if (!window.confirm(x)) return;` → `if (!(await confirm({ title: x }))) return;`),
 * sem espalhar estado de diálogo por 13 arquivos.
 */

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Vermelho no botão + ícone de alerta: exclusão, desconexão, cancelamento. */
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  // O `resolve` da promise em aberto: é o que liga o clique no botão de volta
  // ao `await` de quem chamou.
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = (ok: boolean) => {
    setOptions(null);
    resolver.current?.(ok);
    resolver.current = null;
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={!!options}
        // Fechar pelo Esc, pelo X ou clicando fora = cancelar. Sem isto a
        // promise ficaria pendurada para sempre e o botão que abriu o diálogo
        // continuaria "carregando".
        onOpenChange={(o) => !o && settle(false)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6">
              {options?.destructive && (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                  <AlertTriangle className="size-4" />
                </span>
              )}
              {options?.title}
            </DialogTitle>
          </DialogHeader>
          {options?.description && (
            <div className="text-xs leading-relaxed text-slate-500">{options.description}</div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => settle(false)}
            >
              {options?.cancelLabel ?? "Cancelar"}
            </Button>
            <Button
              variant={options?.destructive ? "destructive" : "default"}
              size="sm"
              className="h-8 text-xs"
              autoFocus
              onClick={() => settle(true)}
            >
              {options?.confirmLabel ?? "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/**
 * Devolve a função de confirmar. Fora do provider cai no `window.confirm` —
 * um componente reaproveitado numa tela sem o provider continua funcionando
 * (feio, mas funcionando) em vez de quebrar em runtime.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return (
    ctx ??
    (async (o: ConfirmOptions) =>
      typeof window === "undefined" ? false : window.confirm(o.title))
  );
}
