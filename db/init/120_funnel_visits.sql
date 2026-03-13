-- Capture page visits for pre-enrollment funnel dashboard.

create table if not exists public.funnel_visits (
  id uuid primary key default gen_random_uuid(),
  client_event_id text not null unique,
  event_type text not null default 'matricula_page_view',
  session_id text,
  page_path text,
  source_url text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.funnel_visits
  drop constraint if exists funnel_visits_event_type_check;

alter table public.funnel_visits
  add constraint funnel_visits_event_type_check
  check (event_type in ('matricula_page_view'));

create index if not exists funnel_visits_created_at_idx on public.funnel_visits(created_at);
create index if not exists funnel_visits_event_type_idx on public.funnel_visits(event_type);
create index if not exists funnel_visits_session_id_idx on public.funnel_visits(session_id);
