@echo off
chcp 65001 >nul
setlocal
set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
set "ROOT=%USERPROFILE%\.workbuddy\skills\workbuddy-skin-studio"

title WorkBuddy Skin - disable auto apply

echo.
echo ============================================================
echo   Disable: WorkBuddy starts with its official look again
echo ============================================================
echo.

if not exist "%NODE%" (
  echo [ERROR] Node not found:
  echo   %NODE%
  echo   Edit this script and point NODE to your own node.exe path.
  echo.
  pause
  exit /b 1
)

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
