-- ============================================================
--  Migration v28 – ICS-Kalenderabo (Google/Apple Kalender)
--  Nach v27 im Supabase SQL-Editor ausführen.
-- ============================================================

create extension if not exists pgcrypto;

-- Ein-Zeilen-Tabelle: haelt den Token, der die Edge Function "ics-feed"
-- absichert (Kalender-Apps koennen sich nicht per Supabase-Login authentifizieren,
-- daher Schutz ueber Token in der Abo-URL statt RLS/JWT).
create table if not exists ics_feed_token (
  id boolean primary key default true,
  token text not null,
  updated_at timestamptz not null default now(),
  constraint ics_feed_token_single_row check (id)
);

alter table ics_feed_token enable row level security;
drop policy if exists ics_feed_token_select on ics_feed_token;
drop policy if exists ics_feed_token_write on ics_feed_token;
-- Lesen: alle eingeloggten Nutzer (damit jeder sich im Kalender-Tab die Abo-URL
-- anzeigen lassen kann -- die Termine selbst sind ohnehin fuer alle sichtbar).
create policy ics_feed_token_select on ics_feed_token for select to authenticated using (true);
-- Schreiben/Rotieren: nur Admins (bricht bestehende Kalender-Abos aller Nutzer).
create policy ics_feed_token_write on ics_feed_token for all to authenticated using (is_admin()) with check (is_admin());

-- Initialen Token erzeugen, falls noch keiner existiert.
insert into ics_feed_token (id, token)
values (true, encode(gen_random_bytes(24), 'hex'))
on conflict (id) do nothing;
