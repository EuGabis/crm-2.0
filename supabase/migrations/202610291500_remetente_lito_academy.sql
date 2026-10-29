-- Troca o remetente padrão das campanhas de e-mail de "Lito CRM" para
-- "Lito Academy". A campanha nunca teve campo de remetente editável na tela
-- (ver `campaign-composer.tsx`): `email_campaigns.from_email` nasce com o
-- DEFAULT da coluna, hardcoded desde a 0010. É por isso que toda campanha
-- saía como "Lito CRM <nao-responder@...>" mesmo a marca de e-mail
-- (`emailBrand.name`, em `src/lib/config/brand.ts`) já sendo diferente
-- ("Lito Aviation Academy") — as transacionais (convite) usam `emailBrand`
-- via `senderAddress()`, as campanhas usavam este literal, sozinho,
-- divergindo da marca em uso nas outras.
--
-- O "L" na lista do Resend (print do Gabriel) é só o ícone-avatar que o
-- PRÓPRIO Resend desenha a partir da primeira letra do nome do remetente —
-- não é nada gravado pelo CRM, e "Lito Academy" continua começando com L.

alter table public.email_campaigns
  alter column from_email set default 'Lito Academy <nao-responder@news.litoaviation.com>';

-- Campanhas que AINDA NÃO SAÍRAM herdam o nome novo. Campanha já enviada ou
-- em envio não é tocada: o remetente dela é histórico, e mudar não altera
-- nada no que já chegou ao destinatário — só confundiria quem comparasse a
-- tela com o e-mail recebido.
update public.email_campaigns
   set from_email = 'Lito Academy <nao-responder@news.litoaviation.com>',
       updated_at = now()
 where from_email = 'Lito CRM <nao-responder@news.litoaviation.com>'
   and status in ('draft', 'scheduled', 'paused');
