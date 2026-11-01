@echo off
setlocal
cd /d "%~dp0"

:restart
call npm run watch
set "CK3_NZT_WATCH_EXIT=%ERRORLEVEL%"

if "%CK3_NZT_WATCH_EXIT%"=="75" (
  echo.
  echo CK3-NZT watcher updated itself. Restarting...
  echo.
  goto restart
)

if not "%CK3_NZT_WATCH_EXIT%"=="0" (
  echo.
  echo CK3-NZT watcher stopped with an error.
  pause
)

exit /b %CK3_NZT_WATCH_EXIT%
