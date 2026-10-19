-- O selo "Veio do rodízio" some quando o vendedor RESPONDE (pedido 2026-10-19).
--
-- A tela mostra o selo enquanto conversations.devolvida_em estiver preenchido
-- (e a atribuição atual for a da devolução). Este gatilho limpa devolvida_em na
-- primeira resposta HUMANA — mesma régua de private.respondida_por_humano:
-- saída, não automática, não nota interna, não evento do fio.
--
-- ⚠️ Limpar devolvida_em não reabre o laço de devolução: depois da primeira
-- resposta humana a conversa já não é devolvível (202609092030, `ja_respondida`).
--
-- ⚠️ GATILHO e não código em cada envio: humano responde por texto, mídia,
-- template e reenvio — o próximo caminho esqueceria. O update só roda quando há
-- o que limpar (índice por PK + `devolvida_em is not null`), então o custo no
-- insert de mensagem é desprezível. security definer: quem envia pode não ter
-- UPDATE em conversations pela RLS.
create or replace function private.limpa_selo_rodizio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'out'
     and coalesce(new.automated, false) = false
     and coalesce(new.internal, false) = false
     and new.type <> 'event' then
    update public.conversations
       set devolvida_em = null
     where id = new.conversation_id
       and devolvida_em is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists limpa_selo_rodizio on public.messages;
create trigger limpa_selo_rodizio
  after insert on public.messages
  for each row execute function private.limpa_selo_rodizio();
