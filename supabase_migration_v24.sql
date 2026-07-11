-- ============================================================
--  Migration v24 – Kalender (Termine) + Prüfungs-Kennzeichnung im Stundenplan
--  Nach v23 im Supabase SQL-Editor ausführen.
-- ============================================================

-- ---------- Termine (Kalender) ----------
create table if not exists termine (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  datum date not null,
  uhrzeit time,
  bis_datum date,
  bis_uhrzeit time,
  ort text,
  beschreibung text,
  kategorie text not null default 'sonstiges',
  created_at timestamptz not null default now()
);
create index if not exists termine_datum_idx on termine(datum);

alter table termine enable row level security;
drop policy if exists termine_select on termine;
drop policy if exists termine_write on termine;
create policy termine_select on termine for select to authenticated using (true);
create policy termine_write  on termine for all to authenticated using (has_perm('kalender')) with check (has_perm('kalender'));

-- ---------- Prüfungs-Kennzeichnung ----------
alter table timetable add column if not exists pruefung boolean not null default false;
