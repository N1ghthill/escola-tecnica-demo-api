-- CRM lead funnel statuses for manual enrollment operation.
-- Keeps compatibility by only remapping known legacy checkout statuses.

alter table if exists public.lead_enrollments
  alter column payment_status set default 'novo_lead';

update public.lead_enrollments
set payment_status = 'novo_lead'
where payment_status = 'pending';

update public.lead_enrollments
set payment_status = 'em_atendimento'
where payment_status = 'processing';

update public.lead_enrollments
set payment_status = 'venda_concluida'
where payment_status = 'approved';

update public.lead_enrollments
set payment_status = 'remarketing'
where payment_status in ('declined', 'provider_unavailable');

update public.lead_enrollments
set payment_status = 'aguardando_retorno'
where payment_status = 'pending_authentication';

update public.lead_enrollments
set payment_status = 'novo_lead'
where payment_status is null or btrim(payment_status) = '';
