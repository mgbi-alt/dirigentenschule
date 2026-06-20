-- ============================================================
--  Migration v5 – Mehrfach-Rollen pro Person
--  Rollen: schueler | lehrer | klassenleitung | admin
--  Idempotent im SQL-Editor ausführen.
-- ============================================================
alter table people add column if not exists roles text[];

-- bestehende Einzel-Rolle in das Array übernehmen
update people set roles = array[rolle] where (roles is null or array_length(roles,1) is null) and rolle is not null;
update people set roles = array['schueler'] where roles is null or array_length(roles,1) is null;
