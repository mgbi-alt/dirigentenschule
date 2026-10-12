-- ============================================================
--  Migration v31 – Pruefungen zu Hause (Abgabe als PDF)
--  Nach v30 im Supabase SQL-Editor ausfuehren. Setzt v13 (is_admin(), is_staff(),
--  has_perm(), my_person_id()) voraus.
--
--  Eine "Hausprüfung" hat eine Bearbeitungszeit (von) und einen Abgabetermin (bis).
--  Jeder Schueler kann je Pruefung genau ein PDF abgeben (erneutes Hochladen ersetzt).
--
--  Rechte:
--   * Pruefungen sehen:      alle eingeloggten Nutzer
--   * Pruefungen anlegen:    Admins + Lehrer/Klassenleitung mit Recht "pruefungen"
--                            (Admin -> Personen -> Bearbeitungsrechte)
--   * Abgabe hochladen:      der Schueler selbst (Admin im Namen eines Schuelers)
--   * Abgaben sehen:         der Schueler selbst + Admins/Lehrer/Klassenleitung
--   * PDFs liegen in einem PRIVATEN Bucket ("abgaben"), Abruf nur ueber
--     kurzlebige signierte Links -- nicht oeffentlich wie der Bucket "docs".
-- ============================================================

create table if not exists home_exams (
  id uuid primary key default gen_random_uuid(),
  titel text not null,
  beschreibung text,
  bearbeitung_von date not null,
  abgabe_bis date not null,
  created_at timestamptz not null default now(),
  constraint home_exams_zeitraum check (abgabe_bis >= bearbeitung_von)
);

create table if not exists home_exam_uploads (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references home_exams(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  file_path text not null,
  filename text,
  uploaded_at timestamptz not null default now(),
  constraint home_exam_uploads_unique unique (exam_id, person_id)
);

-- Zeitpunkt der Abgabe serverseitig setzen (nicht vom Client faelschbar).
create or replace function home_exam_upload_stamp() returns trigger
  language plpgsql as $$
begin
  new.uploaded_at := now();
  return new;
end $$;
drop trigger if exists home_exam_upload_stamp_trg on home_exam_uploads;
create trigger home_exam_upload_stamp_trg before insert or update on home_exam_uploads
  for each row execute function home_exam_upload_stamp();

-- ---------- RLS: Tabellen ----------
alter table home_exams enable row level security;
drop policy if exists home_exams_select on home_exams;
drop policy if exists home_exams_write on home_exams;
create policy home_exams_select on home_exams for select to authenticated using (true);
create policy home_exams_write on home_exams for all to authenticated
  using (has_perm('pruefungen')) with check (has_perm('pruefungen'));

alter table home_exam_uploads enable row level security;
drop policy if exists home_exam_uploads_select on home_exam_uploads;
drop policy if exists home_exam_uploads_insert on home_exam_uploads;
drop policy if exists home_exam_uploads_update on home_exam_uploads;
drop policy if exists home_exam_uploads_delete on home_exam_uploads;
create policy home_exam_uploads_select on home_exam_uploads for select to authenticated
  using (is_staff() or person_id = my_person_id());
create policy home_exam_uploads_insert on home_exam_uploads for insert to authenticated
  with check (is_admin() or person_id = my_person_id());
create policy home_exam_uploads_update on home_exam_uploads for update to authenticated
  using (is_admin() or person_id = my_person_id())
  with check (is_admin() or person_id = my_person_id());
create policy home_exam_uploads_delete on home_exam_uploads for delete to authenticated
  using (has_perm('pruefungen'));

grant select, insert, update, delete on home_exams to authenticated;
grant select, insert, update, delete on home_exam_uploads to authenticated;
grant all on home_exams to service_role;
grant all on home_exam_uploads to service_role;

-- ---------- Storage: privater Bucket "abgaben" ----------
-- Pfad: <exam_id>/<person_id>.pdf   (nur PDF, max. 10 MB)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('abgaben', 'abgaben', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

drop policy if exists "abgaben_select" on storage.objects;
drop policy if exists "abgaben_insert" on storage.objects;
drop policy if exists "abgaben_update" on storage.objects;
drop policy if exists "abgaben_delete" on storage.objects;

-- lesen: Admins/Lehrer/Klassenleitung alle, Schueler nur die eigene Datei
create policy "abgaben_select" on storage.objects for select to authenticated
  using (bucket_id = 'abgaben'
    and (is_staff() or name like '%/' || my_person_id()::text || '.pdf'));
-- hochladen/ersetzen: nur die eigene Datei (Admin: jede)
create policy "abgaben_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'abgaben'
    and (is_admin() or name like '%/' || my_person_id()::text || '.pdf'));
create policy "abgaben_update" on storage.objects for update to authenticated
  using (bucket_id = 'abgaben'
    and (is_admin() or name like '%/' || my_person_id()::text || '.pdf'))
  with check (bucket_id = 'abgaben'
    and (is_admin() or name like '%/' || my_person_id()::text || '.pdf'));
-- loeschen (z.B. wenn eine Pruefung entfernt wird): wer Pruefungen verwalten darf
create policy "abgaben_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'abgaben' and has_perm('pruefungen'));
