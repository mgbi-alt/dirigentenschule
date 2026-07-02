# Erzeugt aus hk_hausaufgaben_harmonielehre-export.csv das Seed-SQL fuer die
# Musiktheorie-Hausaufgaben (theory_meetings HK 1..n, theory_tasks, theory_status).
# Ja -> erledigt=true, Nein -> erledigt=false, "-"/leer -> kein Eintrag (nicht relevant).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$csv  = Join-Path $root 'hk_hausaufgaben_harmonielehre-export.csv'
$out  = Join-Path $root 'seed_musiktheorie_ha.sql'
$rows = Import-Csv -Path $csv

# Aufgaben-Spalten: ha_HK_<kapitel>A<nummer>  (ohne _raw / SUM)
$taskCols = $rows[0].PSObject.Properties.Name | Where-Object { $_ -match '^ha_HK_(\d+)A(\d+)$' }
$tasks = foreach ($c in $taskCols) {
  if ($c -match '^ha_HK_(\d+)A(\d+)$') {
    [pscustomobject]@{ Col=$c; HK=[int]$Matches[1]; A=[int]$Matches[2] }
  }
}
$tasks    = $tasks | Sort-Object HK, A
$chapters = $tasks | Select-Object -ExpandProperty HK -Unique | Sort-Object

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('-- ============================================================')
[void]$sb.AppendLine('--  Seed: Musiktheorie-Hausaufgaben (aus hk_hausaufgaben_harmonielehre-export.csv)')
[void]$sb.AppendLine('--  Idempotent: Treffen/Aufgaben nur anlegen wenn fehlend, Status als upsert.')
[void]$sb.AppendLine('--  Datum 1900-01-01 = Platzhalter (in der App ausgeblendet).')
[void]$sb.AppendLine('-- ============================================================')
[void]$sb.AppendLine('')

# 1) Treffen (Kapitel)
[void]$sb.AppendLine('-- 1) Treffen (Kapitel HK 1..n)')
foreach ($hk in $chapters) {
  [void]$sb.AppendLine("insert into theory_meetings (datum, titel, sort) select '1900-01-01','HK $hk',$hk where not exists (select 1 from theory_meetings where titel='HK $hk');")
}
[void]$sb.AppendLine('')

# 2) Aufgaben je Kapitel (gleich gewichtet: 1)
[void]$sb.AppendLine('-- 2) Aufgaben je Treffen (gleich gewichtet)')
foreach ($t in $tasks) {
  [void]$sb.AppendLine("insert into theory_tasks (meeting_id, bezeichnung, gewicht, sort) select m.id,'Aufgabe $($t.A)',1,$($t.A) from theory_meetings m where m.titel='HK $($t.HK)' and not exists (select 1 from theory_tasks tk where tk.meeting_id=m.id and tk.sort=$($t.A));")
}
[void]$sb.AppendLine('')

# 3) Status je Schueler
$vals = New-Object System.Collections.Generic.List[string]
foreach ($r in $rows) {
  $legacy = ($r.user_raw).Trim()
  if (-not $legacy) { continue }
  foreach ($t in $tasks) {
    $v = ("" + $r.($t.Col)).Trim()
    if ($v -eq 'Ja')       { $vals.Add("('$legacy',$($t.HK),$($t.A),true)") }
    elseif ($v -eq 'Nein') { $vals.Add("('$legacy',$($t.HK),$($t.A),false)") }
    # '-' oder leer -> ueberspringen
  }
}
[void]$sb.AppendLine('-- 3) Status (Ja=true, Nein=false). "-"/leer wird nicht importiert.')
if ($vals.Count -gt 0) {
  [void]$sb.AppendLine('insert into theory_status (task_id, person_id, erledigt)')
  [void]$sb.AppendLine('select tk.id, p.id, v.erledigt')
  [void]$sb.AppendLine('from (values')
  [void]$sb.AppendLine('  ' + ($vals -join ",`r`n  "))
  [void]$sb.AppendLine(') as v(legacy, hk, a, erledigt)')
  [void]$sb.AppendLine("join theory_meetings m on m.titel = 'HK ' || v.hk")
  [void]$sb.AppendLine('join theory_tasks tk on tk.meeting_id = m.id and tk.sort = v.a')
  [void]$sb.AppendLine('join people p on p.legacy_id::text = v.legacy')
  [void]$sb.AppendLine('on conflict (task_id, person_id) do update set erledigt = excluded.erledigt;')
}

$sb.ToString() | Out-File -FilePath $out -Encoding utf8
Write-Host "Geschrieben: $out"
Write-Host "Kapitel: $($chapters -join ', ')"
Write-Host "Aufgaben gesamt: $($tasks.Count)  Status-Zeilen: $($vals.Count)"
