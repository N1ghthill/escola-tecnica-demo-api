-- Capture abandoned pre-enrollment intents for active outbound follow-up.

create table if not exists public.lead_intents (
  id uuid primary key default gen_random_uuid(),
  client_event_id text not null unique,
  intent_type text not null default 'pre_matricula_nao_concluida',

  course_slug text,
  course_name text,

  customer_name text,
  customer_email text,
  customer_phone text,

  city text,
  state text,
  last_step text not null default 'desconhecido',

  source_url text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,

  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lead_intents_created_at_idx on public.lead_intents(created_at);
create index if not exists lead_intents_course_slug_idx on public.lead_intents(course_slug);
create index if not exists lead_intents_customer_phone_idx on public.lead_intents(customer_phone);
create index if not exists lead_intents_customer_email_idx on public.lead_intents(customer_email);

