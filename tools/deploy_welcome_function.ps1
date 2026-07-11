# Einmaliges Setup/Update fuer die Edge Function "set-welcome-password", die den
# "Willkommensmail"-Button in der Admin-Personenverwaltung bedient (js/app.js).
# Laedt bei Bedarf die Supabase-CLI herunter, verknuepft das Projekt und deployt die
# Funktion inkl. des benoetigten Secrets.
#
# Aufruf (in diesem Fenster BEIDE Variablen setzen, dann Skript starten):
#   $env:SUPABASE_ACCESS_TOKEN    = "sbp_..."   # https://supabase.com/dashboard/account/tokens -> Generate new token
#   $env:SUPABASE_SERVICE_ROLE_KEY = "eyJ..."   # Supabase Dashboard -> Project Settings -> API -> service_role (GEHEIM!)
#   powershell -ExecutionPolicy Bypass -File .\tools\deploy_welcome_function.ps1
#
# Beide Werte sind hochsensibel: niemals committen, niemals an Dritte weitergeben.
# Am besten das Terminal danach schliessen, damit sie aus dem Speicher verschwinden.

$ErrorActionPreference = 'Stop'
$ProjectRef = 'dfhrtfzmhwxnrxlbejvr'

if (-not $env:SUPABASE_ACCESS_TOKEN) { Write-Error "SUPABASE_ACCESS_TOKEN ist nicht gesetzt. Siehe Kopf des Skripts."; exit 1 }
if (-not $env:SUPABASE_SERVICE_ROLE_KEY) { Write-Error "SUPABASE_SERVICE_ROLE_KEY ist nicht gesetzt. Siehe Kopf des Skripts."; exit 1 }

$ToolsDir = $PSScriptRoot
$CliDir   = Join-Path $ToolsDir '.supabase-cli'
$CliExe   = Join-Path $CliDir 'supabase.exe'

if (-not (Test-Path $CliExe)) {
    Write-Host "Supabase-CLI wird einmalig heruntergeladen..."
    New-Item -ItemType Directory -Force -Path $CliDir | Out-Null
    $tarPath = Join-Path $CliDir 'supabase.tar.gz'
    & gh release download --repo supabase/cli --pattern "supabase_windows_amd64.tar.gz" --dir $CliDir --clobber
    if ($LASTEXITCODE -ne 0) { Write-Error "Download fehlgeschlagen (ist die GitHub-CLI 'gh' installiert und eingeloggt?)"; exit 1 }
    tar -xzf $tarPath -C $CliDir
}

$RepoRoot = Split-Path $ToolsDir -Parent
Push-Location $RepoRoot
try {
    Write-Host "`nVerknuepfe Projekt..."
    & $CliExe link --project-ref $ProjectRef
    if ($LASTEXITCODE -ne 0) { throw "Link fehlgeschlagen" }

    Write-Host "`nDeploye Funktion 'set-welcome-password'..."
    & $CliExe functions deploy set-welcome-password
    if ($LASTEXITCODE -ne 0) { throw "Deploy fehlgeschlagen" }

    Write-Host "`nSetze Secret SUPABASE_SERVICE_ROLE_KEY fuer die Funktion..."
    & $CliExe secrets set "SUPABASE_SERVICE_ROLE_KEY=$($env:SUPABASE_SERVICE_ROLE_KEY)"
    if ($LASTEXITCODE -ne 0) { throw "Secret setzen fehlgeschlagen" }

    Write-Host "`nFertig! Der Willkommensmail-Button in der App sollte jetzt funktionieren."
} finally {
    Pop-Location
}
