-- ============================================================
--  Migration v8 – Fächer-Zuordnung, Klavierbegleitung, Räume
--  Nach v7 ausführen (idempotent).
-- ============================================================

-- Personen können Fächern zugeordnet werden (auch mehreren)
alter table people add column if not exists faecher text[];

-- Klavierbegleitung als verknüpfte Personen
alter table timetable add column if not exists klavier_ids uuid[];

-- Räume als Liste
create table if not exists rooms (
  id   uuid primary key default gen_random_uuid(),
  name text unique not null,
  sort int default 0
);
alter table rooms enable row level security;
drop policy if exists rooms_read  on rooms;
drop policy if exists rooms_write on rooms;
create policy rooms_read  on rooms for select to authenticated using (true);
create policy rooms_write on rooms for all to authenticated using (true) with check (true);

-- Räume aus dem bestehenden Stundenplan übernehmen
insert into rooms(name)
select distinct t.raum from timetable t
where t.raum is not null and t.raum <> ''
on conflict (name) do nothing;

-- Klavierbegleitung-Freitext ("Vorname N.") mit Personen verknüpfen (best effort)
update timetable t
set klavier_ids = sub.ids
from (
  select t2.id, array_agg(distinct p.id) as ids
  from timetable t2
  join people p on p.vorname is not null and p.nachname <> ''
   and position(lower(p.vorname || ' ' || left(p.nachname,1) || '.') in lower(coalesce(t2.klavier,''))) > 0
  group by t2.id
) sub
where t.id = sub.id and (t.klavier_ids is null or array_length(t.klavier_ids,1) is null);
