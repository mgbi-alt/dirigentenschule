-- ============================================================
--  Migration v14 – fehlende Wochen, Test-Spalten, Bewertungs-Spaltentypen
--  Nach v13 ausführen (idempotent).
-- ============================================================

-- ---------- Fehlende Übe-Wochen bis zu einem Datum erzeugen ----------
create or replace function ensure_practice_until(p_end date) returns int
  language plpgsql security definer set search_path = public as $$
declare d date; startd date; n int := 0;
begin
  select min(to_date(jahr::text || lpad(kw::text,2,'0'), 'IYYYIW')) into startd from practice_times;
  if startd is null then startd := date_trunc('week', now())::date; end if;
  d := date_trunc('week', startd)::date;
  while d <= p_end loop
    perform ensure_practice_week(extract(isoyear from d)::int, extract(week from d)::int);
    d := d + 7; n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function ensure_practice_until(date) to authenticated;

-- ---------- Bewertungs-Spalten: Typ + Gewicht ----------
--  typ: manual (eingebbar) | tests (Mittel der 5-Min-Tests) | gesamt (berechnet %) | note (IHK aus gesamt)
alter table grade_columns add column if not exists typ     text    default 'manual';
alter table grade_columns add column if not exists gewicht numeric default 1;
update grade_columns set typ='gesamt' where label='Gesamt' and coalesce(typ,'manual')='manual';
update grade_columns set typ='note'   where label='Note'   and coalesce(typ,'manual')='manual';
update grade_columns set typ='manual' where typ is null;

-- ---------- Test-Spalten (5-Minuten-Tests) ----------
create table if not exists test_columns (
  id    uuid primary key default gen_random_uuid(),
  fach  text not null,
  label text not null,
  sort  int default 0,
  unique(fach, label)
);
alter table test_columns enable row level security;
drop policy if exists tc_select on test_columns;
drop policy if exists tc_write  on test_columns;
create policy tc_select on test_columns for select to authenticated using (true);
create policy tc_write  on test_columns for all to authenticated using (has_perm('tests')) with check (has_perm('tests'));

-- vorhandene Test-Monate als Spalten übernehmen
insert into test_columns(fach, label, sort)
select fach, monat, coalesce(min(monat_sort),0)
from tests where monat is not null
group by fach, monat
on conflict (fach, label) do nothing;
