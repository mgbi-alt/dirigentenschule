-- ============================================================
--  Migration v25 – Zusaetzliches Flag "Test" fuer Stundenplan-Eintraege
--  (analog zu "Pruefung", siehe v24). Nach v24 im Supabase SQL-Editor ausfuehren.
-- ============================================================
alter table timetable add column if not exists test boolean not null default false;
