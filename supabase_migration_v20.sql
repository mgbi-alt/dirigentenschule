-- ============================================================
--  Migration v20 – Bewertungsspalte "Tests" automatisch berechnen
--  Nach v19 ausführen (idempotent).
--  Die Spalte "Tests" (Musiktheorie/Harmonielehre) zeigt jetzt den
--  Durchschnitt der 5-Minuten-Tests statt eines manuell eingetragenen
--  Werts. typ='tests' wird in der App zu testsAvg(person) aufgelöst
--  und fließt so auch in die Gesamt-Berechnung ein.
--  Der frühere manuelle Wert (grades.werte) wird nicht mehr verwendet.
-- ============================================================
update grade_columns
set typ = 'tests'
where fach = 'harmonielehre' and label = 'Tests';
