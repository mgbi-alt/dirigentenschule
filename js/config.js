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
