# Legt fuer alle Personen aus der Tabelle "people" (die eine E-Mail-Adresse haben,
# aber noch keinen Supabase-Auth-Account) einen Login mit Zufallspasswort an.
# Verknuepfung zu people.auth_id passiert automatisch beim ersten Login (js/app.js).
#
# Aufruf:
#   $env:SUPABASE_SERVICE_ROLE_KEY = "xxx"   # aus Supabase Dashboard -> Project Settings -> API -> service_role (GEHEIM!)
#   .\tools\create_auth_users.ps1
#
# Die service_role-Taste NIEMALS committen oder in eine Datei im Repo schreiben.
# Das Ergebnis (E-Mail + Initialpasswort) wird am Ende als Tabelle ausgegeben und
# zusaetzlich nach tools\auth-users-export.csv geschrieben (per .gitignore ausgeschlossen).

$ErrorActionPreference = 'Stop'

$SupabaseUrl = 'https://dfhrtfzmhwxnrxlbejvr.supabase.co'
$AnonKey     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmaHJ0ZnptaHd4bnJ4bGJlanZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4OTM3NzgsImV4cCI6MjA5NzQ2OTc3OH0.J-SKn8ZpEG3GQLQMXC_zzkCFwJ0Chy2iTrSNiP4d38g'

$ServiceKey = $env:SUPABASE_SERVICE_ROLE_KEY
if (-not $ServiceKey) {
    Write-Error "SUPABASE_SERVICE_ROLE_KEY ist nicht gesetzt. Siehe Kopf des Skripts."
    exit 1
}

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

# Personen mit E-Mail-Adresse laden (anon key reicht, people ist per RLS lesbar)
$peopleUrl = "$SupabaseUrl/rest/v1/people?select=id,vorname,nachname,email,aktiv&email=not.is.null"
$people = Invoke-RestMethod -Uri $peopleUrl -Headers @{ apikey = $AnonKey; Authorization = "Bearer $AnonKey" }

$results = @()
foreach ($p in $people) {
    $pw = New-StrongPassword
    $body = @{ email = $p.email; password = $pw; email_confirm = $true } | ConvertTo-Json

    try {
        Invoke-RestMethod -Method Post -Uri "$SupabaseUrl/auth/v1/admin/users" `
            -Headers @{ apikey = $ServiceKey; Authorization = "Bearer $ServiceKey" } `
            -ContentType 'application/json' -Body $body | Out-Null
        $status = 'angelegt'
    } catch {
        $err = $_.ErrorDetails.Message
        if ($err -match 'already been registered|already exists') {
            $status = 'existiert bereits (uebersprungen)'
            $pw = ''
        } else {
            $status = "FEHLER: $err"
            $pw = ''
        }
    }

    $results += [pscustomobject]@{
        Name     = "$($p.nachname), $($p.vorname)"
        Email    = $p.email
        Passwort = $pw
        Status   = $status
    }
}

$results | Format-Table -AutoSize
$csvPath = Join-Path $PSScriptRoot 'auth-users-export.csv'
$results | Export-Csv -Path $csvPath -NoTypeInformation -Encoding UTF8
Write-Host "`nExport (mit Klartext-Passwoertern) gespeichert unter: $csvPath"
Write-Host "Diese Datei NICHT committen und nach Verteilung der Passwoerter loeschen."
