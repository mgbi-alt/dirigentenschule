-- ============================================================
--  Einmal-Skript: Freitag von Treffen "Z3" umbauen
--  Im Supabase SQL-Editor ausfuehren (aendert nur den Freitag des Treffens Z3).
--
--  Neuer Ablauf (Freitag):
--    17:30 - 18:30  Pruefung Harmonielehre   (Alle Schueler, GBS-OG11)
--    18:30 - 19:00  Pause
--    19:00 - 19:30  Einzelunterricht 1  \
--    19:30 - 20:00  Einzelunterricht 2   | gleiche Reihenfolge/Zuordnung wie die
--    20:00 - 20:30  Einzelunterricht 3   | vier Einzelunterricht-Bloecke am Samstag
--    20:30 - 21:00  Einzelunterricht 4  /  (Grundplan), aber Klavier -> Arrangieren
--    21:00 - 21:45  Formenlehre              (Alle Schueler, GBS-OG11)
--
--  Die Einzelstunden werden aus dem SAMSTAG-GRUNDPLAN der Datenbank kopiert
--  (Schueler, Lehrer, Klavierbegleitung, Raeume), damit keine Daten von Hand
--  uebertragen werden muessen. Block 1..4 am Samstag = Block 1..4 am Freitag.
--
--  Aenderbar: siehe c_arrangieren_wie_klavier unten.
--  Zuruecksetzen (alte Struktur): seed_freitag_rahmen.sql ergaenzt fehlende Rahmen-Zeiten.
-- ============================================================
do $$
declare
  -- false: Arrangieren-Stunden haben (noch) keinen Lehrer/Raum -> spaeter in der App eintragen.
  -- true : Arrangieren uebernimmt Lehrer und Raum der Samstags-Klavierstunde.
  c_arrangieren_wie_klavier boolean := false;

  v_plan  uuid;
  v_base  uuid;
  v_cnt   int;
  v_slots int;
  v_alt   int;
  v_neu   int;
begin
  -- Treffen Z3 und Grundplan finden
  select count(*) into v_cnt from plans where name = 'Z3' and coalesce(is_base,false) = false;
  if v_cnt <> 1 then
    raise exception 'Treffen "Z3" nicht eindeutig gefunden (% Treffer). Abbruch, nichts geaendert.', v_cnt;
  end if;
  select id into v_plan from plans where name = 'Z3' and coalesce(is_base,false) = false;
  select id into v_base from plans where is_base order by sort limit 1;
  if v_base is null then
    raise exception 'Kein Grundplan gefunden. Abbruch, nichts geaendert.';
  end if;

  -- Sicherheitscheck: genau 4 Einzelunterricht-Bloecke am Samstag im Grundplan
  select count(distinct zeit_sort) into v_slots from timetable
   where plan_id = v_base and tag = 'samstag'
     and fach in ('Dirigieren','Stimmbildung','Klavier','Gehörbildung');
  if v_slots <> 4 then
    raise exception 'Im Samstags-Grundplan wurden % statt 4 Einzelunterricht-Bloecke gefunden. Abbruch, nichts geaendert.', v_slots;
  end if;

  -- bisherigen Freitag von Z3 entfernen
  select count(*) into v_alt from timetable where plan_id = v_plan and tag = 'freitag';
  delete from timetable where plan_id = v_plan and tag = 'freitag';

  -- Zeiten ins Zeitraster aufnehmen (Reihenfolge: Pruefung < Pause(22) < Bloecke < Formenlehre)
  insert into time_slots(label, sort) values
    ('17:30 - 18:30', 20),
    ('18:30 - 19:00', 22),
    ('19:00 - 19:30', 31),
    ('19:30 - 20:00', 32),
    ('20:00 - 20:30', 33),
    ('20:30 - 21:00', 34),
    ('21:00 - 21:45', 35)
  on conflict (label) do nothing;

  -- Pruefung, Pause, Formenlehre
  insert into timetable (plan_id, tag, zeit, zeit_sort, fach, schueler, raum, sort, pruefung) values
    (v_plan, 'freitag', '17:30 - 18:30', 20, 'Harmonielehre', 'Alle Schüler', 'GBS-OG11', 1, true);
  insert into timetable (plan_id, tag, zeit, zeit_sort, fach, raum, sort) values
    (v_plan, 'freitag', '18:30 - 19:00', 22, 'Pause', 'GBS-OG11', 1);
  insert into timetable (plan_id, tag, zeit, zeit_sort, fach, schueler, raum, sort) values
    (v_plan, 'freitag', '21:00 - 21:45', 35, 'Formenlehre', 'Alle Schüler', 'GBS-OG11', 1);

  -- Einzelunterricht: Samstags-Bloecke 1..4 -> Freitags-Halbstunden, Klavier -> Arrangieren
  insert into timetable (plan_id, tag, zeit, zeit_sort, fach, ueberschrift,
                         schueler, schueler_ids, lehrer, lehrer_ids,
                         klavier, klavier_ids, raum, sort)
  select v_plan, 'freitag', m.zeit, m.zs,
         case when s.fach = 'Klavier' then 'Arrangieren' else s.fach end,
         s.ueberschrift,
         s.schueler, s.schueler_ids,
         case when s.fach = 'Klavier' and not c_arrangieren_wie_klavier then null else s.lehrer end,
         case when s.fach = 'Klavier' and not c_arrangieren_wie_klavier then null else s.lehrer_ids end,
         s.klavier, s.klavier_ids,
         case when s.fach = 'Klavier' and not c_arrangieren_wie_klavier then null else s.raum end,
         s.sort
    from (select t.*, dense_rank() over (order by t.zeit_sort) as rk
            from timetable t
           where t.plan_id = v_base and t.tag = 'samstag'
             and t.fach in ('Dirigieren','Stimmbildung','Klavier','Gehörbildung')) s
    join (values (1,'19:00 - 19:30',31),
                 (2,'19:30 - 20:00',32),
                 (3,'20:00 - 20:30',33),
                 (4,'20:30 - 21:00',34)) m(rk, zeit, zs)
      on m.rk = s.rk;

  select count(*) into v_neu from timetable where plan_id = v_plan and tag = 'freitag';
  raise notice 'Z3-Freitag umgebaut: % alte Zeilen entfernt, % neue Zeilen angelegt.', v_alt, v_neu;
end $$;

-- Kontrolle: Uebersicht des neuen Z3-Freitags
select t.zeit, t.fach, count(*) as zeilen,
       string_agg(coalesce(t.schueler,'-'), ', ' order by t.sort) as schueler
  from timetable t
  join plans p on p.id = t.plan_id
 where p.name = 'Z3' and coalesce(p.is_base,false) = false and t.tag = 'freitag'
 group by t.zeit, t.fach, t.zeit_sort
 order by t.zeit_sort, t.fach;
