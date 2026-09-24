# Deploy zip'i olustur: node_modules haric her sey, env dahil.
# zip-proje.ps1'i kullanir ama .zip dosyalarini da haric tutar (eski deploy'lar
# paketin icine girmesin diye).
param(
    [string]$Out = "empire-cnc-DEPLOY.zip"
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$Stage = Join-Path $env:TEMP ("deploy-stage-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Stage | Out-Null

$excludeDirs = @('node_modules', '.git', 'venv', '__pycache__', '.vscode', '.idea',
                 'coverage', '.pytest_cache', '.mypy_cache', '.ruff_cache', 'build', '.cache')
$excludeFilePatterns = @('*.zip', '*.log', '*.pyc', '.DS_Store', 'Thumbs.db',
                         'desktop.ini', '*.tmp', '*.bak', '*.swp', '.ai*')

$copied = 0
$bytes = 0

$enumErrors = @()
$allFiles = Get-ChildItem -LiteralPath $Root -Recurse -File -Force -ErrorVariable enumErrors -ErrorAction SilentlyContinue
if ($enumErrors.Count -gt 0) {
    Write-Host "HATA: Dosya listesi tam olarak alinamadi, deploy iptal edildi:" -ForegroundColor Red
    $enumErrors | ForEach-Object { Write-Host ("  - {0}" -f $_) -ForegroundColor Red }
    throw "Paketleme sirasinda okunamayan dosya/klasor bulundu. Eksik paket uretmemek icin cikiliyor."
}

$allFiles | ForEach-Object {
    $rel = $_.FullName.Substring($Root.Length).TrimStart('\')
    $relNorm = $rel -replace '\\', '/'
    $segs = $relNorm.Split('/')

    # Klasor haric tutma
    if ($segs.Length -gt 1) {
        foreach ($d in $segs[0..($segs.Length - 2)]) {
            if ($excludeDirs -contains $d) { return }
        }
    }

    # Dosya haric tutma kurallari:
    #   - .env      : deploy paketine DAHIL edilir (WithEnv) - istemci sirlari ile calisir.
    #   - .env.example : istisna; desen eslesmese bile her zaman pakete alinir.
    #   - Karsilastirmalar buyuk/kucuk harf duyarsizdir (-ine / -like).
    $isEnvExample = $_.Name -ine '.env.example'
    if (-not $isEnvExample) {
        foreach ($p in $excludeFilePatterns) {
            if ($_.Name -like $p) { return }
        }
    }

    # client/dist DAHIL (WithDist), .env DAHIL (WithEnv)
    $dest = Join-Path $Stage $rel
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
    $script:copied++
    $script:bytes += $_.Length
}

$outPath = Join-Path $Root $Out
try {
    if (Test-Path $outPath) { Remove-Item -LiteralPath $outPath -Force }
    Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $outPath -CompressionLevel Optimal
}
finally {
    if (Test-Path -LiteralPath $Stage) {
        Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "Tamamlandi." -ForegroundColor Green
Write-Host ("Alinan dosya : {0}" -f $copied)
Write-Host ("Ham boyut    : {0} MB" -f ([math]::Round($bytes/1MB, 2)))
Write-Host ("ZIP boyutu   : {0} MB" -f ([math]::Round((Get-Item $outPath).Length/1MB, 2)))
Write-Host ("Cikti        : {0}" -f $outPath) -ForegroundColor Cyan
