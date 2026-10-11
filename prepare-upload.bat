@echo off
REM Builds the plugin for upload to RemNote and makes a clean copy of the code for GitHub.
cd /d "%~dp0"
echo.
echo  1) Create an empty PUBLIC repository on github.com first (e.g. daily-todo-carryover).
echo  2) Paste its link below.
echo.
set /p REPO=GitHub repository link:
if "%REPO%"=="" (echo No link entered. & pause & exit /b 1)
node scripts\set-repo-url.js "%REPO%"
if errorlevel 1 (pause & exit /b 1)
node scripts\check-manifest.js
if errorlevel 1 (pause & exit /b 1)
if not exist node_modules\webpack\bin\webpack.js (
  echo.
  echo Installing build tools - first time only...
  call npm install --no-audit --no-fund --loglevel=error
)
if not exist node_modules\webpack\bin\webpack.js (
  echo.
  echo The build tools are missing and could not be installed. Copy all the text in this window and send it to Claude.
  pause
  exit /b 1
)
echo.
echo Building (takes up to a minute)...
if exist dist rmdir /s /q dist
if exist PluginZip.zip del /q PluginZip.zip
set NODE_ENV=production
node node_modules\webpack\bin\webpack.js --color
if not exist dist\manifest.json (
  echo.
  echo BUILD FAILED - the "dist" folder was not created. Copy all the text in this window and send it to Claude.
  pause
  exit /b 1
)
copy /y README.md dist\ >nul
echo.
echo Zipping...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path 'dist\*' -DestinationPath 'PluginZip.zip' -Force"
if not exist PluginZip.zip (
  echo.
  echo ZIP FAILED - PluginZip.zip was not created. Copy all the text in this window and send it to Claude.
  pause
  exit /b 1
)
echo.
echo Making a clean copy of the code for GitHub (without node_modules)...
if exist github-upload rmdir /s /q github-upload
robocopy . github-upload /E /XD node_modules dist github-upload .git /XF PluginZip.zip *.zip /NFL /NDL /NJH /NJS /NP >nul
echo.
echo ============================================================
echo  Done - PluginZip.zip is ready.
echo  - Upload the CONTENTS of the "github-upload" folder to your GitHub repo
echo  - Then in RemNote: Settings - Plugins - Build - Upload plugin - PluginZip.zip
echo  - After RemNote approves it, install it from:
echo    https://www.remnote.com/plugins/daily-todo-carryover
echo ============================================================
explorer /select,"%~dp0PluginZip.zip"
pause
