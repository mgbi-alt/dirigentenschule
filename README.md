# Dirigentenschule

Progressive Web App für die Dirigentenschule: Startseite mit Infos, Hausaufgaben
(Musiktheorie + Übezeiten), Kontakte und Bewertungen (Harmonielehre & Gehörbildung).

**Stack:** Vanilla HTML/CSS/JS · Supabase (Postgres, Auth, Storage) · GitHub Pages.
Eigenständiges Projekt – komplett getrennt vom Chor-Manager (Cantamus).

## Funktionen
- **Start** – Begrüßung, Kennzahlen, aktuelle Infos.
- **Hausaufgaben → Musiktheorie** – pro Treffen Aufgaben-PDF + Begleitdokumente zum
  Download, Schüler haken erledigte Aufgaben ab. Übersichtstabelle (Zeilen = Schüler,
  Spalten = Treffen) mit Erfüllungsgrad in % und Ø-Spalte.
- **Hausaufgaben → Übezeiten** – Minuten pro KW & Fach (Dirigieren, Gehörbildung,
  Stimmbildung, Klavier) + Gesamt. Ampel: 0–5 rot, 10 gelb, 15+ grün (Ziel 15 Min/Fach).
- **Kontakte** – Name, Gemeinde, E-Mail, Telefon, Bild (lesend).
- **Bewertungen** – 5-Minuten-Tests + Gesamtbewertung für Harmonielehre und Gehörbildung.
- **Admin** – CSV-Import (Fabrik-Exporte), Infos pflegen, Personen.

## Einrichtung

### 1. Supabase-Projekt anlegen
1. Auf [supabase.com](https://supabase.com) ein **neues** Projekt erstellen.
2. SQL-Editor öffnen und nacheinander ausführen:
   - `supabase_schema.sql`
   - `supabase_seed_people.sql`
3. **Storage** → Bucket `docs` anlegen (public) für PDFs und Profilbilder.
4. **Project Settings → API**: `Project URL` und `anon/publishable key` kopieren
   und in `js/config.js` bei `SB_URL` / `SB_KEY` eintragen.

### 2. Logins anlegen
- **Authentication → Users** → Nutzer per E-Mail/Passwort anlegen.
- Die App ordnet den Login automatisch der Person zu (per E-Mail-Adresse in `people.email`).
  Also bei den Personen im Admin/SQL die passende `email` setzen.
- Rollen: `schueler` (Standard), `lehrer`, `admin`. Mindestens eine Person auf `admin` setzen:
  ```sql
  update people set rolle='admin', email='deine@mail.de' where nachname='Ens';
  ```

### 3. Alt-Daten importieren (CSV)
Im Tab **Admin → CSV-Import** die Fabrik-Exporte hochladen:
| Typ | Datei |
|-----|-------|
| Hausaufgabenzeiten | `hk_hausaufgaben_gesamt-export.csv` |
| Harmonielehre-Tests | `hk_harmonielehre_tests-export.csv` |
| Gehörbildung-Tests | `hk_gehoerbildung_tests-export.csv` |
| Harmonielehre-Gesamt | `hk_harmonielehre-export.csv` |

Die Zuordnung läuft über `people.legacy_id` (= alte Fabrik-User-ID). Der Import ist
wiederholbar (Zeiten/Gesamt werden aktualisiert, Tests pro Fach neu befüllt).

### 4. Hosting (GitHub Pages)
```bash
git init
git add .
git commit -m "Initial: Dirigentenschule"
git branch -M main
git remote add origin https://github.com/DEIN-USER/dirigentenschule.git
git push -u origin main
```
Dann in GitHub **Settings → Pages → Branch: main / root** aktivieren.

## Dateien
| Datei | Inhalt |
|-------|--------|
| `index.html` | Struktur + Navigation |
| `css/main.css` | Styles (dunkel, Amber-Akzent) |
| `js/config.js` | Supabase-Zugangsdaten + Konstanten |
| `js/app.js` | Auth, Navigation, alle Tabs, CSV-Import |
| `supabase_schema.sql` | Tabellen + RLS |
| `supabase_seed_people.sql` | 15 Schüler |
| `sw.js`, `manifest.json` | PWA |

## Offene Punkte / Ideen
- Profilbilder & Kontaktdaten über Admin-UI bearbeitbar machen (aktuell per SQL/Storage).
- Gehörbildung-Gesamtbewertung: eigener Import, sobald CSV vorliegt.
- App-Icons `icon-192.png` / `icon-512.png` ergänzen.
