-- ============================================================
-- Lito CRM — Painel: o painel PESSOAL volta a ser pessoal
--
-- Bug relatado: um administrador abria o Painel de controle, tirava um widget
-- e recebia "sem permissão para editar este painel" — como se não fosse admin.
--
-- Causa: a policy de leitura da 0037 dava ao admin TODOS os painéis da empresa,
-- inclusive os de escopo `user` (pessoais) de outras pessoas. A tela escolhe o
-- painel padrão pegando o primeiro `scope='user'` marcado como padrão — e esse
-- primeiro era o pessoal de OUTRO usuário. Editar então batia na policy de
-- UPDATE, que (certíssima) exige `user_id = auth.uid()` para escopo `user`.
-- O erro não era de permissão de admin: era o painel errado na tela.
--
-- Isso também contradizia o que a própria 0037 escreveu: "user — pessoal; só o
-- dono lê e edita". Admin precisa enxergar os painéis de DEPARTAMENTO (é ele
-- quem os monta), nunca o painel pessoal dos colegas.
--
-- Efeito colateral do mesmo vazamento, corrigido junto no client: ao criar o
-- primeiro painel, o `is_default` era calculado com "já existe algum painel de
-- escopo user?" — e existia, o dos outros. O painel novo nascia sem ser padrão
-- e a pessoa voltava ao layout de fábrica no F5 seguinte.
--
-- Só a policy de SELECT muda. INSERT/UPDATE/DELETE da 0037 continuam como
-- estão: já exigem dono para `user` e admin para `department`.
--
-- Idempotente.
-- ============================================================

drop policy if exists "leitura de paineis" on public.dashboard_views;
create policy "leitura de paineis" on public.dashboard_views
  for select to authenticated
  using (
    location_id in (select private.user_locations())
    and (
      -- o meu painel pessoal
      user_id = (select auth.uid())
      or (
        scope = 'department'
        and (
          -- painel do meu departamento
          department_id in (select private.user_department_ids())
          -- admin vê (e edita) todos os painéis de departamento
          or private.is_admin(location_id)
        )
      )
    )
  );
