-- ============================================================
--  Migration v29 – Uhrzeit bei Abmeldungen (optional, Default ganzer Tag)
--  Nach v28 im Supabase SQL-Editor ausführen.
--  von_zeit/bis_zeit: beide leer = ganztägige Abmeldung (bisheriges Verhalten).
--  Nur von_zeit gesetzt = ab dieser Uhrzeit bis Tagesende, nur bis_zeit = ab
--  Tagesbeginn bis zu dieser Uhrzeit, beide gesetzt = genau dieses Zeitfenster.
-- ============================================================
alter table absences add column if not exists von_zeit time;
alter table absences add column if not exists bis_zeit time;
