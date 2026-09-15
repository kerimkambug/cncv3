# =============================================================
#  zip-proje.ps1
#  Empire CNC projesini (proj klasörü) temiz bir şekilde ZIP'ler.
#  Sadece KAYNAK KODU alır; node_modules / venv / cache / log /
#  build çıktıları / sırlar (.env) HARİÇ tutulur.
#
#  Kullanım:
#    .\zip-proje.ps1                 -> varsayılan çıktı adı (tarih/saatli)
#    .\zip-proje.ps1 -Out ad.zip     -> özel çıktı dosyası
#    .\zip-proje.ps1 -WithEnv        -> .env dahil et (VARSAYILAN: almaz)
#    .\zip-proje.ps1 -WithData       -> server/data dahil et (VARSAYILAN: alır)
#    .\zip-proje.ps1 -NoData         -> server/data hariç tut
#    .\zip-proje.ps1 -WithDist       -> client/dist (build çıktısı) dahil et
# =============================================================

[CmdletBinding()]
param(
    [string]$Out,
    [switch]$WithEnv,
    [switch]$WithDist,
    [switch]$NoData
)

$ErrorActionPreference = 'Stop'

# --- Proje kökü = bu script'in bulunduğu klasör ---
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not $Out) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $Out = "empire-cnc-$stamp.zip"
}
if (-not [System.IO.Path]::IsPathRooted($Out)) {
    $Out = Join-Path $Root $Out
}

Write-Host ""
Write-Host "Proje kökü   : $Root" -ForegroundColor Cyan
Write-Host "Çıktı dosyası: $Out" -ForegroundColor Cyan
Write-Host ""

# --- Geçici staging klasörü ---
$Stage = Join-Path $env:TEMP ("zip-stage-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Stage | Out-Null

# --- Hariç tutulacak klasör adları (her derinlikte) ---
$excludeDirs = @(
    'node_modules',
    '.git',
    'venv',
    '__pycache__',
    '.vscode',
    '.idea',
    'coverage',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache',
    'dist',          # build çıktısı
    'build',
    '.cache'
)

# --- Hariç tutulacak dosya desenleri (her derinlikte) ---
$excludeFiles = @(
    '*.log',
    '.env',                       # sırlar (WithEnv verilmedikçe)
    '.env.*',                     # .env.local vb. (örnek hariç aşağıda)
    '*.pyc',
    '.DS_Store',
    'Thumbs.db',
    'desktop.ini',
    '*.tmp',
    '*.bak',
    '*.swp',
    '.ai*',
    '_ai_svc*.log',
    'benchmark-*.log',
    'benchmark-*.json',
    'benchmark-smoke*.json',
    'benchmark-fixture.png',
    'learned_relief_*'
)

# --- Her zaman tutulması gereken istisnalar ---
# (.env.example gizli değildir, örnektir -> her zaman alınır)
$keepExceptions = @('.env.example')

function Test-ExcludedDir([string]$name, [string]$relPath) {
    if ($excludeDirs -contains $name) {
        if ($name -eq 'dist' -and $WithDist) { return $false }
        return $true
    }
    # server/data opsiyonel
    if ($NoData -and ($relPath -replace '\\', '/') -like 'server/data*') { return $true }
    return $false
}

function Test-ExcludedFile([string]$name, [string]$relPath) {
    if ($keepExceptions -contains $name) { return $false }

    # Preset verisi (JSON) önemli -> NoData verilmedikçe tut
    $norm = ($relPath -replace '\\', '/')
    if (-not $NoData -and $norm -like 'server/data/*') { return $false }

    if ($name -eq '.env') {
        if ($WithEnv) { return $false }
        # .env.* (local/production) da .env gibi gizli; .env.example zaten yukarıda korunuyor
        return $true
    }
    if ($name -like '.env.*') { return $true }

    foreach ($pat in $excludeFiles) {
        if ($name -like $pat) { return $true }
    }
    return $false
}

# --- Kopyalama (kendini de atla) ---
$selfName = Split-Path -Leaf $MyInvocation.MyCommand.Path
$copiedFiles = 0
$copiedBytes = 0

Get-ChildItem -LiteralPath $Root -Recurse -Force -Directory -ErrorAction SilentlyContinue | Where-Object {
    foreach ($d in $_.FullName.Substring($Root.Length).TrimStart('\').Split('\')) {
        if ($excludeDirs -contains $d) {
            if (-not ($d -eq 'dist' -and $WithDist)) { return $false }
        }
    }
    if ($NoData -and (($_.FullName.Substring($Root.Length).TrimStart('\') -replace '\\','/') -like 'server/data*')) { return $false }
    return $true
} | Out-Null  # klasörleri gez (dosyalar aşağıda)

Get-ChildItem -LiteralPath $Root -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $relPath = $_.FullName.Substring($Root.Length).TrimStart('\')
    $relNorm = $relPath -replace '\\', '/'

    # Atla: staging / çıktı zip / kendisi
    if ($_.FullName -like "$Stage*") { return }
    if ($_.FullName -eq $Out) { return }
    if ($_.Name -eq $selfName) { return }
    if ($_.Name -eq (Split-Path -Leaf $Out)) { return }

    # Klasör hariç tutma kontrolü (yol üzerindeki herhangi bir segment)
    $segments = $relNorm.Split('/')
    if ($segments.Length -gt 1) {
        $dirs = $segments[0..($segments.Length - 2)]
        foreach ($d in $dirs) {
            if (Test-ExcludedDir $d $relPath) { return }
        }
    }

    # Dosya hariç tutma kontrolü
    if (Test-ExcludedFile $_.Name $relPath) { return }

    $dest = Join-Path $Stage $relPath
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
    $script:copiedFiles++
    $script:copiedBytes += $_.Length
}

# --- ZIP oluştur ---
if (Test-Path $Out) { Remove-Item -LiteralPath $Out -Force }
Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $Out -CompressionLevel Optimal
Remove-Item -LiteralPath $Stage -Recurse -Force

$zipSize = (Get-Item -LiteralPath $Out).Length
Write-Host "Tamamlandı." -ForegroundColor Green
Write-Host ("Alınan dosya : {0}" -f $copiedFiles)
Write-Host ("Ham boyut    : {0} MB" -f ([math]::Round($copiedBytes/1MB, 2)))
Write-Host ("ZIP boyutu   : {0} MB" -f ([math]::Round($zipSize/1MB, 2)))
Write-Host ("Çıktı        : {0}" -f $Out) -ForegroundColor Cyan
Write-Host ""
if (-not $WithEnv) { Write-Host "Not: .env HARİÇ tutuldu (-WithEnv ile dahil edilir)." -ForegroundColor DarkYellow }
