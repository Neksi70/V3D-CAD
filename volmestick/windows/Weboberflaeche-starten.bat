@echo off
REM VolmeStick - Weboberflaeche auf DIESEM Rechner starten.
REM Damit erscheinen die USB-Sticks, die HIER stecken - nicht die am Server.
REM Voraussetzung: Python 3.10+ (python.org, Haken "Add to PATH").
setlocal
cd /d "%~dp0.."

REM Adminrechte holen - ohne die kann Windows keinen Datentraeger neu aufteilen
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Starte neu mit Administratorrechten ...
  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
  exit /b
)

where python >nul 2>&1 || (
  echo Python wurde nicht gefunden. Bitte von python.org installieren
  echo und dabei "Add python.exe to PATH" ankreuzen.
  pause
  exit /b 1
)

echo VolmeStick startet - der Browser oeffnet sich gleich.
python server.py --host 127.0.0.1 --port 8775 --browser
pause
