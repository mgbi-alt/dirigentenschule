-- ============================================================
--  Migration v19 – Bewertungsspalte umbenennen (Musiktheorie)
--  Nach v18 ausführen (idempotent).
--  'HA-Überprüfung' -> 'Tests' (nur Harmonielehre/Musiktheorie).
--  Die Werte hängen an der Spalten-ID (grades.werte jsonb), das
--  Umbenennen des Labels ändert keine Daten.
-- ============================================================
update grade_columns
set label = 'Tests'
where fach = 'harmonielehre' and label = 'HA-Überprüfung';
