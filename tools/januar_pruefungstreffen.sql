-- ============================================================
--  Einmal-Skript: Pruefungstreffen Januar 2027 (Fr 29.01. / Sa 30.01.2027)
--  Im Supabase SQL-Editor ausfuehren. Ersetzt Freitag UND Samstag dieses Treffens.
--  Das Treffen muss vorher in der App angelegt sein (Admin -> Treffen, Fr+Sa).
--
--  Freitag 29.01. - Abschlusspruefungen
--    18:00 - 19:00  Gehoerbildung, zwei Gruppen parallel (Gruppe 1 / Gruppe 2)
--    ab 19:00       Dirigieren + Stimmbildung, 15 Min. je Schueler (Pruefling 1..N)
--  Samstag 30.01. - Reifepruefung Werkanalyse
--    ab 8:00        25 Min. je Schueler (Pruefling 1..N)
--    9:15 - 9:45    Fruehstueckspause
--    12:15 - 12:45  Mittagspause
--    14:00 - 16:00  Orchester- und Chorprobe wie im Grundplan
--
--  Schueler, Lehrer und Raeume bleiben leer und werden in der App eingetragen,
--  sobald Gruppen und Reihenfolge feststehen (Stunde anklicken).
--  N = Anzahl aktiver Schueler, oder fest ueber c_anzahl unten.
--  Erneutes Ausfuehren baut beide Tage frisch auf (Eintraege gehen dann verloren).
-- ============================================================
do $$
declare
  c_anzahl int := null;          -- null = automatisch aus der Personenliste
  c_fr date := date '2027-01-29';
  c_sa date := date '2027-01-30';

  v_plan uuid;
  v_base uuid;
  v_cnt  int;
  v_n    int;
  v_cur  time;
  v_end  time;
  v_zeit text;
  v_alt  int;
  v_neu  int;
  i      int;
begin
  select count(*) into v_cnt from plans
   where coalesce(is_base,false) = false and datum in (c_fr, c_sa);
  if v_cnt <> 1 then
    raise exception 'Treffen am 29./30.01.2027 nicht eindeutig gefunden (% Treffer). Bitte zuerst in der App anlegen (Datum 30.01.2027, Freitag + Samstag). Nichts geaendert.', v_cnt;
  end if;
  select id into v_plan from plans
   where coalesce(is_base,false) = false and datum in (c_fr, c_sa);
  select id into v_base from plans where is_base order by sort limit 1;

  -- Treffen umfasst sicher beide Tage
  update plans set tage = 'fr_sa', datum = c_sa where id = v_plan;

  v_n := coalesce(c_anzahl,
         (select count(*) from people where aktiv and roles @> array['schueler']));
  if v_n < 1 then
    raise exception 'Keine aktiven Schueler gefunden - c_anzahl im Skript setzen. Nichts geaendert.';
  end if;

  select count(*) into v_alt from timetable where plan_id = v_plan;
  delete from timetable where plan_id = v_plan;

  -- ---------- Freitag ----------
  insert into time_slots(label, sort) values ('18:00 - 19:00', 1080) on conflict (label) do nothing;
  insert into timetable (plan_id, tag, zeit, zeit_sort, fach, ueberschrift, sort, pruefung, pruefung_notiz) values
    (v_plan, 'freitag', '18:00 - 19:00', 1080, 'Gehörbildung', 'Gruppe 1', 1, true, 'Abschlussprüfung'),
    (v_plan, 'freitag', '18:00 - 19:00', 1080, 'Gehörbildung', 'Gruppe 2', 2, true, 'Abschlussprüfung');

  v_cur := time '19:00';
  for i in 1..v_n loop
    v_end  := v_cur + interval '15 minutes';
    v_zeit := to_char(v_cur, 'FMHH24:MI') || ' - ' || to_char(v_end, 'FMHH24:MI');
    insert into time_slots(label, sort)
      values (v_zeit, extract(hour from v_cur)::int*60 + extract(minute from v_cur)::int)
      on conflict (label) do nothing;
    insert into timetable (plan_id, tag, zeit, zeit_sort, fach, ueberschrift, sort, pruefung, pruefung_notiz) values
      (v_plan, 'freitag', v_zeit, extract(hour from v_cur)::int*60 + extract(minute from v_cur)::int,
       'Dirigieren & Stimmbildung', 'Prüfling ' || i, 1, true, 'Abschlussprüfung');
    v_cur := v_end;
  end loop;

  -- ---------- Samstag ----------
  insert into time_slots(label, sort) values
    ('9:15 - 9:45', 555), ('12:15 - 12:45', 735)
  on conflict (label) do nothing;
  insert into timetable (plan_id, tag, zeit, zeit_sort, fach, sort) values
    (v_plan, 'samstag', '9:15 - 9:45', 555, 'Pause', 1),
    (v_plan, 'samstag', '12:15 - 12:45', 735, 'Pause', 1);

  v_cur := time '8:00';
  for i in 1..v_n loop
    -- Pruefung nicht in eine Pause hineinlaufen lassen
    if v_cur < time '9:45'  and v_cur + interval '25 minutes' > time '9:15'  then v_cur := time '9:45';  end if;
    if v_cur < time '12:45' and v_cur + interval '25 minutes' > time '12:15' then v_cur := time '12:45'; end if;
    v_end  := v_cur + interval '25 minutes';
    v_zeit := to_char(v_cur, 'FMHH24:MI') || ' - ' || to_char(v_end, 'FMHH24:MI');
    insert into time_slots(label, sort)
      values (v_zeit, extract(hour from v_cur)::int*60 + extract(minute from v_cur)::int)
      on conflict (label) do nothing;
    insert into timetable (plan_id, tag, zeit, zeit_sort, fach, ueberschrift, sort, pruefung, pruefung_notiz) values
      (v_plan, 'samstag', v_zeit, extract(hour from v_cur)::int*60 + extract(minute from v_cur)::int,
       'Werkanalyse', 'Prüfling ' || i, 1, true, 'Reifeprüfung');
    v_cur := v_end;
  end loop;
  if v_cur > time '14:00' then
    raise notice 'Achtung: Die Reifepruefung endet erst um %, also nach Beginn der Chorprobe.', to_char(v_cur, 'FMHH24:MI');
  end if;

  -- Orchester- und Chorprobe aus dem Grundplan uebernehmen (ohne Grundplan-Verknuepfung,
  -- damit der Samstag als eigener Sonderplan gilt und nicht gegen den Grundplan verglichen wird)
  insert into timetable (plan_id, tag, zeit, zeit_sort, fach, ueberschrift,
                         schueler, schueler_ids, lehrer, lehrer_ids, klavier, klavier_ids, raum, sort)
  select v_plan, 'samstag', b.zeit, 840, b.fach, b.ueberschrift,
         b.schueler, b.schueler_ids, b.lehrer, b.lehrer_ids, b.klavier, b.klavier_ids, b.raum, b.sort
    from timetable b
   where b.plan_id = v_base and b.tag = 'samstag' and b.fach in ('Orchesterpraxis','Chorpraxis');
  get diagnostics v_cnt = row_count;
  if v_cnt = 0 then
    insert into timetable (plan_id, tag, zeit, zeit_sort, fach, raum, sort) values
      (v_plan, 'samstag', '14:00 - 16:00', 840, 'Orchesterpraxis', 'Kellersaal', 1),
      (v_plan, 'samstag', '14:00 - 16:00', 840, 'Chorpraxis', 'Kirchensaal', 2);
  end if;

  select count(*) into v_neu from timetable where plan_id = v_plan;
  raise notice 'Pruefungstreffen aufgebaut fuer % Schueler: % alte Zeilen entfernt, % neue angelegt.', v_n, v_alt, v_neu;
end $$;

-- Kontrolle
select t.tag, t.zeit, t.fach, string_agg(coalesce(t.ueberschrift, t.schueler, '-'), ', ' order by t.sort) as eintraege
  from timetable t
  join plans p on p.id = t.plan_id
 where coalesce(p.is_base,false) = false and p.datum in (date '2027-01-29', date '2027-01-30')
 group by t.tag, t.zeit, t.fach, t.zeit_sort
 order by t.tag, t.zeit_sort, t.fach;
