-- Hide courses discontinued from public catalog.

update public.courses
set active = false,
    updated_at = now()
where slug in (
  'teologia',
  'robotica',
  'radiologia',
  'protese-dentaria',
  'agropecuaria',
  'acupuntura'
)
and active is distinct from false;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'course_offers'
  ) then
    update public.course_offers o
    set active = false,
        updated_at = now()
    from public.courses c
    where o.course_id = c.id
      and c.slug in (
        'teologia',
        'robotica',
        'radiologia',
        'protese-dentaria',
        'agropecuaria',
        'acupuntura'
      )
      and o.active is distinct from false;
  end if;
end $$;
