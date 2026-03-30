-- ============================================
-- STEP CHALLENGE v2 - PIN-koodiga autentimine
-- Kopeeri see Supabase SQL Editorisse ja vajuta "Run"
-- ============================================

-- KUI sul on juba vanad tabelid olemas, kustuta need enne:
-- drop table if exists step_entries;
-- drop table if exists participants;

-- 1. Osalejate tabel (PIN hash lisatud)
create table participants (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  name_lower text not null unique,
  pin_hash text not null,
  created_at timestamptz default now()
);

-- 2. Sammude tabel
create table step_entries (
  id uuid default gen_random_uuid() primary key,
  participant_id uuid references participants(id) on delete cascade,
  day_index int not null check (day_index >= 0 and day_index < 14),
  steps int not null check (steps > 0 and steps <= 200000),
  screenshot_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(participant_id, day_index)
);

-- 3. Screenshot piltide bucket (Storage)
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict do nothing;

-- 4. Storage policies
create policy "Anyone can upload screenshots"
on storage.objects for insert
with check (bucket_id = 'screenshots');

create policy "Anyone can view screenshots"
on storage.objects for select
using (bucket_id = 'screenshots');

-- 5. RLS
alter table participants enable row level security;
alter table step_entries enable row level security;

create policy "Anyone can read participants"
on participants for select using (true);

create policy "Anyone can insert participants"
on participants for insert with check (true);

create policy "Anyone can read entries"
on step_entries for select using (true);

create policy "Anyone can insert entries"
on step_entries for insert with check (true);

create policy "Anyone can update entries"
on step_entries for update using (true);

create policy "Anyone can delete entries"
on step_entries for delete using (true);

-- 6. Funktsioon PIN-i verifitseerimiseks (serveripoolne)
create or replace function verify_pin(p_name_lower text, p_pin_hash text)
returns uuid as $$
  select id from participants
  where name_lower = p_name_lower and pin_hash = p_pin_hash;
$$ language sql security definer;
