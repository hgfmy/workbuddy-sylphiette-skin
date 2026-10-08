@echo off
setlocal
set "ROOT=%USERPROFILE%\.workbuddy\skills\workbuddy-skin-studio"
set "LOG=%ROOT%\revert.log"
set "EXE=D:\Workbuddy\WorkBuddy.exe"

rem Do not pin the bundled Node version: WorkBuddy swaps
rem ~\.workbuddy\binaries\node\versions\<ver> on every update.
call "%ROOT%\scripts\node-env.cmd" || (pause & exit /b 1)

echo ============================================================
echo   WorkBuddy Skin Revert - back to native look
echo.
echo   Step 1 tries a live removal (no restart).
echo   Step 2 only runs if Step 1 cannot reach the app.
echo ============================================================
echo.
echo [%date% %time%] ===== revert start ===== >> "%LOG%"

echo [1/2] Trying live removal via CDP (port 9223)...
"%NODE%" "%ROOT%\scripts\pause.mjs" --port 9223 >> "%LOG%" 2>&1
set RC=%errorlevel%
echo [%date% %time%] pause.mjs exit=%RC% >> "%LOG%"

if "%RC%"=="0" (
  echo DONE. Skin removed live, WorkBuddy was NOT restarted.
  goto end
)

echo [2/2] Live removal unavailable - restarting WorkBuddy plainly.
echo       The injected skin dies with the old window, so the
echo       new window starts in the native look.
if not exist "%EXE%" (
  echo [WARN] WorkBuddy.exe not found at:
  echo   %EXE%
  echo   Edit this script and set EXE to your install path.
)
taskkill /F /IM WorkBuddy.exe /T >> "%LOG%" 2>&1
timeout /t 3 /nobreak >nul
start "" "%EXE%"
echo [%date% %time%] plain restart issued >> "%LOG%"
echo DONE. WorkBuddy restarted in native mode.

:end
echo [%date% %time%] ===== revert end ===== >> "%LOG%"
echo.
echo Full log: %LOG%
echo.
pause
endlocal
