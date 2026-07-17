@echo off
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0autostart.ps1" -Mode disable
pause
