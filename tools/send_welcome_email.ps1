# Setzt fuer EINE Person aus "people" ein neues Zufallspasswort (legt den Auth-Account
# an, falls er noch nicht existiert) und oeffnet dein Standard-Mailprogramm mit einer
# vorausgefuellten Willkommensmail inkl. Benutzername + Passwort. Du pruefst den Text
# kurz und klickst selbst auf Senden -- es wird NICHTS automatisch verschickt.
#
# Aufruf:
#   $env:SUPABASE_SERVICE_ROLE_KEY = "xxx"   # Supabase Dashboard -> Project Settings -> API -> service_role (GEHEIM!)
#   .\tools\send_welcome_email.ps1 -Email "vorname.nachname@example.com"
#
# Die service_role-Taste NIEMALS committen oder in eine Datei im Repo schreiben.

param(
    [Parameter(Mandatory = $true)]
    [string]$Email
)

$ErrorActionPreference = 'Stop'

$SupabaseUrl = 'https://dfhrtfzmhwxnrxlbejvr.supabase.co'
$AppUrl      = 'https://mgbi-alt.github.io/dirigentenschule/'

$ServiceKey = $env:SUPABASE_SERVICE_ROLE_KEY
if (-not $ServiceKey) {
    Write-Error "SUPABASE_SERVICE_ROLE_KEY ist nicht gesetzt. Siehe Kopf des Skripts."
    exit 1
}
$AuthHeaders = @{ apikey = $ServiceKey; Authorization = "Bearer $ServiceKey" }

function New-StrongPassword {
    $upper   = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    $lower   = 'abcdefghijkmnpqrstuvwxyz'
    $digits  = '23456789'
    $special = '!@#$%&*?-'
    $all     = $upper + $lower + $digits + $special
    $rnd = [System.Random]::new()
    $chars = @(
        $upper[$rnd.Next($upper.Length)]
        $lower[$rnd.Next($lower.Length)]
        $digits[$rnd.Next($digits.Length)]
        $special[$rnd.Next($special.Length)]
    )
    for ($i = 0; $i -lt 8; $i++) { $chars += $all[$rnd.Next($all.Length)] }
    -join ($chars | Sort-Object { $rnd.Next() })
}

# Person in "people" suchen (service_role umgeht RLS)
$peopleUrl = "$SupabaseUrl/rest/v1/people?select=id,vorname,nachname,email&email=eq.$([uri]::EscapeDataString($Email))"
$matches = Invoke-RestMethod -Uri $peopleUrl -Headers $AuthHeaders
if (-not $matches -or $matches.Count -eq 0) {
    Write-Error "Keine Person mit E-Mail '$Email' in der Tabelle 'people' gefunden. Bitte zuerst in der Benutzerverwaltung anlegen."
    exit 1
}
$person = $matches[0]
$pw = New-StrongPassword

# Bestehenden Auth-User suchen (Seiten durchgehen, falls mehr als 1000 Nutzer -- unwahrscheinlich hier)
$existing = $null
$usersResp = Invoke-RestMethod -Uri "$SupabaseUrl/auth/v1/admin/users?page=1&per_page=1000" -Headers $AuthHeaders
$existing = $usersResp.users | Where-Object { $_.email -eq $Email } | Select-Object -First 1

if ($existing) {
    $body = @{ password = $pw } | ConvertTo-Json
    Invoke-RestMethod -Method Put -Uri "$SupabaseUrl/auth/v1/admin/users/$($existing.id)" `
        -Headers $AuthHeaders -ContentType 'application/json' -Body $body | Out-Null
    Write-Host "Bestehender Account aktualisiert: neues Passwort gesetzt."
} else {
    $body = @{ email = $Email; password = $pw; email_confirm = $true } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$SupabaseUrl/auth/v1/admin/users" `
        -Headers $AuthHeaders -ContentType 'application/json' -Body $body | Out-Null
    Write-Host "Neuer Account angelegt."
}

$vorname = $person.vorname
if (-not $vorname) { $vorname = $person.nachname }

$subject = "Willkommen bei der Dirigentenschule - deine Zugangsdaten"
$body = @"
Hallo $vorname,

herzlich willkommen bei der Dirigentenschule! Du kannst dich ab sofort mit folgenden Zugangsdaten in der App anmelden:

App-Link: $AppUrl
Benutzername (E-Mail): $Email
Passwort: $pw

Bitte melde dich damit an und vergib dir danach ueber "Passwort aendern" im Menue ein eigenes, nur dir bekanntes Passwort.

Bei Fragen melde dich gerne jederzeit.

Viele Gruesse
"@

Write-Host "`n--- Vorschau ---"
Write-Host "An: $Email"
Write-Host "Betreff: $subject"
Write-Host $body
Write-Host "----------------`n"

$mailto = "mailto:$([uri]::EscapeDataString($Email))?subject=$([uri]::EscapeDataString($subject))&body=$([uri]::EscapeDataString($body))"
Start-Process $mailto
Write-Host "Mailprogramm wurde mit vorausgefuelltem Entwurf geoeffnet. Bitte pruefen und selbst auf Senden klicken."
