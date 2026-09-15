@echo off
echo ===================================================
echo   Empire CNC - Depth Anything V2 AI Service
echo ===================================================

cd /d "%~dp0"

if not exist venv (
    echo [1/3] Python Virtualenv olusturuluyor...
    py -m venv venv
)

echo [2/3] Paketler kontrol ediliyor...
venv\Scripts\python.exe -m pip install -r requirements.txt

echo [3/3] AI Depth Mikroservisi baslatiliyor (Port 8000)...
venv\Scripts\python.exe main.py
pause