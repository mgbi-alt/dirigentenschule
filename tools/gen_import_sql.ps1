# Erzeugt aus den Fabrik-CSV-Exporten eine SQL-Datei fuer Supabase.
# Zuordnung Person via legacy_id (people.legacy_id). Entfernte Schueler werden uebersprungen.
# Dedupliziert pro Person+KW / Person+Monat / Person (jeweils juengster Eintrag gewinnt).
# Aufruf:  powershell -ExecutionPolicy Bypass -File tools\gen_import_sql.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$inv  = [Globalization.CultureInfo]::InvariantCulture
$SKIP = @('232','239')   # entfernte Schueler: Siemens, Klassen

function PNum($s){
  if($null -eq $s){ return $null }
  $t = (($s -replace '[^0-9,.\-]','') -replace ',', '.')
  if($t -eq '' -or $t -eq '-' -or $t -eq '.'){ return $null }
  try { return [double]::Parse($t, $inv) } catch { return $null }
}
function NumSql($n){ if($null -eq $n){ return 'NULL' } else { return ([double]$n).ToString($inv) } }
function DateSql($s){ if([string]::IsNullOrWhiteSpace($s)){ return "NULL::date" } else { return "'" + $s.Substring(0,10) + "'::date" } }
function StrSql($s){ if($null -eq $s){ return 'NULL' } else { return "'" + ($s -replace "'","''") + "'" } }

$out = New-Object System.Collections.Generic.List[string]
$out.Add("-- AUTO-GENERIERT aus den CSV-Exporten. Im Supabase SQL-Editor ausfuehren.")
$out.Add("-- Erzeugt: $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
$out.Add("begin;")
$out.Add("")

# ---------- 1) Hausaufgabenzeiten ----------
$rows = Import-Csv (Join-Path $root 'hk_hausaufgaben_gesamt-export.csv') -Encoding UTF8 | Sort-Object date_time_raw
$map = [ordered]@{}
foreach($r in $rows){
  if($SKIP -contains $r.user_raw){ continue }
  if($r.woche -notmatch '(\d{4}).*?KW\s*(\d+)'){ continue }
  $jahr=[int]$Matches[1]; $kw=[int]$Matches[2]
  $map["$($r.user_raw)|$jahr|$kw"] = "  ($($r.user_raw),$jahr,$kw,$(DateSql $r.date_time),$(NumSql (PNum $r.dirigieren_raw)),$(NumSql (PNum $r.stimmbildung_raw)),$(NumSql (PNum $r.klavier_raw)),$(NumSql (PNum $r.gehoerbildung_raw)))"
}
$vals=@($map.Values)
$out.Add("-- Hausaufgabenzeiten ($($vals.Count))")
$out.Add("insert into practice_times (person_id,jahr,kw,datum,dirigieren,stimmbildung,klavier,gehoerbildung)")
$out.Add("select p.id,v.jahr,v.kw,v.datum,v.dirigieren,v.stimmbildung,v.klavier,v.gehoerbildung from (values")
$out.Add(($vals -join ",`n"))
$out.Add(") as v(legacy_id,jahr,kw,datum,dirigieren,stimmbildung,klavier,gehoerbildung)")
$out.Add("join people p on p.legacy_id=v.legacy_id")
$out.Add("on conflict (person_id,jahr,kw) do update set datum=excluded.datum,dirigieren=excluded.dirigieren,stimmbildung=excluded.stimmbildung,klavier=excluded.klavier,gehoerbildung=excluded.gehoerbildung;")
$out.Add("")

# ---------- 2) Tests (Harmonielehre & Gehoerbildung) ----------
function TestsBlock($file,$fach){
  $rows = Import-Csv (Join-Path $root $file) -Encoding UTF8 | Sort-Object date_time_raw
  $map = [ordered]@{}
  foreach($r in $rows){
    if($SKIP -contains $r.user_raw){ continue }
    $map["$($r.user_raw)|$($r.monat)"] = "  ($($r.user_raw),$(StrSql $r.monat),$(NumSql (PNum $r.monat_raw)),$(DateSql $r.date_time),$(NumSql (PNum $r.ergebnis_raw)))"
  }
  $vals=@($map.Values)
  $out.Add("-- Tests $fach ($($vals.Count))")
  $out.Add("delete from tests where fach='$fach';")
  $out.Add("insert into tests (person_id,fach,monat,monat_sort,datum,ergebnis)")
  $out.Add("select p.id,'$fach',v.monat,v.monat_sort,v.datum,v.ergebnis from (values")
  $out.Add(($vals -join ",`n"))
  $out.Add(") as v(legacy_id,monat,monat_sort,datum,ergebnis)")
  $out.Add("join people p on p.legacy_id=v.legacy_id;")
  $out.Add("")
}
TestsBlock 'hk_harmonielehre_tests-export.csv' 'harmonielehre'
TestsBlock 'hk_gehoerbildung_tests-export.csv' 'gehoerbildung'

# ---------- 3) Gesamtbewertung Harmonielehre ----------
$rows = Import-Csv (Join-Path $root 'hk_harmonielehre-export.csv') -Encoding UTF8 | Sort-Object date_time_raw
$map = [ordered]@{}
foreach($r in $rows){
  if($SKIP -contains $r.user_raw){ continue }
  $map["$($r.user_raw)"] = "  ($($r.user_raw),$(NumSql (PNum $r.ha_ueberpruefung_raw)),$(NumSql (PNum $r.hausaufgaben1_raw)),$(NumSql (PNum $r.klausur1_raw)),$(NumSql (PNum $r.klausur2_raw)),$(NumSql (PNum $r.gesamt_raw)),$(StrSql $r.gesamtnote_raw))"
}
$vals=@($map.Values)
$out.Add("-- Gesamtbewertung Harmonielehre ($($vals.Count))")
$out.Add("insert into grades (person_id,fach,ha_ueberpruefung,hausaufgaben,klausur1,klausur2,gesamt,gesamtnote)")
$out.Add("select p.id,'harmonielehre',v.ha::numeric,v.hu::numeric,v.k1::numeric,v.k2::numeric,v.ges::numeric,v.note from (values")
$out.Add(($vals -join ",`n"))
$out.Add(") as v(legacy_id,ha,hu,k1,k2,ges,note)")
$out.Add("join people p on p.legacy_id=v.legacy_id")
$out.Add("on conflict (fach,person_id) do update set ha_ueberpruefung=excluded.ha_ueberpruefung,hausaufgaben=excluded.hausaufgaben,klausur1=excluded.klausur1,klausur2=excluded.klausur2,gesamt=excluded.gesamt,gesamtnote=excluded.gesamtnote;")
$out.Add("")
$out.Add("commit;")

$target = Join-Path $root 'supabase_import_data.sql'
[System.IO.File]::WriteAllText($target, ($out -join "`n"), (New-Object System.Text.UTF8Encoding($false)))
"Geschrieben: $target"
