-- ============================================================
--  Dirigentenschule – Seed: Personen
--  Nach supabase_schema.sql ausführen.
--  E-Mail / Telefon / Gemeinde / Bild später im Kontakte-Tab pflegen.
--  legacy_id = alte Fabrik-User-ID, nötig für den CSV-Import.
-- ============================================================
insert into people (legacy_id, nachname, vorname, rolle, sort) values
  (245, 'Bergen',     'Jan-Philipp', 'schueler', 10),
  (253, 'Braun',      'Lisandro',    'schueler', 20),
  (263, 'Derksen',    'Harold',      'schueler', 30),
  (258, 'Falk',       'Bernd',       'schueler', 40),
  (259, 'Giesbrecht', 'Peter',       'schueler', 50),
  (242, 'Heinrich',   'Tobias',      'schueler', 60),
  (257, 'Hooge',      'Thomas',      'schueler', 70),
  (230, 'Ketschik',   'Paul',        'schueler', 80),
  (239, 'Klassen',    'Tobias',      'schueler', 90),
  (262, 'Klaus',      'Lukas',       'schueler', 100),
  (240, 'Pauls',      'Johannes',    'schueler', 110),
  (198, 'Peters',     'David',       'schueler', 120),
  (261, 'Petkau',     'Simon',       'schueler', 130),
  (232, 'Siemens',    'Jonas',       'schueler', 140),
  (260, 'Töws',       'Thomas',      'schueler', 150)
on conflict (legacy_id) do nothing;
