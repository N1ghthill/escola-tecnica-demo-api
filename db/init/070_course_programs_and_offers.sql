-- Refactor: separate course catalog identity from commercial offer (track).
-- Backward compatible: keeps public.courses as source for existing API endpoints.

create table if not exists public.course_programs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  area text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_offers (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null unique references public.courses(id) on delete cascade,
  program_id uuid not null references public.course_programs(id) on delete cascade,
  track text not null,
  active boolean not null default true,
  price_cents int not null,
  modality text default 'EAD',
  workload_hours int,
  duration_months_min int,
  duration_months_max int,
  tcc_required boolean default true,
  requirements jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, track)
);

create index if not exists course_offers_program_id_idx on public.course_offers(program_id);
create index if not exists course_offers_active_track_idx on public.course_offers(active, track);

alter table public.course_offers
  drop constraint if exists course_offers_track_check;

alter table public.course_offers
  add constraint course_offers_track_check
  check (track in ('regular', 'competencia_profissional'));

alter table public.course_offers
  drop constraint if exists course_offers_modality_check;

alter table public.course_offers
  add constraint course_offers_modality_check
  check (modality in ('EAD', 'Presencial', 'Híbrido'));

insert into public.course_programs (slug, name, area)
select c.slug, c.name, c.area
from public.courses c
on conflict (slug) do update set
  name = excluded.name,
  area = excluded.area,
  updated_at = now();

insert into public.course_offers (
  course_id,
  program_id,
  track,
  active,
  price_cents,
  modality,
  workload_hours,
  duration_months_min,
  duration_months_max,
  tcc_required
)
select
  c.id,
  p.id,
  c.track,
  c.active,
  c.price_cents,
  c.modality,
  c.workload_hours,
  c.duration_months_min,
  c.duration_months_max,
  c.tcc_required
from public.courses c
join public.course_programs p on p.slug = c.slug
-- Keep manual program reassignment intact after first backfill.
on conflict (course_id) do update set
  track = excluded.track,
  active = excluded.active,
  price_cents = excluded.price_cents,
  modality = excluded.modality,
  workload_hours = excluded.workload_hours,
  duration_months_min = excluded.duration_months_min,
  duration_months_max = excluded.duration_months_max,
  tcc_required = excluded.tcc_required,
  updated_at = now();

-- Seed known eligibility requirements for offers that need explicit acknowledgements.
update public.course_offers o
set requirements = case
  when c.slug = 'enfermagem' and o.track = 'competencia_profissional' then
    jsonb_build_object(
      'minimum_experience_two_years', true,
      'coren_active_two_years_auxiliar', true,
      'professional_link_proof', true,
      'professional_link_proof_types', jsonb_build_array('ctps', 'contrato_publico')
    )
  when c.slug = 'saude-bucal' and o.track = 'competencia_profissional' then
    jsonb_build_object(
      'minimum_experience_two_years', true
    )
  else o.requirements
end,
updated_at = now()
from public.courses c
where o.course_id = c.id
  and coalesce(o.requirements, '{}'::jsonb) = '{}'::jsonb
  and c.slug in ('enfermagem', 'saude-bucal');
