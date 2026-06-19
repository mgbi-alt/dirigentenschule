-- ============================================================
--  Dirigentenschule – Supabase Schema
--  Komplett im Supabase SQL-Editor ausführen (neues Projekt!)
-- ============================================================

-- ---------- PERSONEN (Schüler / Lehrer / Admin) ----------
create table if not exists people (
  id          uuid primary key default gen_random_uuid(),
  legacy_id   int unique,                 -- alte Fabrik-User-ID (user_raw aus CSV)
  auth_id     uuid unique,                -- Supabase-Auth-User (für Login-Zuordnung)
  nachname    text not null,
  vorname     text,
  gemeinde    text,
  email       text,
  telefon     text,
  bild_url    text,
  rolle       text not null default 'schueler',  -- schueler | lehrer | admin
  aktiv       boolean default true,
  sort        int default 0,
  created_at  timestamptz default now()
);

-- ---------- HAUSAUFGABENZEITEN (pro KW & Schüler) ----------
create table if not exists practice_times (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid references people(id) on delete cascade,
  jahr          int  not null,
  kw            int  not null,            -- Kalenderwoche
  datum         date,
  dirigieren    int default 0,
  stimmbildung  int default 0,
  klavier       int default 0,
  gehoerbildung int default 0,
  ferien        boolean default false,
  updated_at    timestamptz default now(),
  unique(person_id, jahr, kw)
);
-- "Gesamt" wird in der App berechnet (Summe der vier Fächer)

-- ---------- MUSIKTHEORIE: TREFFEN / HAUSAUFGABEN ----------
create table if not exists theory_meetings (
  id               uuid primary key default gen_random_uuid(),
  datum            date not null,
  titel            text,
  beschreibung_url text,                  -- Haupt-PDF mit der Aufgabenbeschreibung
  dokumente        jsonb default '[]',    -- Begleitdokumente [{name,url}]
  sort             int default 0,
  created_at       timestamptz default now()
);

create table if not exists theory_tasks (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid references theory_meetings(id) on delete cascade,
  bezeichnung text not null,
  gewicht     numeric default 0,          -- Prozent-Gewicht; alle Aufgaben eines Treffens = 100 %
  sort        int default 0
);

create table if not exists theory_status (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid references theory_tasks(id) on delete cascade,
  person_id  uuid references people(id) on delete cascade,
  erledigt   boolean default false,
  updated_at timestamptz default now(),
  unique(task_id, person_id)
);

-- ---------- 5-MINUTEN-TESTS (Harmonielehre & Gehörbildung) ----------
create table if not exists tests (
  id         uuid primary key default gen_random_uuid(),
  fach       text not null,               -- 'harmonielehre' | 'gehoerbildung'
  person_id  uuid references people(id) on delete cascade,
  monat      text,                        -- Anzeige-Label, z.B. '2026 März'
  monat_sort int,                         -- Sortierschlüssel (z.B. monat_raw)
  datum      date,
  ergebnis   numeric,                     -- Prozent
  created_at timestamptz default now()
);

-- ---------- GESAMTBEWERTUNG ----------
create table if not exists grades (
  id               uuid primary key default gen_random_uuid(),
  fach             text not null,         -- 'harmonielehre' | 'gehoerbildung'
  person_id        uuid references people(id) on delete cascade,
  ha_ueberpruefung numeric,
  hausaufgaben     numeric,
  klausur1         numeric,
  klausur2         numeric,
  gesamt           numeric,
  gesamtnote       text,
  unique(fach, person_id)
);

-- ---------- STARTSEITE: INFOS / ANKÜNDIGUNGEN ----------
create table if not exists announcements (
  id         uuid primary key default gen_random_uuid(),
  titel      text,
  text       text,
  datum      date default now(),
  created_at timestamptz default now()
);

-- ============================================================
--  ROW LEVEL SECURITY
--  Startseiten-Infos sind öffentlich, der Rest nur für Eingeloggte.
--  Schreiben dürfen eingeloggte Nutzer (Rollen-Logik in der App).
-- ============================================================
alter table people          enable row level security;
alter table practice_times  enable row level security;
alter table theory_meetings enable row level security;
alter table theory_tasks    enable row level security;
alter table theory_status   enable row level security;
alter table tests           enable row level security;
alter table grades          enable row level security;
alter table announcements   enable row level security;

-- Öffentlich lesbar: Startseiten-Infos
create policy "ann_read_public" on announcements for select using (true);

-- Nur Eingeloggte lesen den Rest
do $$
declare t text;
begin
  foreach t in array array['people','practice_times','theory_meetings',
                           'theory_tasks','theory_status','tests','grades']
  loop
    execute format('create policy "%s_read_auth" on %s for select to authenticated using (true);', t, t);
  end loop;
end $$;

-- Eingeloggte dürfen schreiben (Feinsteuerung per Rolle in der App)
do $$
declare t text;
begin
  foreach t in array array['people','practice_times','theory_meetings',
                           'theory_tasks','theory_status','tests','grades','announcements']
  loop
    execute format('create policy "%s_write_auth" on %s for all to authenticated using (true) with check (true);', t, t);
  end loop;
end $$;

-- ---------- STORAGE ----------
-- Bucket 'docs' im Supabase-Dashboard anlegen (public) für PDFs & Profilbilder.
