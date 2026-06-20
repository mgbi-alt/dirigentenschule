-- ============================================================
--  Migration v10 – Zeitraster (vordefinierte Zeiten)
--  Nach v9 ausführen (idempotent).
-- ============================================================
create table if not exists time_slots (
  id    uuid primary key default gen_random_uuid(),
  label text unique not null,        -- z.B. '8:00 - 8:45'
  sort  int default 0
);
alter table time_slots enable row level security;
drop policy if exists ts_read  on time_slots;
drop policy if exists ts_write on time_slots;
create policy ts_read  on time_slots for select to authenticated using (true);
create policy ts_write on time_slots for all to authenticated using (true) with check (true);

-- vorhandene Zeiten aus dem Stundenplan übernehmen
insert into time_slots(label, sort)
select zeit, min(zeit_sort) from timetable
where zeit is not null and zeit <> ''
group by zeit
on conflict (label) do nothing;
