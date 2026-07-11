-- ============================================================
--  Migration v23 – Zuletzt-online-Anzeige (Admin) + Abmeldung je Tag (Fr/Sa/beide)
--  Nach v22 im Supabase SQL-Editor ausführen.
-- ============================================================

-- ---------- Zuletzt online ----------
-- auth.users ist ueber die normale REST-API nicht abfragbar; diese Funktion gibt
-- (nur fuer Admins, sonst leer) fuer jede Person den letzten Login-Zeitpunkt zurueck.
create or replace function admin_last_logins()
returns table(person_id uuid, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, u.last_sign_in_at
  from people p
  left join auth.users u on u.id = p.auth_id
  where is_admin();
$$;
grant execute on function admin_last_logins() to authenticated;

-- ---------- Abmeldung je Tag ----------
-- 'fr' = nur Freitag, 'sa' = nur Samstag, 'fr_sa' = beide Tage (Standard, wie bisher).
alter table absences add column if not exists tage text not null default 'fr_sa';
alter table absences drop constraint if exists absences_tage_check;
alter table absences add constraint absences_tage_check check (tage in ('fr','sa','fr_sa'));
