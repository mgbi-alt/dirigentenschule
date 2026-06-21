-- ============================================================
--  Migration v12 – stabile Diff-Zuordnung (Herkunfts-ID)
--  Nach v11 ausführen (idempotent).
-- ============================================================
alter table timetable add column if not exists source_id uuid references timetable(id) on delete set null;

-- Bestehende Treffen-Stunden ihrem Grundplan-Pendant zuordnen (best effort: zeit/fach/sort)
update timetable t set source_id = b.id
from timetable b
join plans bp on bp.id = b.plan_id and bp.is_base
where t.source_id is null
  and t.plan_id in (select id from plans where is_base = false)
  and t.zeit = b.zeit and t.fach = b.fach and coalesce(t.sort,0) = coalesce(b.sort,0);
