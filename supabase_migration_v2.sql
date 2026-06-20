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

-- Hinweis: Storage-Bucket 'docs' muss existieren (public) – für PDFs & Bilder.
