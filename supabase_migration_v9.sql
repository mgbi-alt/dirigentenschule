-- ============================================================
--  Migration v9 – Schüler im Stundenplan verknüpfen
--  Nach v8 ausführen (idempotent).
-- ============================================================
alter table timetable add column if not exists schueler_ids uuid[];

-- Schüler-Freitext ("Vorname N.") best effort mit Schüler-Personen verknüpfen
update timetable t
set schueler_ids = sub.ids
from (
  select t2.id, array_agg(distinct p.id) as ids
  from timetable t2
  join people p on p.vorname is not null and p.nachname <> '' and p.roles @> array['schueler']
   and position(lower(p.vorname || ' ' || left(p.nachname,1) || '.') in lower(coalesce(t2.schueler,''))) > 0
  group by t2.id
) sub
where t.id = sub.id and (t.schueler_ids is null or array_length(t.schueler_ids,1) is null);
