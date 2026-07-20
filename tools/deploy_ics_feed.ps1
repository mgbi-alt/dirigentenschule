# Einmaliges Setup/Update fuer die Edge Function "ics-feed", die den
# ICS-Kalenderabo-Link (Google/Apple Kalender) im Kalender-Tab der App bedient.
# Laedt bei Bedarf die Supabase-CLI herunter, verknuepft das Projekt und deployt die
# Funktion.
#
# WICHTIG: Vorher Migration supabase_migration_v28.sql im Supabase SQL-Editor
# ausfuehren (legt Tabelle ics_feed_token an) -- ohne die Tabelle antwortet die
# Funktion mit "Ungueltiger oder fehlender Token".
#
# Aufruf (Variable setzen, dann Skript starten):
#   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."   # https://supabase.com/dashboard/account/tokens -> Generate new token
#   powershell -ExecutionPolicy Bypass -File .\tools\deploy_ics_feed.ps1
#
# Der service_role-Key muss NICHT separat gesetzt werden -- Supabase stellt ihn jeder
# Edge Function automatisch als SUPABASE_SERVICE_ROLE_KEY bereit.
#
# Der Access Token ist hochsensibel: niemals committen, niemals an Dritte weitergeben.
# Am besten das Terminal danach schliessen, damit er aus dem Speicher verschwindet.

$ErrorActionPreference = 'Stop'
$ProjectRef = 'dfhrtfzmhwxnrxlbejvr'

if (-not $env:SUPABASE_ACCESS_TOKEN) { Write-Error "SUPABASE_ACCESS_TOKEN ist nicht gesetzt. Siehe Kopf des Skripts."; exit 1 }

$ToolsDir = $PSScriptRoot
$CliDir   = Join-Path $ToolsDir '.supabase-cli'
$CliExe   = Join-Path $CliDir 'supabase.exe'

if (-not (Test-Path $CliExe)) {
    Write-Host "Supabase-CLI wird einmalig heruntergeladen..."
    New-Item -ItemType Directory -Force -Path $CliDir | Out-Null
    $tarPath = Join-Path $CliDir 'supabase_windows_amd64.tar.gz'
    & gh release download --repo supabase/cli --pattern "supabase_windows_amd64.tar.gz" --dir $CliDir --clobber
    if ($LASTEXITCODE -ne 0) { Write-Error "Download fehlgeschlagen (ist die GitHub-CLI 'gh' installiert und eingeloggt?)"; exit 1 }
    if (-not (Test-Path $tarPath)) { Write-Error "Download-Datei nicht gefunden: $tarPath"; exit 1 }
    tar -xzf $tarPath -C $CliDir
}

$RepoRoot = Split-Path $ToolsDir -Parent
Push-Location $RepoRoot
try {
    Write-Host "`nVerknuepfe Projekt..."
    & $CliExe link --project-ref $ProjectRef
    if ($LASTEXITCODE -ne 0) { throw "Link fehlgeschlagen" }

    Write-Host "`nDeploye Funktion 'ics-feed'..."
    & $CliExe functions deploy ics-feed --no-verify-jwt
    if ($LASTEXITCODE -ne 0) { throw "Deploy fehlgeschlagen" }

    Write-Host "`nFertig! Die Abo-URL erscheint jetzt im Kalender-Tab der App (Feld 'Kalender abonnieren')."
} finally {
    Pop-Location
}
