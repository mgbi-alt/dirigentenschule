-- ============================================================
--  Migration: Rechteverwaltung pro Lehrer
--  Einmal im Supabase SQL-Editor ausführen.
-- ============================================================
alter table people add column if not exists permissions jsonb default '{}'::jsonb;

-- Beispiel: einem Lehrer das Bearbeiten der Übezeiten erlauben
-- update people set permissions = '{"zeiten":true}'::jsonb where email='lehrer@example.de';
