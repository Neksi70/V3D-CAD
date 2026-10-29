@echo off
rem V3D Setup - Starter. Holt das aktuelle Skript von V3DA und startet es als Administrator.
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
set "V3D=%ProgramData%\V3DSetup"
if not exist "%V3D%" mkdir "%V3D%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; try { Invoke-WebRequest -UseBasicParsing '__SERVER__/V3D-Setup.ps1' -OutFile '%V3D%\V3D-Setup.ps1' } catch { Write-Host 'V3DA nicht erreichbar - nehme die letzte Kopie' -ForegroundColor Yellow }"
powershell -NoProfile -ExecutionPolicy Bypass -File "%V3D%\V3D-Setup.ps1" -Server "__SERVER__" %*
pause
