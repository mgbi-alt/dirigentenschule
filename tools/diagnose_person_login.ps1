# Diagnose fuer "Person X sieht andere Rechte als in der Ansicht-als-Vorschau".
# Prueft: gibt es mehrere people-Eintraege mit dieser E-Mail? Gibt es mehrere
# Auth-Accounts mit dieser E-Mail? Ist people.auth_id korrekt mit dem Auth-Account
# verknuepft?
#
# Aufruf:
#   $env:SUPABASE_SERVICE_ROLE_KEY = "xxx"   # Supabase Dashboard -> Project Settings -> API -> service_role (GEHEIM!)
#   powershell -ExecutionPolicy Bypass -File .\tools\diagnose_person_login.ps1 -Email "andreas.suckau@example.com"

param(
    [Parameter(Mandatory = $true)]
    [string]$Email
)

$ErrorActionPreference = 'Stop'
$SupabaseUrl = 'https://dfhrtfzmhwxnrxlbejvr.supabase.co'

$ServiceKey = $env:SUPABASE_SERVICE_ROLE_KEY
if (-not $ServiceKey) {
    Write-Error "SUPABASE_SERVICE_ROLE_KEY ist nicht gesetzt. Siehe Kopf des Skripts."
    exit 1
}
$Headers = @{ apikey = $ServiceKey; Authorization = "Bearer $ServiceKey" }
$EmailLower = $Email.ToLower()

Write-Host "=== people-Eintraege mit dieser E-Mail (Gross-/Kleinschreibung egal) ===" -ForegroundColor Cyan
$peopleUrl = "$SupabaseUrl/rest/v1/people?select=id,vorname,nachname,email,auth_id,roles,rolle,permissions,aktiv&email=ilike.$([uri]::EscapeDataString($Email))"
$people = Invoke-RestMethod -Uri $peopleUrl -Headers $Headers
if (-not $people -or $people.Count -eq 0) {
    Write-Warning "Kein people-Eintrag mit dieser E-Mail gefunden."
} else {
    $people | Format-List
    if ($people.Count -gt 1) {
        Write-Warning "ACHTUNG: $($people.Count) Eintraege mit dieser E-Mail gefunden -- das ist vermutlich die Ursache!"
    }
}

Write-Host "`n=== Auth-Accounts (auth.users) mit dieser E-Mail ===" -ForegroundColor Cyan
$authUsers = @()
for ($page = 1; $page -le 20; $page++) {
    $resp = Invoke-RestMethod -Uri "$SupabaseUrl/auth/v1/admin/users?page=$page&per_page=1000" -Headers $Headers
    $authUsers += $resp.users | Where-Object { $_.email -and $_.email.ToLower() -eq $EmailLower }
    if ($resp.users.Count -lt 1000) { break }
}
if ($authUsers.Count -eq 0) {
    Write-Warning "Kein Auth-Account mit dieser E-Mail gefunden."
} else {
    $authUsers | Select-Object id, email, created_at, last_sign_in_at, confirmed_at | Format-List
    if ($authUsers.Count -gt 1) {
        Write-Warning "ACHTUNG: $($authUsers.Count) Auth-Accounts mit dieser E-Mail gefunden -- das erklaert unterschiedliches Verhalten je nachdem, mit welchem Account man sich einloggt!"
    }
}

Write-Host "`n=== Abgleich: zeigt people.auth_id auf einen existierenden, passenden Auth-Account? ===" -ForegroundColor Cyan
foreach ($p in $people) {
    if (-not $p.auth_id) {
        Write-Host "Person $($p.id) ($($p.vorname) $($p.nachname)): auth_id ist NULL -- wird beim naechsten Login automatisch gesetzt (per E-Mail-Match)." -ForegroundColor Yellow
        continue
    }
    $match = $authUsers | Where-Object { $_.id -eq $p.auth_id }
    if ($match) {
        Write-Host "Person $($p.id) ($($p.vorname) $($p.nachname)): auth_id passt zu Auth-Account $($match.email) -- OK" -ForegroundColor Green
    } else {
        Write-Warning "Person $($p.id) ($($p.vorname) $($p.nachname)): auth_id ($($p.auth_id)) passt zu KEINEM der gefundenen Auth-Accounts!"
    }
}
