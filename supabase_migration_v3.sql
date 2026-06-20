-- ============================================================
--  Migration v3 – Stundenplan (editierbar)
--  Einmal im Supabase SQL-Editor ausführen (idempotent).
-- ============================================================
create table if not exists timetable (
  id         uuid primary key default gen_random_uuid(),
  tag        text default 'samstag',     -- für später erweiterbar (freitag/samstag)
  zeit       text,                        -- z.B. '10:00 - 10:45'
  zeit_sort  int default 0,               -- Reihenfolge der Zeitslots
  fach       text,                        -- Dirigieren | Stimmbildung | Klavier | Gehörbildung | Musiktheorie | Arrangieren | Pause | Orchesterpraxis | Chorpraxis
  schueler   text,
  lehrer     text,
  klavier    text,                        -- Klavierbegleitung
  raum       text,
  sort       int default 0,               -- Reihenfolge innerhalb Slot/Fach
  updated_at timestamptz default now()
);
alter table timetable enable row level security;
drop policy if exists timetable_read  on timetable;
drop policy if exists timetable_write on timetable;
create policy timetable_read  on timetable for select to authenticated using (true);
create policy timetable_write on timetable for all to authenticated using (true) with check (true);
