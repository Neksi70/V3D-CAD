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
echo.
echo Fertig: %~dp0dist\VolmeStick.exe
pause
exit /b 0
:fehler
echo Bau fehlgeschlagen.
pause
exit /b 1
