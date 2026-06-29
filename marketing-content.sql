-- Marketing Content Calendar table. Run once in Supabase -> SQL Editor.
-- Marketing tasks reuse the existing `tasks` table (department = 'Marketing'),
-- so no SQL is needed for them. This table is only for content-calendar items.

create table if not exists public.marketing_content (
  id text primary key,
  date date,
  brand text,
  platform text,
  title text,
  content_type text,
  owner text,
  status text default 'Idea',
  notes text,
  file_name text,
  file_url text,
  file_note text,
  post_link text,
  due_date date,
  due_time text,
  publish_date date,
  publish_time text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists marketing_content_lookup
  on public.marketing_content (publish_date, status, platform);

alter table public.marketing_content enable row level security;
drop policy if exists "mc read"   on public.marketing_content;
drop policy if exists "mc write"  on public.marketing_content;
drop policy if exists "mc update" on public.marketing_content;
drop policy if exists "mc delete" on public.marketing_content;
create policy "mc read"   on public.marketing_content for select using (true);
create policy "mc write"  on public.marketing_content for insert with check (true);
create policy "mc update" on public.marketing_content for update using (true) with check (true);
create policy "mc delete" on public.marketing_content for delete using (true);
