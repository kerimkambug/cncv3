$d = [IO.File]::ReadAllLines((Get-Item "C:\Users\selma\OneDrive\Masaüstü\proj\numuneler\TABLA MODELLERİMİZ pano şeklinde.dxf").FullName)
$inEnt = $false
$cur = ''
$stats = @{}
for ($i = 0; $i -lt $d.Count - 1; $i++) {
    $t = $d[$i].Trim()
    if ($t -eq 'SECTION' -and $d[$i+2].Trim() -eq 'ENTITIES') { $inEnt = $true; continue }
    if ($t -eq 'ENDSEC' -and $inEnt) { $inEnt = $false; continue }
    if (-not $inEnt) { continue }
    if ($t -eq '0') { $cur = $d[$i+1].Trim() }
    elseif ($t -eq '8') {
        $k = "$cur|$($d[$i+1].Trim())"
        if ($stats.ContainsKey($k)) { $stats[$k]++ } else { $stats[$k] = 1 }
    }
}
Write-Host "=== ENTITY x LAYER counts ==="
$stats.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Host ("{0,6}  {1}" -f $_.Value, $_.Name) }
