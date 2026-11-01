@echo off
setlocal
cd /d "%~dp0"
call npm run watch
if errorlevel 1 (
  echo.
  echo CK3-NZT watcher stopped with an error.
  pause
)
