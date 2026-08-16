@echo off
REM VolmeStick - Einzeldatei-EXE bauen (auf einem Windows-Rechner ausfuehren).
REM Voraussetzung: Python 3.10+ mit tkinter, dann einmalig:  pip install pyinstaller
setlocal
cd /d "%~dp0"
python -m pip install --upgrade pyinstaller || goto :fehler
pyinstaller --noconfirm --onefile --windowed --uac-admin ^
  --name VolmeStick ^
  --paths ".." ^
  --hidden-import vstick --hidden-import unattend --hidden-import download ^
  --hidden-import iso9660 --hidden-import wim ^
  vstick_gui.pyw || goto :fehler
pyinstaller --noconfirm --onefile --uac-admin ^
  --name VolmeStick-Web ^
  --paths ".." ^
  --add-data "..\web\ui.html;web" ^
  --hidden-import vstick --hidden-import unattend --hidden-import download ^
  --hidden-import iso9660 --hidden-import wim --hidden-import linuxisos ^
  --hidden-import bestand ^
  "..\server.py" || goto :fehler

echo.
echo Fertig:
echo   %~dp0dist\VolmeStick.exe      (Fenster im Rufus-Aufbau)
echo   %~dp0dist\VolmeStick-Web.exe  (gleiche Weboberflaeche wie auf dem Server)
pause
exit /b 0
:fehler
echo Bau fehlgeschlagen.
pause
exit /b 1
