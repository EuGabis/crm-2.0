"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type Disponibilidade = "online" | "ausente";

/**
 * O status do atendente: recebe lead novo, ou só responde o que já é dele.
 *
 * Pedido do Gabriel (2026-09-10): *"os vendedores ficam no CRM pós expediente
 * para responder os leads, mas eles não querem receber leads novos."*
 *
 * ⚠️ **Isto separa duas coisas que estavam coladas em `last_seen_at`:** ESTAR no
 * CRM e QUERER lead novo. Até aqui a única forma de parar de receber era fechar o
 * CRM — e aí a pessoa também parava de responder quem já está com ela, que é
 * justamente o que ela ficou fazendo.
 *
 * ⚠️ **Mora na barra superior, e VISÍVEL — não escondido no menu do avatar.**
 * Um status que interrompe a chegada de lead e não aparece na tela é uma
 * armadilha: quem esquecer marcado como Ausente para de receber e não descobre
 * por quê. O rótulo escrito ao lado do ponto é o que evita isso; um ponto
 * colorido sozinho não diz nada a quem não conhece o código de cores (e some na
 * deuteranopia).
 */
export function DisponibilidadeSwitch() {
  const [valor, setValor] = useState<Disponibilidade | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let ativo = true;
    void (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      /*
       * ⚠️ `.eq("user_id", ...)` é obrigatório: a policy de leitura de
       * `location_members` é por EMPRESA, então sem o filtro vêm todas as
       * pessoas e o `maybeSingle()` reclama de várias linhas — o defeito que o
       * `open()` das conversas teve em 01/09.
       */
      const { data, error } = await supabase
        .from("location_members")
        .select("disponibilidade")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!ativo) return;
      /*
       * ⚠️ Erro (coluna ainda não existe — o código vai ao ar antes da migração)
       * não vira "online" na tela: o controle simplesmente não aparece. Mostrar
       * "Online" sem conseguir gravar seria um botão que mente.
       */
      if (error || !data) return;
      setValor(((data as { disponibilidade?: string }).disponibilidade as Disponibilidade) ?? "online");
    })();
    return () => {
      ativo = false;
    };
  }, []);

  if (!valor) return null;

  const trocar = async (novo: Disponibilidade) => {
    if (novo === valor || salvando) return;
    setSalvando(true);
    const anterior = valor;
    setValor(novo); // otimista: o clique responde na hora
    const supabase = createClient();
    const { data, error } = await supabase.rpc("definir_disponibilidade", { p_valor: novo });
    setSalvando(false);
    // A função devolve se ESCREVEU. `update` que não acha linha não é erro no
    // Postgres, e sem conferir o retorno a tela diria "salvo" sem ter salvo.
    if (error || data !== true) {
      setValor(anterior);
      toast.error("Não foi possível mudar o status");
      return;
    }
    toast.success(
      novo === "online"
        ? "Você voltou a receber leads novos"
        : "Ausente — você continua respondendo os seus leads, mas não recebe novos",
    );
  };

  const ausente = valor === "ausente";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            title="Recebimento de leads novos"
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors",
              ausente
                ? "border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20"
                : "border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20",
            )}
          />
        }
      >
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", ausente ? "bg-amber-400" : "bg-emerald-400")}
        />
        {ausente ? "Ausente" : "Online"}
        <ChevronDown className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {(
          [
            {
              v: "online" as const,
              titulo: "Online",
              texto: "Recebe leads novos do bot e do rodízio.",
            },
            {
              v: "ausente" as const,
              titulo: "Ausente",
              texto:
                "Continua respondendo os leads que já são seus, mas não recebe nenhum novo. Transferência de um colega ainda chega.",
            },
          ]
        ).map((o) => (
          <DropdownMenuItem
            key={o.v}
            onClick={() => void trocar(o.v)}
            className="flex items-start gap-2 py-2"
          >
            <Check className={cn("mt-0.5 size-3.5 shrink-0", valor === o.v ? "" : "opacity-0")} />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-slate-800">{o.titulo}</span>
              <span className="block text-[11px] leading-snug text-slate-500">{o.texto}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
