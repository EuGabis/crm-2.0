-- ============================================================
-- Lito CRM — Tarefas: lembrete dentro do CRM
--
-- Mesma ideia da 0042 (lembrete de compromisso), agora para tarefa: quantos
-- minutos antes do PRAZO o CRM deve avisar quem estiver com a plataforma
-- aberta. `null` = sem lembrete, que é o default — nenhuma tarefa existente
-- passa a avisar do nada.
--
-- Guardado na tarefa, e não numa preferência do usuário: o aviso é DAQUELA
-- tarefa. "Avisar 1 dia antes" faz sentido para preparar uma proposta e é ruído
-- para um retorno de telefone.
--
-- Só o "já avisei" fica fora do banco (localStorage), pelo mesmo motivo da
-- 0042: é estado de tela, por dispositivo.
--
-- Sem policy nova: `tasks` já tem RLS de membership desde a 0002 e a coluna
-- entra na mesma linha.
--
-- Idempotente.
-- ============================================================

alter table public.tasks
  add column if not exists reminder_minutes int;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_reminder_minutes_check'
  ) then
    -- Teto de 7 dias, igual ao dos compromissos: acima disso o aviso deixa de
    -- ser lembrete e vira ruído de semanas antes.
    alter table public.tasks
      add constraint tasks_reminder_minutes_check
      check (reminder_minutes is null or (reminder_minutes >= 0 and reminder_minutes <= 10080));
  end if;
end;
$$;

-- Varredura do lembrete: "tarefas pendentes com prazo e lembrete". Parcial —
-- a maioria das tarefas não terá lembrete.
create index if not exists tasks_reminder_idx
  on public.tasks (location_id, due_at)
  where reminder_minutes is not null and status = 'pending';
