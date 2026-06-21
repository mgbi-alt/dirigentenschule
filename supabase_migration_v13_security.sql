-- ============================================================
--  Migration v13 – SICHERHEIT: echte Durchsetzung der Rollen/Rechte (RLS)
--  Nach v12 ausführen. Ändert NUR die Datenbank-Policies, nicht die App.
--  Wichtig: zusätzlich im Dashboard die Registrierung deaktivieren
--           (Authentication → Providers → Email → "Allow new users to sign up" = AUS).
-- ============================================================

-- ---------- Hilfsfunktionen (laufen als Owner, umgehen RLS -> keine Rekursion) ----------
create or replace function my_person_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select id from people
  where auth_id = auth.uid()
     or (auth_id is null and email is not null and lower(email) = lower(auth.jwt() ->> 'email'))
  limit 1;
$$;

create or replace function my_roles() returns text[]
  language sql stable security definer set search_path = public as $$
  select coalesce(roles, case when rolle is not null then array[rolle] else '{}'::text[] end)
  from people where id = my_person_id();
$$;

create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce('admin' = any(my_roles()), false);
$$;

create or replace function is_staff() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(array['admin','lehrer','klassenleitung'] && my_roles(), false);
$$;

create or replace function has_perm(area text) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    when is_admin() then true
    when array['lehrer','klassenleitung'] && my_roles()
      then coalesce((select (permissions ->> area) = 'true' from people where id = my_person_id()), false)
    else false end;
$$;

grant execute on function my_person_id(), my_roles(), is_admin(), is_staff(), has_perm(text) to authenticated;

-- ---------- Schutz-Trigger: Rechte-Eskalation verhindern ----------
-- Nicht-Admins dürfen ihren eigenen Kontakt ändern, aber NICHT Rolle/Rechte/aktiv.
create or replace function people_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    new.roles       := old.roles;
    new.rolle       := old.rolle;
    new.permissions := old.permissions;
    new.aktiv       := old.aktiv;
    new.faecher     := old.faecher;
    new.legacy_id   := old.legacy_id;
    new.sort        := old.sort;
  end if;
  return new;
end $$;
drop trigger if exists people_guard_trg on people;
create trigger people_guard_trg before update on people for each row execute function people_guard();

-- "Ferien" darf nur der Admin setzen.
create or replace function practice_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    if tg_op = 'INSERT' then new.ferien := false; else new.ferien := old.ferien; end if;
  end if;
  return new;
end $$;
drop trigger if exists practice_guard_trg on practice_times;
create trigger practice_guard_trg before insert or update on practice_times for each row execute function practice_guard();

-- ============================================================
--  POLICIES NEU SETZEN
-- ============================================================

-- ---------- PEOPLE ----------
alter table people enable row level security;
drop policy if exists people_read_auth on people;
drop policy if exists people_write_auth on people;
create policy people_select on people for select to authenticated using (true);
create policy people_insert on people for insert to authenticated with check (is_admin());
create policy people_update on people for update to authenticated
  using (is_admin() or id = my_person_id()) with check (is_admin() or id = my_person_id());
create policy people_delete on people for delete to authenticated using (is_admin());

-- ---------- PRACTICE_TIMES (Übezeiten) ----------
alter table practice_times enable row level security;
drop policy if exists practice_times_read_auth on practice_times;
drop policy if exists practice_times_write_auth on practice_times;
create policy pt_select on practice_times for select to authenticated
  using (is_staff() or person_id = my_person_id());
create policy pt_insert on practice_times for insert to authenticated
  with check (has_perm('zeiten') or person_id = my_person_id());
create policy pt_update on practice_times for update to authenticated
  using (has_perm('zeiten') or person_id = my_person_id())
  with check (has_perm('zeiten') or person_id = my_person_id());
create policy pt_delete on practice_times for delete to authenticated using (has_perm('zeiten'));

-- ---------- THEORY (Treffen / Aufgaben / Status) ----------
alter table theory_meetings enable row level security;
drop policy if exists theory_meetings_read_auth on theory_meetings;
drop policy if exists theory_meetings_write_auth on theory_meetings;
create policy tm_select on theory_meetings for select to authenticated using (true);
create policy tm_write  on theory_meetings for all to authenticated using (has_perm('theorie')) with check (has_perm('theorie'));

alter table theory_tasks enable row level security;
drop policy if exists theory_tasks_read_auth on theory_tasks;
drop policy if exists theory_tasks_write_auth on theory_tasks;
create policy tt_select on theory_tasks for select to authenticated using (true);
create policy tt_write  on theory_tasks for all to authenticated using (has_perm('theorie')) with check (has_perm('theorie'));

alter table theory_status enable row level security;
drop policy if exists theory_status_read_auth on theory_status;
drop policy if exists theory_status_write_auth on theory_status;
create policy ts_select on theory_status for select to authenticated
  using (is_staff() or person_id = my_person_id());
create policy ts_insert on theory_status for insert to authenticated
  with check (has_perm('theorie') or person_id = my_person_id());
create policy ts_update on theory_status for update to authenticated
  using (has_perm('theorie') or person_id = my_person_id())
  with check (has_perm('theorie') or person_id = my_person_id());
create policy ts_delete on theory_status for delete to authenticated using (has_perm('theorie'));

-- ---------- TESTS ----------
alter table tests enable row level security;
drop policy if exists tests_read_auth on tests;
drop policy if exists tests_write_auth on tests;
create policy te_select on tests for select to authenticated
  using (is_staff() or person_id = my_person_id());
create policy te_write  on tests for all to authenticated using (has_perm('tests')) with check (has_perm('tests'));

-- ---------- GRADES (Gesamtbewertung) ----------
alter table grades enable row level security;
drop policy if exists grades_read_auth on grades;
drop policy if exists grades_write_auth on grades;
create policy gr_select on grades for select to authenticated
  using (is_staff() or person_id = my_person_id());
create policy gr_write  on grades for all to authenticated using (has_perm('bewertung')) with check (has_perm('bewertung'));

-- ---------- GRADE_COLUMNS ----------
alter table grade_columns enable row level security;
drop policy if exists gc_read on grade_columns;
drop policy if exists gc_write on grade_columns;
create policy gc_select on grade_columns for select to authenticated using (true);
create policy gc_write  on grade_columns for all to authenticated using (has_perm('bewertung')) with check (has_perm('bewertung'));

-- ---------- ANNOUNCEMENTS (Infos) ----------
alter table announcements enable row level security;
drop policy if exists ann_read_public on announcements;
drop policy if exists announcements_write_auth on announcements;
create policy ann_select on announcements for select using (true);
create policy ann_write  on announcements for all to authenticated using (has_perm('infos')) with check (has_perm('infos'));

-- ---------- SITE_DOCS (Pläne-PDFs) ----------
alter table site_docs enable row level security;
drop policy if exists site_docs_read on site_docs;
drop policy if exists site_docs_write on site_docs;
create policy sd_select on site_docs for select using (true);
create policy sd_write  on site_docs for all to authenticated using (is_admin()) with check (is_admin());

-- ---------- TIMETABLE (Stundenplan) ----------
alter table timetable enable row level security;
drop policy if exists timetable_read on timetable;
drop policy if exists timetable_write on timetable;
create policy tt2_select on timetable for select to authenticated using (true);
create policy tt2_write  on timetable for all to authenticated using (has_perm('stundenplan')) with check (has_perm('stundenplan'));

-- ---------- PLANS (Grundplan + Treffen) ----------
alter table plans enable row level security;
drop policy if exists plans_read on plans;
drop policy if exists plans_write on plans;
create policy pl_select on plans for select to authenticated using (true);
create policy pl_write  on plans for all to authenticated using (has_perm('stundenplan')) with check (has_perm('stundenplan'));

-- ---------- ROOMS ----------
alter table rooms enable row level security;
drop policy if exists rooms_read on rooms;
drop policy if exists rooms_write on rooms;
create policy rm_select on rooms for select to authenticated using (true);
create policy rm_write  on rooms for all to authenticated using (has_perm('stundenplan')) with check (has_perm('stundenplan'));

-- ---------- TIME_SLOTS ----------
alter table time_slots enable row level security;
drop policy if exists ts_read on time_slots;
drop policy if exists ts_write on time_slots;
create policy tsl_select on time_slots for select to authenticated using (true);
create policy tsl_write  on time_slots for all to authenticated using (has_perm('stundenplan')) with check (has_perm('stundenplan'));

-- ---------- ABSENCES (Abmeldungen) ----------
alter table absences enable row level security;
drop policy if exists abs_read on absences;
drop policy if exists abs_write on absences;
create policy ab_select on absences for select to authenticated using (true);
create policy ab_write  on absences for all to authenticated using (has_perm('abmeldungen')) with check (has_perm('abmeldungen'));
