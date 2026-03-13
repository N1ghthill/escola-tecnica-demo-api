-- Extend funnel event types with generic marketing page views.

alter table if exists public.funnel_visits
  drop constraint if exists funnel_visits_event_type_check;

alter table if exists public.funnel_visits
  add constraint funnel_visits_event_type_check
  check (event_type in ('matricula_page_view', 'marketing_page_view', 'whatsapp_handoff', 'whatsapp_icon_click'));
