@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -InstallDir "%~dp0."
if errorlevel 1 (
  echo.
  echo CK3-NZT update failed.
  pause
  exit /b 1
)
echo.
echo CK3-NZT is up to date.
pause
