@echo off
chcp 65001 >nul
setlocal
set "ROOT=%USERPROFILE%\.workbuddy\skills\workbuddy-skin-studio"

title WorkBuddy Skin - disable auto apply

echo.
echo ============================================================
echo   Disable: WorkBuddy starts with its official look again
echo ============================================================
echo.

rem Do not pin the bundled Node version: WorkBuddy swaps
rem ~\.workbuddy\binaries\node\versions\<ver> on every update.
call "%ROOT%\scripts\node-env.cmd" || (pause & exit /b 1)

"%NODE%" "%ROOT%\scripts\autostart-uninstall.mjs"
set RC=%errorlevel%

echo.
if "%RC%"=="0" (
  echo Disabled.
) else (
  echo Finished with exit code %RC%.
)
echo.
pause
endlocal
