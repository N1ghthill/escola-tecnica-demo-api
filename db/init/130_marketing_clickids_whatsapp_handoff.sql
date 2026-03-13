-- Marketing attribution hardening for paid traffic:
-- 1) Persist click IDs on leads.
-- 2) Allow WhatsApp handoff events in funnel tracking.

alter table if exists public.lead_enrollments
  add column if not exists click_id_fbclid text,
  add column if not exists click_id_gclid text,
  add column if not exists click_id_wbraid text,
  add column if not exists click_id_gbraid text;

create index if not exists lead_enrollments_click_id_fbclid_idx
  on public.lead_enrollments(click_id_fbclid)
  where click_id_fbclid is not null;

create index if not exists lead_enrollments_click_id_gclid_idx
  on public.lead_enrollments(click_id_gclid)
  where click_id_gclid is not null;

create index if not exists lead_enrollments_click_id_wbraid_idx
  on public.lead_enrollments(click_id_wbraid)
  where click_id_wbraid is not null;

create index if not exists lead_enrollments_click_id_gbraid_idx
  on public.lead_enrollments(click_id_gbraid)
  where click_id_gbraid is not null;

alter table if exists public.funnel_visits
  drop constraint if exists funnel_visits_event_type_check;

alter table if exists public.funnel_visits
  add constraint funnel_visits_event_type_check
  check (event_type in ('matricula_page_view', 'whatsapp_handoff'));
