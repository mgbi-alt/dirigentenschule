-- ============================================================
--  Migration v32 – Aufgabenstellung als PDF je Hauspruefung
--  Nach v31 im Supabase SQL-Editor ausfuehren.
--
--  Lehrer mit dem Recht "pruefungen" (und Admins) laden zu jeder Pruefung zu Hause
--  die Aufgabenstellung als PDF hoch. Schueler koennen sie ab Beginn der
--  Bearbeitungszeit abrufen (serverseitig erzwungen, nicht nur in der Oberflaeche).
--
--  Ablage im privaten Bucket "abgaben" unter  aufgaben/<exam_id>.pdf
-- ============================================================
alter table home_exams add column if not exists aufgabe_path text;
alter table home_exams add column if not exists aufgabe_filename text;

-- Aufgabenstellungen: lesen duerfen Admins/Lehrer/Klassenleitung immer, alle anderen
-- erst ab dem Tag, an dem die Bearbeitungszeit der Pruefung beginnt.
drop policy if exists "aufgaben_select" on storage.objects;
create policy "aufgaben_select" on storage.objects for select to authenticated
  using (bucket_id = 'abgaben' and name like 'aufgaben/%'
    and (is_staff()
         or exists (select 1 from home_exams e
                     where name = 'aufgaben/' || e.id::text || '.pdf'
                       and e.bearbeitung_von <= (now() at time zone 'Europe/Berlin')::date)));

-- hochladen/ersetzen: wer Pruefungen verwalten darf (Loeschen deckt "abgaben_delete" aus v31 ab)
drop policy if exists "aufgaben_insert" on storage.objects;
drop policy if exists "aufgaben_update" on storage.objects;
create policy "aufgaben_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'abgaben' and name like 'aufgaben/%' and has_perm('pruefungen'));
create policy "aufgaben_update" on storage.objects for update to authenticated
  using (bucket_id = 'abgaben' and name like 'aufgaben/%' and has_perm('pruefungen'))
  with check (bucket_id = 'abgaben' and name like 'aufgaben/%' and has_perm('pruefungen'));

-- Die Abgabe-Regeln aus v31 duerfen den Ordner aufgaben/ nicht mitbeschreiben
-- (sonst koennte ein Schueler dort eine Datei mit seiner eigenen ID ablegen).
drop policy if exists "abgaben_insert" on storage.objects;
drop policy if exists "abgaben_update" on storage.objects;
create policy "abgaben_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'abgaben' and name not like 'aufgaben/%'
    and (is_admin() or name like '%/' || my_person_id()::text || '.pdf'));
create policy "abgaben_update" on storage.objects for update to authenticated
  using (bucket_id = 'abgaben' and name not like 'aufgaben/%'
    and (is_admin() or name like '%/' || my_person_id()::text || '.pdf'))
  with check (bucket_id = 'abgaben' and name not like 'aufgaben/%'
    and (is_admin() or name like '%/' || my_person_id()::text || '.pdf'));
