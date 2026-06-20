-- ============================================================
--  Migration v2 – Rechte, Info-Tab (Plaene)
--  Einmal im Supabase SQL-Editor ausführen (idempotent).
-- ============================================================

-- Lehrer-Rechte (falls noch nicht vorhanden)
alter table people add column if not exists permissions jsonb default '{}'::jsonb;

-- Stundenplan/Terminplan (PDFs)
create table if not exists site_docs (
  key        text primary key,         -- 'stundenplan_fr' | 'stundenplan_sa' | 'terminplan'
  url        text,
  updated_at timestamptz default now()
);
alter table site_docs enable row level security;
drop policy if exists site_docs_read  on site_docs;
drop policy if exists site_docs_write on site_docs;
create policy site_docs_read  on site_docs for select using (true);
create policy site_docs_write on site_docs for all to authenticated using (true) with check (true);

-- ---------- STORAGE-POLICIES für Bucket 'docs' ----------
-- "Public bucket" erlaubt nur Lesen; Hochladen/Ändern braucht diese Policies.
-- Bucket 'docs' vorher im Dashboard anlegen (Storage → New bucket, Public).
drop policy if exists "docs_read"   on storage.objects;
drop policy if exists "docs_insert" on storage.objects;
drop policy if exists "docs_update" on storage.objects;
drop policy if exists "docs_delete" on storage.objects;
create policy "docs_read"   on storage.objects for select
  using (bucket_id = 'docs');
create policy "docs_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'docs');
create policy "docs_update" on storage.objects for update to authenticated
  using (bucket_id = 'docs') with check (bucket_id = 'docs');
create policy "docs_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'docs');
