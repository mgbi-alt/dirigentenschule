-- ============================================================
--  Migration v11 – Treffen, Abmeldungen, Entfall-Flag
--  Nach v10 ausführen (idempotent).
--  Ein "Treffen" = ein Nicht-Grundplan in plans (mit Datum).
-- ============================================================

-- Stunde kann als "entfällt" markiert werden (ohne Löschen)
alter table timetable add column if not exists entfaellt boolean default false;

-- Info kann zu einem Treffen (Plan) gehören
alter table announcements add column if not exists plan_id uuid references plans(id) on delete set null;

-- Abmeldungen pro Treffen (Plan)
create table if not exists absences (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid references plans(id) on delete cascade,
  person_id  uuid references people(id) on delete cascade,
  grund      text,
  created_at timestamptz default now(),
  unique(plan_id, person_id)
);
alter table absences enable row level security;
drop policy if exists abs_read  on absences;
drop policy if exists abs_write on absences;
create policy abs_read  on absences for select to authenticated using (true);
create policy abs_write on absences for all to authenticated using (true) with check (true);
