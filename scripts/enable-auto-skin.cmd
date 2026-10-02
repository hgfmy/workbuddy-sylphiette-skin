@echo off
chcp 65001 >nul
setlocal
set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
set "ROOT=%USERPROFILE%\.workbuddy\skills\workbuddy-skin-studio"

title WorkBuddy Skin - enable auto apply

echo.
echo ============================================================
echo   Enable: skin appears automatically whenever WorkBuddy opens
echo   Run this ONCE. Nothing to do afterwards.
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
