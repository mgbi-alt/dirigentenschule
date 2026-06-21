// ============================================================
//  Dirigentenschule – Konfiguration
//  Nach dem Anlegen des NEUEN Supabase-Projekts hier eintragen:
//  Supabase Dashboard → Project Settings → API
// ============================================================
const SB_URL = 'https://dfhrtfzmhwxnrxlbejvr.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmaHJ0ZnptaHd4bnJ4bGJlanZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4OTM3NzgsImV4cCI6MjA5NzQ2OTc3OH0.J-SKn8ZpEG3GQLQMXC_zzkCFwJ0Chy2iTrSNiP4d38g';

// Supabase-Client (global)
const SB = window.supabase.createClient(SB_URL, SB_KEY);

// Fächer für die Übezeiten-Tabelle
const SUBJECTS = [
  { key: 'dirigieren',    label: 'Dirigieren' },
  { key: 'gehoerbildung', label: 'Gehörbildung' },
  { key: 'stimmbildung',  label: 'Stimmbildung' },
  { key: 'klavier',       label: 'Klavier' },
];

// Ziel pro Fach (Minuten/Woche)
const PRACTICE_TARGET = 15;

// Bearbeitbare Bereiche (für Lehrer-Rechte, pro Tabelle)
const EDIT_AREAS = [
  { key: 'zeiten',    label: 'Übezeiten' },
  { key: 'theorie',   label: 'Musiktheorie' },
  { key: 'tests',     label: 'Tests' },
  { key: 'bewertung',   label: 'Gesamtbewertung' },
  { key: 'infos',       label: 'Infos (Startseite)' },
  { key: 'stundenplan', label: 'Stundenplan' },
];

// Spalten-Reihenfolge im Stundenplan
const FACH_ORDER = ['Musiktheorie','Arrangieren','Dirigieren','Stimmbildung','Klavier','Gehörbildung','Orchesterpraxis','Chorpraxis'];

// Fächer, denen Personen zugeordnet werden können (für die Stundenplan-Auswahl)
const ASSIGN_SUBJECTS = ['Dirigieren','Stimmbildung','Klavier','Gehörbildung','Musiktheorie','Arrangieren','Klavierbegleitung'];

// Einzelunterricht (hier wirkt eine Schüler-Abmeldung als Entfall)
const INDIVIDUAL_FAECHER = ['Dirigieren','Stimmbildung','Klavier','Gehörbildung'];

// Rollen (Mehrfach-Zuordnung möglich). Reihenfolge = Sortierung in Kontakten.
const ROLES = [
  { key: 'admin',          label: 'Admin' },
  { key: 'klassenleitung', label: 'Klassenleitung' },
  { key: 'lehrer',         label: 'Lehrer' },
  { key: 'schueler',       label: 'Schüler' },
];

// Info-Tab: feste PDF-Pläne
const SITE_DOCS = [
  { key: 'stundenplan_fr', label: 'Stundenplan Freitag' },
  { key: 'stundenplan_sa', label: 'Stundenplan Samstag' },
  { key: 'terminplan',     label: 'Terminplan' },
];

// erlaubte Übezeiten-Werte (Minuten) im Dialog
const MIN_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40];
