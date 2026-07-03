-- ============================================================
--  Migration v18 – 5-Minuten-Tests an die allgemeinen Treffen koppeln
--  Nach v17 ausführen (idempotent).
--  Die Test-Spalten (test_columns) tragen bisher ein Monatslabel
--  ('2025 Oktober', '2026 Mai(2)'). Hier wird jede Spalte dem
--  tatsächlichen Treffen (plans, is_base=false) desselben Monats
--  zugeordnet. '(2)' = zweites Treffen des Monats.
-- ============================================================

-- 1) Bezug zum allgemeinen Treffen
alter table test_columns add column if not exists plan_id uuid references plans(id) on delete set null;

-- 2) Label -> Treffen zuordnen (Monat aus dem Label, Vorkommen aus '(n)')
with parsed as (
  select
    tc.id,
    substring(tc.label from '^[0-9]{4}')                              as jahr,
    trim(substring(tc.label from '^[0-9]{4}\s+([A-Za-zäöüÄÖÜ]+)'))    as monname,
    coalesce((substring(tc.label from '\(([0-9]+)\)'))::int, 1)       as occ
  from test_columns tc
),
mapped as (
  select p.id, p.jahr, p.occ,
    case p.monname
      when 'Januar' then '01' when 'Februar' then '02' when 'März'     then '03'
      when 'April'  then '04' when 'Mai'     then '05' when 'Juni'     then '06'
      when 'Juli'   then '07' when 'August'  then '08' when 'September' then '09'
      when 'Oktober' then '10' when 'November' then '11' when 'Dezember' then '12'
    end as mm
  from parsed p
)
update test_columns tc
set plan_id = sub.plan_id
from (
  select m.id,
    (select pl.id from plans pl
       where pl.is_base = false
         and m.mm is not null
         and to_char(pl.datum,'YYYY-MM') = m.jahr || '-' || m.mm
       order by pl.datum, pl.sort
       offset (m.occ - 1) limit 1) as plan_id
  from mapped m
) sub
where tc.id = sub.id and sub.plan_id is not null;

-- 3) Diagnose: Test-Spalten ohne zugeordnetes Treffen (sollte leer sein)
select fach, label from test_columns where plan_id is null order by fach, sort;
