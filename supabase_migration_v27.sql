-- ============================================================
--  Migration v27 – "Aktuell online"-Anzeige (Heartbeat der letzten Aktivitaet)
--  Nach v26 im Supabase SQL-Editor ausfuehren.
--
--  people.last_seen_at wird von jedem eingeloggten Client alle 60s auf "jetzt"
--  gesetzt (nur fuer die eigene Zeile -- RLS people_update erlaubt das bereits:
--  is_admin() or id = my_person_id()). Als "online" gilt, wer in den letzten
--  5 Minuten einen Heartbeat gesendet hat.
-- ============================================================
alter table people add column if not exists last_seen_at timestamptz;
