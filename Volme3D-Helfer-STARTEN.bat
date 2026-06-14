@echo off
title Volme3D Druck-Helfer
cd /d "%~dp0"
echo ============================================
echo   Volme3D Druck-Helfer wird gestartet...
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0volme3d-helfer.ps1"
echo.
echo Helfer beendet. Taste druecken zum Schliessen.
pause >nul
