-- ============================================================
--  Migration v21 – Bewertungsspalten für Gehörbildung anlegen
--  Nach v20 ausführen (idempotent).
--  Fügt die Komponentenspalten hinzu (Fleiß, Tests, Prüfungen) und
--  ordnet Gesamt/Note dahinter ein. Gewichte = Prozentanteile (Summe 100),
--  in der Oberfläche unter „Spalten bearbeiten" änderbar.
--    Fleiß (Übezeiten) 40 · Tests 10 · ZP praktisch 10 · ZP schriftlich 10
--    · AP praktisch 15 · AP schriftlich 15  = 100
-- ============================================================
insert into grade_columns(fach,label,typ,gewicht,art,sort)
select 'gehoerbildung', x.label, x.typ, x.gewicht, 'zahl', x.sort from (values
  ('Hausaufgaben (Fleiß)',           'fleiss', 40, 1),
  ('Tests',                          'tests',  10, 2),
  ('Zwischenprüfung (praktisch)',    'manual', 10, 3),
  ('Zwischenprüfung (schriftlich)',  'manual', 10, 4),
  ('Abschlussprüfung (praktisch)',   'manual', 15, 5),
  ('Abschlussprüfung (schriftlich)', 'manual', 15, 6)
) x(label,typ,gewicht,sort)
where not exists (select 1 from grade_columns g where g.fach='gehoerbildung' and g.label=x.label);

-- Gesamt/Note ans Ende sortieren
update grade_columns set sort=7 where fach='gehoerbildung' and label='Gesamt';
update grade_columns set sort=8 where fach='gehoerbildung' and label='Note';
