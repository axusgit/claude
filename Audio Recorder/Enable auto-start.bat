@echo off
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0autostart.ps1" -Mode enable
pause
