create extension if not exists "pgcrypto";

create table if not exists public.measurement_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'New' check (status in ('New', 'Reviewed', 'Confirmed')),
  profile jsonb not null,
  photos jsonb not null default '{}'::jsonb,
  detected_landmarks jsonb not null default '{}'::jsonb,
  estimated_measurements jsonb not null,
  final_measurements jsonb not null,
  scan_metadata jsonb not null default '{}'::jsonb,
  pose_metadata jsonb not null default '{}'::jsonb
);

create index if not exists measurement_submissions_created_at_idx
  on public.measurement_submissions (created_at desc);

create index if not exists measurement_submissions_status_idx
  on public.measurement_submissions (status);

alter table public.measurement_submissions
  add column if not exists detected_landmarks jsonb not null default '{}'::jsonb,
  add column if not exists scan_metadata jsonb not null default '{}'::jsonb;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists measurement_submissions_set_updated_at on public.measurement_submissions;
create trigger measurement_submissions_set_updated_at
before update on public.measurement_submissions
for each row execute function public.set_updated_at();

alter table public.measurement_submissions enable row level security;

drop policy if exists "Public can create measurement submissions" on public.measurement_submissions;
create policy "Public can create measurement submissions"
on public.measurement_submissions
for insert
to anon
with check (true);

drop policy if exists "Public can read measurement submissions" on public.measurement_submissions;
create policy "Public can read measurement submissions"
on public.measurement_submissions
for select
to anon
using (true);

drop policy if exists "Public can update measurement submissions" on public.measurement_submissions;
create policy "Public can update measurement submissions"
on public.measurement_submissions
for update
to anon
using (true)
with check (true);

insert into storage.buckets (id, name, public)
values ('measurement-photos', 'measurement-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "Public photo uploads" on storage.objects;
create policy "Public photo uploads"
on storage.objects
for insert
to anon
with check (bucket_id = 'measurement-photos');

drop policy if exists "Public photo reads" on storage.objects;
create policy "Public photo reads"
on storage.objects
for select
to anon
using (bucket_id = 'measurement-photos');

drop policy if exists "Public photo updates" on storage.objects;
create policy "Public photo updates"
on storage.objects
for update
to anon
using (bucket_id = 'measurement-photos')
with check (bucket_id = 'measurement-photos');
