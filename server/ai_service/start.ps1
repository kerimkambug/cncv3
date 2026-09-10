Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "  Empire CNC - Depth Anything V2 AI Service" -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Cyan

Set-Location $PSScriptRoot

if (-not (Test-Path "venv")) {
    Write-Host "[1/3] Python Virtualenv olusturuluyor..." -ForegroundColor Yellow
    python -m venv venv
}

Write-Host "[2/3] Paketler yukleniyor/kontrol ediliyor..." -ForegroundColor Yellow
& ".\venv\Scripts\Activate.ps1"
pip install -r requirements.txt

Write-Host "[3/3] AI Depth Mikroservisi baslatiliyor (Port 8000)..." -ForegroundColor Green
python main.py
