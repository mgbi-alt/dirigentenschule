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
const PRACTICE_TARGET = 30;

// Bearbeitbare Bereiche (für Lehrer-Rechte, pro Tabelle)
const EDIT_AREAS = [
  { key: 'zeiten',    label: 'Übezeiten' },
  { key: 'theorie',   label: 'Musiktheorie' },
  { key: 'tests',     label: 'Tests' },
  { key: 'bewertung',   label: 'Gesamtbewertung' },
  { key: 'infos',       label: 'Infos (Startseite)' },
  { key: 'stundenplan', label: 'Stundenplan' },
  { key: 'abmeldungen', label: 'Abmeldungen' },
  { key: 'kalender',    label: 'Kalender' },
];

// Kalender-Kategorien (Termine): key -> Label/Farbe
const CAL_KATEGORIEN = [
  { key: 'auffuehrung', label: 'Aufführung',  color: '#7a3b2e' },
  { key: 'probe',       label: 'Probe',       color: '#4c7a8c' },
  { key: 'pruefung',    label: 'Prüfung',     color: '#a03b3b' },
  { key: 'sonstiges',   label: 'Sonstiges',   color: '#8a8060' },
];

// Spalten-Reihenfolge im Stundenplan
const FACH_ORDER = ['Musiktheorie','Arrangieren','Dirigieren','Stimmbildung','Klavier','Gehörbildung','Orchesterpraxis','Chorpraxis'];

// Fächer, denen Personen zugeordnet werden können (für die Stundenplan-Auswahl)
const ASSIGN_SUBJECTS = ['Dirigieren','Stimmbildung','Klavier','Gehörbildung','Musiktheorie','Arrangieren','Klavierbegleitung'];

// Einzelunterricht (hier wirkt eine Schüler-Abmeldung als Entfall)
const INDIVIDUAL_FAECHER = ['Dirigieren','Stimmbildung','Klavier','Gehörbildung'];

// Rollen (Mehrfach-Zuordnung möglich). Reihenfolge = Sortierung in Kontakten.
const ROLES = [
  { key: 'admin',            label: 'Admin' },
  { key: 'klassenleitung',   label: 'Klassenleitung' },
  { key: 'lehrer',           label: 'Lehrer' },
  { key: 'klavierbegleitung', label: 'Klavierbegleitung' },
  { key: 'schueler',         label: 'Schüler' },
];

// Info-Tab: feste PDF-Pläne
const SITE_DOCS = [
  { key: 'stundenplan_fr', label: 'Stundenplan Freitag' },
  { key: 'stundenplan_sa', label: 'Stundenplan Samstag' },
  { key: 'terminplan',     label: 'Terminplan' },
];

// erlaubte Übezeiten-Werte (Minuten) im Dialog
const MIN_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40];

// ---------- NRW-Feiertage & Schulferien (für den Kalender) ----------
// Gesetzliche Feiertage NRW: fixe + bewegliche (Ostern per Gauss-Formel), Rückgabe {'JJJJ-MM-TT': Name}
function getNRWHolidays(year){
  const fixed=[['01-01','Neujahr'],['05-01','Tag der Arbeit'],['10-03','Tag der Deutschen Einheit'],['11-01','Allerheiligen'],['12-25','1. Weihnachtstag'],['12-26','2. Weihnachtstag']];
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),easter=new Date(year,Math.floor((h+l-7*m+114)/31)-1,(h+l-7*m+114)%31+1);
  function addDays(d,n){const r=new Date(d);r.setDate(r.getDate()+n);return r;}
  function fmt(d){return`${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  const movable=[[addDays(easter,-2),'Karfreitag'],[addDays(easter,1),'Ostermontag'],[addDays(easter,39),'Christi Himmelfahrt'],[addDays(easter,50),'Pfingstmontag'],[addDays(easter,60),'Fronleichnam']];
  const result={};
  fixed.forEach(([d,n])=>result[`${year}-${d}`]=n);
  movable.forEach(([d,n])=>result[`${year}-${fmt(d)}`]=n);
  return result;
}
// Schulferien NRW (Quelle: schulministerium.nrw, Ferienordnung fuer NRW bis Schuljahr 2029/30 -- bei Bedarf ergaenzen)
function getNRWSchoolHolidays(year){
  const h=[];
  if(year===2025){
    h.push({from:'2025-01-01',to:'2025-01-03',name:'Weihnachtsferien'});
    h.push({from:'2025-03-24',to:'2025-04-05',name:'Osterferien'});
    h.push({from:'2025-07-14',to:'2025-08-26',name:'Sommerferien'});
    h.push({from:'2025-10-13',to:'2025-10-25',name:'Herbstferien'});
    h.push({from:'2025-12-22',to:'2026-01-06',name:'Weihnachtsferien'});
  } else if(year===2026){
    h.push({from:'2026-01-01',to:'2026-01-06',name:'Weihnachtsferien'});
    h.push({from:'2026-03-30',to:'2026-04-11',name:'Osterferien'});
    h.push({from:'2026-07-20',to:'2026-09-01',name:'Sommerferien'});
    h.push({from:'2026-10-17',to:'2026-10-31',name:'Herbstferien'});
    h.push({from:'2026-12-23',to:'2027-01-06',name:'Weihnachtsferien'});
  } else if(year===2027){
    // Weihnachtsferien-Start 2027-01-01 bis 01-06 kommt bereits aus dem 2026-Eintrag oben.
    h.push({from:'2027-03-22',to:'2027-04-03',name:'Osterferien'});
    h.push({from:'2027-07-19',to:'2027-08-31',name:'Sommerferien'});
    h.push({from:'2027-10-23',to:'2027-11-06',name:'Herbstferien'});
    h.push({from:'2027-12-24',to:'2028-01-08',name:'Weihnachtsferien'});
  }
  return h;
}
// Alle Ferientage eines Jahres als {'JJJJ-MM-TT': Name} (inkl. Überlauf aus Nachbarjahren)
function getSchoolHolidayDays(year){
  const result={};
  const holidays=[...getNRWSchoolHolidays(year-1),...getNRWSchoolHolidays(year),...getNRWSchoolHolidays(year+1)];
  holidays.forEach(({from,to,name})=>{
    let d=new Date(from+'T00:00:00'); const end=new Date(to+'T00:00:00');
    while(d<=end){
      const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if(ds.startsWith(String(year))) result[ds]=name;
      d.setDate(d.getDate()+1);
    }
  });
  return result;
}
