-- Avisos do linter do Supabase (2026-11-05).
--
-- 1) Três funções `security definer` executáveis SEM LOGIN (anon):
--    get_conversation, log_conversation_event e sector_conversations().
--    Hoje NÃO vazam: as três conferem a empresa de quem chama
--    (private.user_locations / auth.uid), e para anon isso é vazio. Mas é rede
--    única — a próxima mudança que esquecer a checagem abriria tudo. O par
--    revoke/grant fecha a porta de vez (ver 0080: create function concede a
--    PUBLIC, e este projeto ainda concede a anon por default privileges).
--
-- 2) clear_presence(): gravava last_seen_at = NULL, e NULL significa "nunca
--    acessou" e tira a pessoa do rodízio (defeito de 09/09). O app parou de
--    chamar, mas a função seguia chamável por qualquer autenticado. Fica no
--    banco, sem EXECUTE para ninguém de fora.
--
-- 3) Policy "quem finalizou le" (conversations) chamava auth.uid() POR LINHA.
--    Com (select auth.uid()) o Postgres avalia uma vez por consulta. Ela roda em
--    toda leitura de conversations sob a RLS.
--    ⚠️ ALTER POLICY pede trava exclusiva na tabela: aplicar FORA DO PICO. O
--    bloco tenta com lock_timeout curto e desiste em vez de enfileirar atrás
--    dos leitores (foi isso que gerou deadlock no incidente de 23/09).
--
-- 4) search_path fixo em duas funções que não tinham (aviso de segurança).
--
-- Nenhum código do app muda.

revoke execute on function public.get_conversation(uuid) from public, anon;
revoke execute on function public.log_conversation_event(uuid, text) from public, anon;
revoke execute on function public.sector_conversations() from public, anon;
grant execute on function public.get_conversation(uuid) to authenticated;
grant execute on function public.log_conversation_event(uuid, text) to authenticated;
grant execute on function public.sector_conversations() to authenticated;

revoke execute on function public.clear_presence() from public, anon, authenticated;

alter function private.presenca_janela() set search_path = '';
alter function private.marca_conversa_atualizada() set search_path = '';

do $$
declare tentativa int := 0;
begin
  loop
    begin
      set local lock_timeout = '3s';
      alter policy "quem finalizou le" on public.conversations
        using ((closed_by = (select auth.uid()))
               and (location_id in (select private.user_locations())));
      exit;
    exception when lock_not_available or deadlock_detected then
      tentativa := tentativa + 1;
      if tentativa >= 5 then
        raise warning 'policy "quem finalizou le" NÃO alterada: tabela ocupada. Reaplique fora do pico.';
        exit;
      end if;
      perform pg_sleep(2);
    end;
  end loop;
end $$;
