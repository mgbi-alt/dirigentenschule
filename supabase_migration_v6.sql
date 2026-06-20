-- ============================================================
--  Migration v6 – Stundenplan: Überschrift + verknüpfte Lehrer
--  Nach v5 ausführen (idempotent).
-- ============================================================
alter table timetable add column if not exists ueberschrift text;     -- z.B. 'Gruppe 1'
alter table timetable add column if not exists lehrer_ids   uuid[];   -- verknüpfte Lehrer (people)

-- Bestehenden Lehrer-Freitext ("Vorname N.") mit Personen verknüpfen (best effort)
update timetable t
set lehrer_ids = sub.ids
from (
  select t2.id, array_agg(distinct p.id) as ids
  from timetable t2
  join people p
    on p.vorname is not null and p.nachname <> ''
   and position(lower(p.vorname || ' ' || left(p.nachname,1) || '.') in lower(coalesce(t2.lehrer,''))) > 0
  group by t2.id
) sub
where t.id = sub.id
  and (t.lehrer_ids is null or array_length(t.lehrer_ids,1) is null);
