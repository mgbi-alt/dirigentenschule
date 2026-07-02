-- ============================================================
--  Migration v16 – Spalte „Hausaufgaben" (Musiktheorie) berechnet
--  Nach v15 ausführen (idempotent).
--  Die Gesamtbewertungs-Spalte „Hausaufgaben" wird nicht mehr manuell
--  eingetragen, sondern aus dem Ø der Theorie-Treffen (Hausaufgaben) berechnet.
--  typ='hausaufgaben' wird in der App zu hausaufgabenAvg(person) aufgelöst.
-- ============================================================
update grade_columns
set typ = 'hausaufgaben'
where fach = 'harmonielehre'
  and label = 'Hausaufgaben';
