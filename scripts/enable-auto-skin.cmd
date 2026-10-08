@echo off
chcp 65001 >nul
setlocal
set "ROOT=%USERPROFILE%\.workbuddy\skills\workbuddy-skin-studio"

title WorkBuddy Skin - enable auto apply

echo.
echo ============================================================
echo   Enable: skin appears automatically whenever WorkBuddy opens
echo   Run this ONCE. Nothing to do afterwards.
echo ============================================================
echo.

rem Do not pin the bundled Node version: WorkBuddy swaps
rem ~\.workbuddy\binaries\node\versions\<ver> on every update.
call "%ROOT%\scripts\node-env.cmd" || (pause & exit /b 1)

"%NODE%" "%ROOT%\scripts\autostart-install.mjs"
set RC=%errorlevel%

echo.
if "%RC%"=="0" (
  echo Done. Open WorkBuddy normally - the skin shows up by itself.
) else (
  echo Finished with exit code %RC%.
)
echo.
pause
endlocal
