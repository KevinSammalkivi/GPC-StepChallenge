-- ============================================================
-- STEP CHALLENGE v3 — 21 päeva + boonussüsteem
-- 7. september – 27. september 2026
--
-- ⚠️  HOIATUS: see skript KUSTUTAB kõik senised osalejad,
--     sammud ja PIN-koodid. Struktuur ehitatakse uuesti üles.
--     Jooksuta Supabase → SQL Editor → Run.
--
-- NB! See kustutab andmebaasi read, AGA MITTE pilte Storage'ist.
--     Vanad pildid tuleb eraldi ära koristada:
--     Supabase → Storage → screenshots → vali kõik → Delete
-- ============================================================

-- ─── 1. VANA KRAAM MAHA ─────────────────────────────────────
drop function if exists verify_pin(text, text);
drop table if exists step_entries cascade;
drop table if exists participants cascade;

-- ─── 2. OSALEJAD ────────────────────────────────────────────
create table participants (
  id uuid default gen_random_uuid() primary key,
  name text not null unique,
  name_lower text not null unique,
  pin_hash text not null,
  created_at timestamptz default now()
);

-- ─── 3. SAMMUD + LOODUSBOONUS ───────────────────────────────
-- Streak-boonuseid EI salvestata — need arvutatakse siit välja.
-- Loodusboonus elab samal real: max 1 päevas.
create table step_entries (
  id uuid default gen_random_uuid() primary key,
  participant_id uuid references participants(id) on delete cascade,
  day_index int not null check (day_index >= 0 and day_index < 21),
  steps int not null check (steps > 0 and steps <= 200000),
  screenshot_url text,
  nature_url text,          -- loodusboonuse tõestuspilt
  nature_note text,         -- kus käidi, nt "RMK Kõrvemaa matkarada"
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(participant_id, day_index)
);

create index step_entries_participant_idx on step_entries(participant_id);

-- ─── 4. STORAGE ─────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict (id) do nothing;

-- 5 MB faililagi. Ainult pildid (videod on äpist välja lülitatud),
-- et tasuta plaani 1 GB kvoot vastu ei tuleks.
update storage.buckets
set public = true,
    file_size_limit = 5242880
where id = 'screenshots';

drop policy if exists "Anyone can upload screenshots" on storage.objects;
drop policy if exists "Anyone can view screenshots" on storage.objects;

create policy "Anyone can upload screenshots"
on storage.objects for insert
with check (bucket_id = 'screenshots');

create policy "Anyone can view screenshots"
on storage.objects for select
using (bucket_id = 'screenshots');

-- ─── 5. RLS ─────────────────────────────────────────────────
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

-- ─── 6. PIN VERIFITSEERIMINE ────────────────────────────────
create or replace function verify_pin(p_name_lower text, p_pin_hash text)
returns uuid as $$
  select id from participants
  where name_lower = p_name_lower and pin_hash = p_pin_hash;
$$ language sql security definer;
