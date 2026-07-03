# Erzeugt das Seed-SQL fuer die Musiktheorie-Hausaufgaben, gekoppelt an die
# allgemeinen Treffen (plans, is_base=false). Kombiniert:
#   - tools/musiktheorie_aufgaben.json : Kapitel->Monat-Zuordnung + Aufgabentexte
#   - hk_hausaufgaben_harmonielehre-export.csv : Ja/Nein-Status je Schueler
#
# Zuordnung Kapitel -> Treffen: to_char(plans.datum,'YYYY-MM') = monat und is_base=false.
# Mai-Konflikt: HK9 = regulaeres Treffen (tage <> 'fr'), HK10 = Zusatz-Freitag (tage = 'fr').
# Ja -> erledigt=true, Nein -> erledigt=false, "-"/leer -> kein Eintrag.
# Idempotent: Treffen via unique index theory_meetings.plan_id, Aufgaben via (meeting_id,sort),
#             Status via upsert on conflict (task_id, person_id).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$json = Join-Path $PSScriptRoot 'musiktheorie_aufgaben.json'
$csv  = Join-Path $root 'hk_hausaufgaben_harmonielehre-export.csv'
$out  = Join-Path $root 'seed_musiktheorie_ha.sql'

$data = (Get-Content -Path $json -Raw -Encoding UTF8 | ConvertFrom-Json).chapters
$rows = Import-Csv -Path $csv

function Q([string]$s) { "'" + ($s -replace "'", "''") + "'" }

# tage-Filter je Kapitel (nur Mai ist mehrdeutig)
function TageFilter($ch) {
  if ($ch.hk -eq 9)  { return "p.tage <> 'fr'" }   # regulaeres Mai-Treffen
  if ($ch.hk -eq 10) { return "p.tage = 'fr'"  }   # Zusatz-Freitag im Mai
  return $null
}
function PlanWhere($ch) {
  $w = "to_char(p.datum,'YYYY-MM') = '$($ch.monat)' and p.is_base = false"
  $tf = TageFilter $ch
  if ($tf) { $w += " and $tf" }
  return $w
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('-- ============================================================')
[void]$sb.AppendLine('--  Seed: Musiktheorie-Hausaufgaben (Treffen-basiert, aus JSON + CSV)')
[void]$sb.AppendLine('--  Kapitel an die allgemeinen Treffen (plans) gekoppelt (Match per Monat).')
[void]$sb.AppendLine('--  Idempotent; nach Migration v17 ausfuehren.')
[void]$sb.AppendLine('-- ============================================================')
[void]$sb.AppendLine('')

# 1) Treffen: je Kapitel ein theory_meeting mit plan_id des passenden Treffens
[void]$sb.AppendLine('-- 1) Treffen je Kapitel (plan_id = passendes allgemeines Treffen)')
foreach ($ch in $data) {
  $where = PlanWhere $ch
  [void]$sb.AppendLine("insert into theory_meetings (plan_id, datum, titel, sort)")
  [void]$sb.AppendLine("select p.id, p.datum, p.name, $($ch.hk) from plans p")
  [void]$sb.AppendLine("where $where")
  [void]$sb.AppendLine("  and not exists (select 1 from theory_meetings tm where tm.plan_id = p.id);")
}
[void]$sb.AppendLine('')

# 2) Aufgaben je Kapitel mit den echten Beschreibungstexten (gleich gewichtet)
[void]$sb.AppendLine('-- 2) Aufgaben je Treffen (bezeichnung = Aufgabentext, gewicht = 1)')
foreach ($ch in $data) {
  $where = PlanWhere $ch
  $a = 0
  foreach ($task in $ch.tasks) {
    $a++
    [void]$sb.AppendLine("insert into theory_tasks (meeting_id, bezeichnung, gewicht, sort)")
    [void]$sb.AppendLine("select tm.id, $(Q $task), 1, $a from theory_meetings tm")
    [void]$sb.AppendLine("join plans p on p.id = tm.plan_id where $where")
    [void]$sb.AppendLine("  and not exists (select 1 from theory_tasks t where t.meeting_id = tm.id and t.sort = $a);")
  }
}
[void]$sb.AppendLine('')

# 3) Status je Schueler (Ja/Nein aus CSV). Aufgaben-Spalten ha_HK_<hk>A<a>.
$taskCols = $rows[0].PSObject.Properties.Name | Where-Object { $_ -match '^ha_HK_(\d+)A(\d+)$' }
$tasks = foreach ($c in $taskCols) {
  if ($c -match '^ha_HK_(\d+)A(\d+)$') { [pscustomobject]@{ Col=$c; HK=[int]$Matches[1]; A=[int]$Matches[2] } }
}
$vals = New-Object System.Collections.Generic.List[string]
foreach ($r in $rows) {
  $legacy = ("" + $r.user_raw).Trim()
  if (-not $legacy) { continue }
  foreach ($t in $tasks) {
    $v = ("" + $r.($t.Col)).Trim()
    if ($v -eq 'Ja')       { $vals.Add("('$legacy',$($t.HK),$($t.A),true)") }
    elseif ($v -eq 'Nein') { $vals.Add("('$legacy',$($t.HK),$($t.A),false)") }
    # '-' oder leer -> ueberspringen
  }
}

# hk -> (monat, tage_key) Lookup fuer die Status-Zuordnung (tage_key: any|fr|nfr)
$hkmap = foreach ($ch in $data) {
  $key = 'any'
  if ($ch.hk -eq 9)  { $key = 'nfr' }
  if ($ch.hk -eq 10) { $key = 'fr'  }
  "($($ch.hk),'$($ch.monat)','$key')"
}

[void]$sb.AppendLine('-- 3) Status (Ja=true, Nein=false). "-"/leer wird nicht importiert.')
if ($vals.Count -gt 0) {
  [void]$sb.AppendLine('with hkmap(hk, monat, tage_key) as (values')
  [void]$sb.AppendLine('  ' + ($hkmap -join ', '))
  [void]$sb.AppendLine(')')
  [void]$sb.AppendLine('insert into theory_status (task_id, person_id, erledigt)')
  [void]$sb.AppendLine('select tk.id, pe.id, v.erledigt')
  [void]$sb.AppendLine('from (values')
  [void]$sb.AppendLine('  ' + ($vals -join ",`r`n  "))
  [void]$sb.AppendLine(') as v(legacy, hk, a, erledigt)')
  [void]$sb.AppendLine('join hkmap hm on hm.hk = v.hk')
  [void]$sb.AppendLine("join plans p on to_char(p.datum,'YYYY-MM') = hm.monat and p.is_base = false")
  [void]$sb.AppendLine("  and (hm.tage_key = 'any' or (hm.tage_key = 'fr' and p.tage = 'fr') or (hm.tage_key = 'nfr' and p.tage <> 'fr'))")
  [void]$sb.AppendLine('join theory_meetings tm on tm.plan_id = p.id')
  [void]$sb.AppendLine('join theory_tasks tk on tk.meeting_id = tm.id and tk.sort = v.a')
  [void]$sb.AppendLine('join people pe on pe.legacy_id::text = v.legacy')
  [void]$sb.AppendLine('on conflict (task_id, person_id) do update set erledigt = excluded.erledigt;')
}
[void]$sb.AppendLine('')

# 4) Diagnose: Kapitel, fuer die kein Treffen gefunden wurde
[void]$sb.AppendLine('-- 4) Diagnose: Monate ohne passendes allgemeines Treffen (sollte leer sein)')
$diag = foreach ($ch in $data) {
  $key = 'any'
  if ($ch.hk -eq 9)  { $key = 'nfr' }
  if ($ch.hk -eq 10) { $key = 'fr'  }
  "($($ch.hk),'$($ch.monat)','$key')"
}
[void]$sb.AppendLine('with hkmap(hk, monat, tage_key) as (values')
[void]$sb.AppendLine('  ' + ($diag -join ', '))
[void]$sb.AppendLine(')')
[void]$sb.AppendLine('select hm.hk, hm.monat from hkmap hm where not exists (')
[void]$sb.AppendLine("  select 1 from plans p where to_char(p.datum,'YYYY-MM') = hm.monat and p.is_base = false")
[void]$sb.AppendLine("    and (hm.tage_key = 'any' or (hm.tage_key = 'fr' and p.tage = 'fr') or (hm.tage_key = 'nfr' and p.tage <> 'fr')))")
[void]$sb.AppendLine('order by hm.hk;')

$sb.ToString() | Out-File -FilePath $out -Encoding utf8
Write-Host "Geschrieben: $out"
Write-Host "Kapitel: $(($data | ForEach-Object { $_.hk }) -join ', ')"
Write-Host "Aufgaben gesamt: $(($data | ForEach-Object { $_.tasks.Count } | Measure-Object -Sum).Sum)  Status-Zeilen: $($vals.Count)"
