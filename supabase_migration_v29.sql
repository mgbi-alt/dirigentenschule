-- ============================================================
--  Migration v29 – Chorpraxis-Planung je Treffen
--  Nach v28 im Supabase SQL-Editor ausfuehren.
--
--  Die fuer Chorpraxis verantwortlichen Lehrer hinterlegen je Treffen eine
--  Planung (Rich-Text). Eine Planung pro Treffen.
--
--  Rechte:
--   * lesen:      alle Admins/Lehrer/Klassenleitung (is_staff())
--   * schreiben:  Admins sowie Lehrer/Klassenleitung mit dem Recht "chorpraxis"
--                 (wird in Admin -> Personen -> Bearbeitungsrechte vergeben,
--                  gespeichert in people.permissions ->> 'chorpraxis')
--   * Schueler:   sehen die Planung nicht.
-- ============================================================
create table if not exists chorpraxis_plans (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  text text not null default '',
  updated_by uuid references people(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint chorpraxis_plans_plan_unique unique (plan_id)
);

-- "zuletzt bearbeitet von/am" serverseitig setzen, damit der Client es nicht faelschen kann.
create or replace function chorpraxis_stamp() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := my_person_id();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists chorpraxis_stamp_trg on chorpraxis_plans;
create trigger chorpraxis_stamp_trg before insert or update on chorpraxis_plans
  for each row execute function chorpraxis_stamp();

alter table chorpraxis_plans enable row level security;
drop policy if exists chorpraxis_select on chorpraxis_plans;
drop policy if exists chorpraxis_write on chorpraxis_plans;
create policy chorpraxis_select on chorpraxis_plans for select to authenticated
  using (is_staff() or has_perm('chorpraxis'));
create policy chorpraxis_write on chorpraxis_plans for all to authenticated
  using (has_perm('chorpraxis')) with check (has_perm('chorpraxis'));

-- Neue Tabellen sind laut Supabase-Standard nicht automatisch ueber die API freigegeben.
grant select, insert, update, delete on chorpraxis_plans to authenticated;
grant all on chorpraxis_plans to service_role;

-- Gleiche Freigabe vorsichtshalber fuer die Kalender-Abo-Tabelle aus v28 (nur falls vorhanden).
do $$
begin
  if to_regclass('public.ics_feed_token') is not null then
    execute 'grant select, insert, update, delete on ics_feed_token to authenticated';
    execute 'grant all on ics_feed_token to service_role';
  end if;
end $$;
