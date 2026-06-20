-- ============================================================
--  Migration v7 – dynamische Bewertungsspalten + Auto-Wocheneinträge
--  Nach v6 ausführen (idempotent).
-- ============================================================

-- ---------- Dynamische Spalten für die Gesamtbewertung ----------
create table if not exists grade_columns (
  id    uuid primary key default gen_random_uuid(),
  fach  text not null,
  label text not null,
  art   text default 'zahl',          -- 'zahl' (%) | 'text'
  sort  int default 0
);
alter table grade_columns enable row level security;
drop policy if exists gc_read  on grade_columns;
drop policy if exists gc_write on grade_columns;
create policy gc_read  on grade_columns for select to authenticated using (true);
create policy gc_write on grade_columns for all to authenticated using (true) with check (true);

-- Werte pro Person als jsonb (column_id -> Wert)
alter table grades add column if not exists werte jsonb default '{}'::jsonb;

-- Standard-Spalten anlegen (einmalig)
insert into grade_columns(fach,label,art,sort)
select 'harmonielehre', x.label, x.art, x.sort from (values
  ('HA-Überprüfung','zahl',1),('Hausaufgaben','zahl',2),
  ('Klausur 1','zahl',3),('Klausur 2','zahl',4),
  ('Gesamt','zahl',5),('Note','text',6)
) x(label,art,sort)
where not exists (select 1 from grade_columns where fach='harmonielehre');

insert into grade_columns(fach,label,art,sort)
select 'gehoerbildung', x.label, x.art, x.sort from (values
  ('Gesamt','zahl',1),('Note','text',2)
) x(label,art,sort)
where not exists (select 1 from grade_columns where fach='gehoerbildung');

-- Altwerte (feste Spalten) in werte übernehmen
update grades g set werte = coalesce(g.werte,'{}') || jsonb_build_object(c.id::text, to_jsonb(g.ha_ueberpruefung))
from grade_columns c where c.fach='harmonielehre' and c.label='HA-Überprüfung' and g.fach='harmonielehre' and g.ha_ueberpruefung is not null;
update grades g set werte = coalesce(g.werte,'{}') || jsonb_build_object(c.id::text, to_jsonb(g.hausaufgaben))
from grade_columns c where c.fach='harmonielehre' and c.label='Hausaufgaben' and g.fach='harmonielehre' and g.hausaufgaben is not null;
update grades g set werte = coalesce(g.werte,'{}') || jsonb_build_object(c.id::text, to_jsonb(g.klausur1))
from grade_columns c where c.fach='harmonielehre' and c.label='Klausur 1' and g.fach='harmonielehre' and g.klausur1 is not null;
update grades g set werte = coalesce(g.werte,'{}') || jsonb_build_object(c.id::text, to_jsonb(g.klausur2))
from grade_columns c where c.fach='harmonielehre' and c.label='Klausur 2' and g.fach='harmonielehre' and g.klausur2 is not null;
update grades g set werte = coalesce(g.werte,'{}') || jsonb_build_object(c.id::text, to_jsonb(g.gesamt))
from grade_columns c where c.fach='harmonielehre' and c.label='Gesamt' and g.fach='harmonielehre' and g.gesamt is not null;
update grades g set werte = coalesce(g.werte,'{}') || jsonb_build_object(c.id::text, to_jsonb(g.gesamtnote))
from grade_columns c where c.fach='harmonielehre' and c.label='Note' and g.fach='harmonielehre' and g.gesamtnote is not null;

-- ---------- Auto-Wocheneinträge (Praktische Fächer) ----------
-- Legt pro aktivem Schüler eine Zeile für die angegebene KW an (falls noch nicht vorhanden).
create or replace function ensure_practice_week(p_jahr int, p_kw int) returns void
language sql security definer as $$
  insert into practice_times (person_id, jahr, kw)
  select p.id, p_jahr, p_kw from people p
  where p.aktiv and p.roles @> array['schueler']
    and not exists (select 1 from practice_times t where t.person_id=p.id and t.jahr=p_jahr and t.kw=p_kw);
$$;
create or replace function ensure_practice_current() returns void
language sql security definer as $$
  select ensure_practice_week(extract(isoyear from now())::int, extract(week from now())::int);
$$;
grant execute on function ensure_practice_week(int,int) to authenticated;
grant execute on function ensure_practice_current() to authenticated;

-- Automatik jeden Montag 06:00 (benötigt Extension pg_cron – im Dashboard aktivieren):
--   create extension if not exists pg_cron;
--   select cron.schedule('practice-week','0 6 * * 1', $$select ensure_practice_current();$$);
