-- ============================================================
--  Migration v22 – SICHERHEIT: pfadbasierte Storage-Rechte + Ankündigungen/Pläne
--                  nur für eingeloggte Nutzer lesbar
--  Nach v21 im Supabase SQL-Editor ausführen. Setzt v13 (is_admin(), has_perm(),
--  my_person_id()) voraus.
--
--  Vorher: jeder eingeloggte Nutzer (authenticated) durfte JEDE Datei im Bucket
--  'docs' hochladen/überschreiben/löschen, unabhängig vom Pfad – ein Schüler
--  hätte z.B. den Avatar eines anderen oder den Stundenplan-PDF überschreiben
--  können. Jetzt gilt pro Pfad-Präfix eine eigene Regel.
-- ============================================================

drop policy if exists "docs_insert" on storage.objects;
drop policy if exists "docs_update" on storage.objects;
drop policy if exists "docs_delete" on storage.objects;

-- Avatare (avatars/<person_id>.<ext>): nur die eigene Person oder Admin.
-- js/app.js übergibt beim Hochladen die Person-ID als Dateiname (uploadFile(file,'avatars',p.id)).
create policy "docs_avatars_write" on storage.objects for insert to authenticated
  with check (bucket_id='docs' and name like 'avatars/%'
    and (is_admin() or name like 'avatars/'||my_person_id()::text||'.%'));
create policy "docs_avatars_update" on storage.objects for update to authenticated
  using (bucket_id='docs' and name like 'avatars/%'
    and (is_admin() or name like 'avatars/'||my_person_id()::text||'.%'))
  with check (bucket_id='docs' and name like 'avatars/%'
    and (is_admin() or name like 'avatars/'||my_person_id()::text||'.%'));
create policy "docs_avatars_delete" on storage.objects for delete to authenticated
  using (bucket_id='docs' and name like 'avatars/%'
    and (is_admin() or name like 'avatars/'||my_person_id()::text||'.%'));

-- Stundenplan-PDFs (plaene/): nur Admin (entspricht der UI-Sperre #infoUploadLbl).
create policy "docs_plaene_write" on storage.objects for insert to authenticated
  with check (bucket_id='docs' and name like 'plaene/%' and is_admin());
create policy "docs_plaene_update" on storage.objects for update to authenticated
  using (bucket_id='docs' and name like 'plaene/%' and is_admin())
  with check (bucket_id='docs' and name like 'plaene/%' and is_admin());
create policy "docs_plaene_delete" on storage.objects for delete to authenticated
  using (bucket_id='docs' and name like 'plaene/%' and is_admin());

-- Bilder/PDFs in Ankündigungen (info-bilder/, info-pdfs/): wer Infos bearbeiten darf.
create policy "docs_info_write" on storage.objects for insert to authenticated
  with check (bucket_id='docs' and (name like 'info-bilder/%' or name like 'info-pdfs/%') and has_perm('infos'));
create policy "docs_info_update" on storage.objects for update to authenticated
  using (bucket_id='docs' and (name like 'info-bilder/%' or name like 'info-pdfs/%') and has_perm('infos'))
  with check (bucket_id='docs' and (name like 'info-bilder/%' or name like 'info-pdfs/%') and has_perm('infos'));
create policy "docs_info_delete" on storage.objects for delete to authenticated
  using (bucket_id='docs' and (name like 'info-bilder/%' or name like 'info-pdfs/%') and has_perm('infos'));

-- Ankündigungen & Pläne (Tabellen, nicht Storage): vorher für jeden ohne Login
-- lesbar (using(true)), jetzt nur für eingeloggte Nutzer.
drop policy if exists ann_select on announcements;
create policy ann_select on announcements for select to authenticated using (true);

drop policy if exists sd_select on site_docs;
create policy sd_select on site_docs for select to authenticated using (true);
