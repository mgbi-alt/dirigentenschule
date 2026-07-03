-- ============================================================
--  Migration v17 – Hausaufgaben an die allgemeinen Treffen koppeln
--  Nach v16 ausführen.
--  ACHTUNG: entfernt den Kapitel-Import (HK 1..n). Danach orientieren
--  sich die Hausaufgaben-Treffen an den allgemeinen Treffen (plans).
--  Ein theory_meeting gehört über plan_id zu genau einem Treffen und
--  wird in der App bei Bedarf automatisch angelegt.
-- ============================================================

-- 1) Bezug zum allgemeinen Treffen
alter table theory_meetings add column if not exists plan_id uuid references plans(id) on delete cascade;
create unique index if not exists theory_meetings_plan_uidx on theory_meetings(plan_id) where plan_id is not null;

-- 2) Kapitel-Import entfernen (ohne Treffen-Bezug).
--    Cascade löscht zugehörige Aufgaben (theory_tasks) und Status (theory_status).
delete from theory_meetings where plan_id is null;
