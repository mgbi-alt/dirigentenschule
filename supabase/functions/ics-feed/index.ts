// Edge Function: ics-feed
//
// Liefert die Termine (Tabelle "termine") + automatische Treffen (Tabelle "plans")
// als iCalendar-Feed (.ics) aus, zum Abonnieren in Google Kalender oder im
// iOS/Apple-Kalender ("Kalenderabo hinzufuegen" / "Per URL"). Wird OHNE Login
// aufgerufen (Kalender-Apps koennen sich nicht bei Supabase einloggen) -- Schutz
// erfolgt stattdessen ueber einen Token in der Query-String (?token=...), der in
// der Tabelle "ics_feed_token" hinterlegt ist und im Kalender-Tab der App
// (Button "Neu generieren", nur fuer Admins) angezeigt/rotiert werden kann.
//
// verify_jwt ist fuer diese Funktion in supabase/config.toml bewusst auf false
// gesetzt, siehe dort.
//
// Benoetigte Secrets (setzt Supabase bei Edge Functions automatisch):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const KAT_LABELS: Record<string, string> = {
  auffuehrung: 'Aufführung',
  probe: 'Probe',
  pruefung: 'Prüfung',
  sonstiges: 'Sonstiges',
};

type Termin = {
  id: string;
  titel: string;
  datum: string;
  uhrzeit: string | null;
  bis_datum: string | null;
  bis_uhrzeit: string | null;
  ort: string | null;
  beschreibung: string | null;
  kategorie: string;
};

type Plan = {
  id: string;
  name: string | null;
  datum: string | null;
  is_base: boolean;
  tage: string | null;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Reines Kalender-Datum (YYYY-MM-DD) + Verschiebung um `delta` Tage, ohne
// Abhaengigkeit von der Server-Zeitzone (nur UTC-verankerte Datumsarithmetik).
function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function icsEscape(s: string): string {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function foldLine(line: string): string {
  const max = 74;
  if (line.length <= max) return line;
  let out = '';
  let rest = line;
  let first = true;
  while (rest.length > 0) {
    const chunk = first ? max : max - 1;
    out += (first ? '' : '\r\n ') + rest.slice(0, chunk);
    rest = rest.slice(chunk);
    first = false;
  }
  return out;
}

function timeStamp(datum: string, uhrzeit: string): string {
  const hhmmss = uhrzeit.length === 5 ? uhrzeit + ':00' : uhrzeit;
  return datum.replace(/-/g, '') + 'T' + hhmmss.replace(/:/g, '');
}

function buildEvent(opts: {
  uid: string;
  dtstamp: string;
  allDay: boolean;
  startDate: string;
  startTime?: string | null;
  endDate?: string | null;
  endTime?: string | null;
  summary: string;
  location?: string | null;
  description?: string | null;
  category?: string | null;
}): string[] {
  const lines: string[] = [];
  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${opts.uid}`);
  lines.push(`DTSTAMP:${opts.dtstamp}`);
  if (opts.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${opts.startDate.replace(/-/g, '')}`);
    const endDate = opts.endDate || opts.startDate;
    lines.push(`DTEND;VALUE=DATE:${addDays(endDate, 1).replace(/-/g, '')}`);
  } else {
    lines.push(`DTSTART;TZID=Europe/Berlin:${timeStamp(opts.startDate, opts.startTime!)}`);
    if (opts.endTime) {
      lines.push(`DTEND;TZID=Europe/Berlin:${timeStamp(opts.endDate || opts.startDate, opts.endTime)}`);
    } else {
      lines.push('DURATION:PT1H');
    }
  }
  lines.push(`SUMMARY:${icsEscape(opts.summary)}`);
  if (opts.location) lines.push(`LOCATION:${icsEscape(opts.location)}`);
  if (opts.description) lines.push(`DESCRIPTION:${icsEscape(opts.description)}`);
  if (opts.category) lines.push(`CATEGORIES:${icsEscape(opts.category)}`);
  lines.push('END:VEVENT');
  return lines;
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'X-LIC-LOCATION:Europe/Berlin',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || '';

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const restHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    };

    const tokenRes = await fetch(`${supabaseUrl}/rest/v1/ics_feed_token?select=token&id=eq.true`, { headers: restHeaders });
    const tokenRows = await tokenRes.json();
    const validToken = tokenRows?.[0]?.token;
    if (!validToken || !token || token !== validToken) {
      return new Response('Ungueltiger oder fehlender Token', { status: 403, headers: corsHeaders });
    }

    const [termineRes, plansRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/termine?select=*`, { headers: restHeaders }),
      fetch(`${supabaseUrl}/rest/v1/plans?select=id,name,datum,is_base,tage&is_base=eq.false&datum=not.is.null`, { headers: restHeaders }),
    ]);
    const termine: Termin[] = await termineRes.json();
    const plans: Plan[] = await plansRes.json();

    const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Dirigentenschule//Kalender//DE',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Dirigentenschule',
      'X-WR-TIMEZONE:Europe/Berlin',
      ...VTIMEZONE,
    ];

    for (const t of termine || []) {
      lines.push(...buildEvent({
        uid: `termin-${t.id}@dirigentenschule`,
        dtstamp,
        allDay: !t.uhrzeit,
        startDate: t.datum,
        startTime: t.uhrzeit,
        endDate: t.bis_datum || t.datum,
        endTime: t.bis_uhrzeit,
        summary: t.titel,
        location: t.ort,
        description: t.beschreibung,
        category: KAT_LABELS[t.kategorie] || t.kategorie,
      }));
    }

    for (const p of plans || []) {
      if (!p.datum) continue;
      const tage = p.tage || 'fr_sa';
      let von = p.datum, bis = p.datum;
      if (tage === 'fr_sa') von = addDays(p.datum, -1);
      lines.push(...buildEvent({
        uid: `treffen-${p.id}@dirigentenschule`,
        dtstamp,
        allDay: true,
        startDate: von,
        endDate: bis,
        summary: p.name ? `Treffen ${p.name}` : 'Treffen',
        category: 'Treffen',
      }));
    }

    lines.push('END:VCALENDAR');
    const body = lines.map(foldLine).join('\r\n') + '\r\n';

    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="dirigentenschule.ics"',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (e) {
    return new Response('Fehler: ' + String(e), { status: 500, headers: corsHeaders });
  }
});
