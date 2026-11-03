@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1" -Port 8080
if errorlevel 1 pause
endlocal
