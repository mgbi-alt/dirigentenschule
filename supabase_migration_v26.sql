-- ============================================================
--  Migration v26 – Bemerkung zu Pruefung/Test (z.B. "Zwischenpruefung", "Abschlusspruefung")
--  Nach v25 im Supabase SQL-Editor ausfuehren.
-- ============================================================
alter table timetable add column if not exists pruefung_notiz text;
