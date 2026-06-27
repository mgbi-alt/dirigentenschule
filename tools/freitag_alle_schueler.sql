-- Einmal-Skript: alle Freitags-Stunden (außer Pausen) auf "Alle Schüler" + Raum GBS-OG11.
-- Gilt für ALLE Pläne (Grundplan + Treffen). schueler_ids wird geleert, damit "Alle Schüler" angezeigt wird.
update timetable
set schueler     = 'Alle Schüler',
    schueler_ids = null,
    raum         = 'GBS-OG11'
where tag = 'freitag'
  and fach <> 'Pause';
