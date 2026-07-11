// Edge Function: set-welcome-password
//
// Wird vom Admin-Button "Willkommensmail" in der App aufgerufen (js/app.js).
// Prueft, dass der Aufrufer eingeloggter Admin ist, setzt dann fuer die angegebene
// Person ein neues Zufallspasswort (legt den Auth-Account an, falls er noch nicht
// existiert) und gibt das Passwort an den Browser zurueck. Der Browser oeffnet damit
// nur einen Mail-Entwurf im Mailprogramm des Admins -- es wird hier NICHTS
// automatisch per Mail verschickt.
//
// Benoetigte Secrets (per `supabase secrets set`, siehe README):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   (die ersten beiden setzt Supabase bei Edge Functions automatisch)

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function genPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*?-';
  const all = upper + lower + digits + special;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  for (let i = 0; i < 8; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Nicht eingeloggt' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Client im Namen des Aufrufers -> Identitaet + Rolle ueber RLS pruefen
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Nicht eingeloggt' }, 401);

    const { data: me } = await callerClient
      .from('people').select('roles,rolle')
      .or(`auth_id.eq.${user.id},email.eq.${user.email}`)
      .limit(1).maybeSingle();
    const roles: string[] = me?.roles?.length ? me.roles : (me?.rolle ? [me.rolle] : []);
    if (!roles.includes('admin')) return json({ error: 'Nur fuer Admins' }, 403);

    const { email } = await req.json();
    if (!email || typeof email !== 'string') return json({ error: 'email fehlt' }, 400);

    // Ab hier mit service_role -> umgeht RLS, volle Admin-Rechte
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: person } = await admin
      .from('people').select('id,vorname,nachname,email')
      .eq('email', email).limit(1).maybeSingle();
    if (!person) return json({ error: 'Person mit dieser E-Mail nicht gefunden' }, 404);

    const password = genPassword();

    const emailLower = email.toLowerCase();
    let userId: string | null = null;
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (listErr) break;
      const found = list.users.find((u) => (u.email || '').toLowerCase() === emailLower);
      if (found) userId = found.id;
      if (list.users.length < 1000) break;
    }

    if (userId) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: error.message }, 500);
    } else {
      const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) {
        if (/already.*registered/i.test(error.message)) {
          return json({ error: 'Konnte den bestehenden Account nicht eindeutig finden (E-Mail-Schreibweise?). Bitte in Supabase (Authentication -> Users) pruefen.' }, 500);
        }
        return json({ error: error.message }, 500);
      }
    }

    return json({ email, vorname: person.vorname || person.nachname, password });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
