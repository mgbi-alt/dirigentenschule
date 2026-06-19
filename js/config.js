// ============================================================
//  Dirigentenschule – Konfiguration
//  Nach dem Anlegen des NEUEN Supabase-Projekts hier eintragen:
//  Supabase Dashboard → Project Settings → API
// ============================================================
const SB_URL = 'https://DEIN-PROJEKT.supabase.co';
const SB_KEY = 'DEIN_PUBLISHABLE_ANON_KEY';

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
