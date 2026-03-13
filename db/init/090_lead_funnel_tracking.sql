-- Lead funnel tracking and attribution fields.
-- Keeps backward compatibility with existing runtime by using IF NOT EXISTS.

alter table if exists public.lead_enrollments
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text,
  add column if not exists first_checkout_at timestamptz,
  add column if not exists first_contact_at timestamptz,
  add column if not exists contact_channel text,
  add column if not exists contact_owner text;

create index if not exists lead_enrollments_utm_source_idx
  on public.lead_enrollments(utm_source);

create index if not exists lead_enrollments_utm_campaign_idx
  on public.lead_enrollments(utm_campaign);

create index if not exists lead_enrollments_first_checkout_at_idx
  on public.lead_enrollments(first_checkout_at);

create index if not exists lead_enrollments_first_contact_at_idx
  on public.lead_enrollments(first_contact_at);

alter table public.lead_enrollments
  drop constraint if exists lead_enrollments_contact_channel_check;

alter table public.lead_enrollments
  add constraint lead_enrollments_contact_channel_check
  check (
    contact_channel is null
    or contact_channel in ('whatsapp', 'phone', 'email', 'other')
  );
