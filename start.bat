@echo off
setlocal
title Daily Todo Carryover - Plugin Server
cd /d "%~dp0"

echo ==================================================
echo   Daily Todo Carryover
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not on PATH.
    echo         Install the LTS version from https://nodejs.org and run this again.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node --version') do set NODE_VER=%%v
echo Node.js %NODE_VER% found.
echo.

echo [1/3] Checking dependencies...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. Check your internet connection and try again.
    echo.
    pause
    exit /b 1
)
echo.

echo [2/3] Building plugin...
call npm run build:dist --silent
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. Copy the messages above and send them over.
    echo.
    pause
    exit /b 1
)
if not exist "dist\manifest.json" (
    echo.
    echo [ERROR] Build finished but dist\manifest.json is missing.
    echo.
    pause
    exit /b 1
)
echo.

echo [3/3] Starting plugin server...
echo --------------------------------------------------
echo  First time only, in RemNote:
echo    Settings ^> Plugins ^> Build ^> Develop from localhost
echo    and enter:  http://localhost:8080
echo.
echo  Keep this window open while you use RemNote.
echo  Remember to disable the original "Rollover Daily Todos"
echo  plugin so todos don't roll over twice.
echo  Press Ctrl+C to stop.
echo --------------------------------------------------
echo.

node serve.js

echo.
echo Plugin server stopped.
pause
