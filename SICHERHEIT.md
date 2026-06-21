# Sicherheit – Dirigentenschule

## Was abgesichert ist
- **HTTPS** überall (GitHub Pages + Supabase).
- Der **anon-Key** in `js/config.js` ist öffentlich gedacht – kein Geheimnis. Kein `service_role`-Key im Code.
- Personenbezogene Rohdaten (CSV/Seed) sind per `.gitignore` aus dem Repo ausgeschlossen.
- **RLS (Migration v13):** Rollen/Rechte werden jetzt in der Datenbank durchgesetzt, nicht nur in der App:
  - Schüler sehen nur **eigene** Übezeiten/Tests/Noten; Lehrer/Klassenleitung/Admin alles.
  - Schreiben nur mit passender Rolle/Recht (z. B. Noten nur mit Recht „Gesamtbewertung").
  - **Niemand kann seine eigene Rolle hochstufen** (Trigger `people_guard`), „Ferien" nur Admin (`practice_guard`).
- **XSS-Schutz:** Info-HTML wird beim Anzeigen bereinigt (`sanitizeHtml`).

## Pflicht-Schritte im Supabase-Dashboard (einmalig)
1. **Migration ausführen:** `supabase_migration_v13_security.sql` im SQL-Editor.
2. **Registrierung deaktivieren:** Authentication → Providers → **Email** → „Allow new users to sign up" = **AUS**.
   (Sonst könnte sich jeder registrieren und hätte – trotz RLS – Lese-/Schreibrechte im Rahmen seiner Rolle.)
3. **E-Mail-Bestätigung / starke Passwörter:** Authentication → Policies – „Confirm email" an, ggf. „Leaked password protection" aktivieren.

## Empfohlen (optional)
- **Storage-Bucket `docs`:** ist „public" – PDFs/Fotos sind über die (zufällige) URL abrufbar.
  Bei sensiblen Inhalten auf **privaten Bucket + signierte Links** umstellen.
- **Backups:** Regelmäßig die DB sichern (Supabase → Database → Backups; auf Free-Tier ggf. manuell per Export).
- Mindestens **zwei Admins**, damit kein Aussperren passiert.

## Wichtig nach v13
- Jeder Login muss einer **Person** mit der passenden **E-Mail** und **Rolle** zugeordnet sein,
  sonst sieht/darf der Nutzer (korrekterweise) nichts. Beim ersten Login wird die Person über die
  E-Mail gefunden und die `auth_id` automatisch gesetzt.
- Test nach dem Einspielen: einmal als normaler Schüler einloggen und prüfen, dass nur eigene
  Daten sichtbar sind und Bearbeiten gesperrt ist.
