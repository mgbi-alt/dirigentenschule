-- ============================================================
--  Migration v4 – Stundenplan-Versionen (Grundplan + pro Treffen)
--  Nach v3 + Seed ausführen (idempotent).
-- ============================================================
create table if not exists plans (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,                 -- 'Grundplan' oder z.B. 'Treffen 14.06.2026'
  datum      date,
  is_base    boolean default false,         -- true = Grundplan (Vorlage)
  sort       int default 0,
  created_at timestamptz default now()
);
alter table plans enable row level security;
drop policy if exists plans_read  on plans;
drop policy if exists plans_write on plans;
create policy plans_read  on plans for select to authenticated using (true);
create policy plans_write on plans for all to authenticated using (true) with check (true);

-- Stunden gehören zu einem Plan
alter table timetable add column if not exists plan_id uuid references plans(id) on delete cascade;

-- Grundplan sicherstellen
insert into plans (name, is_base, sort)
select 'Grundplan', true, 0
where not exists (select 1 from plans where is_base);

-- bestehende (Seed-)Stunden dem Grundplan zuordnen
update timetable
set plan_id = (select id from plans where is_base order by sort limit 1)
where plan_id is null;
