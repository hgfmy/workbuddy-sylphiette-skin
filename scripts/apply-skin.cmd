@echo off
setlocal
set "ROOT=%USERPROFILE%\.workbuddy\skills\workbuddy-skin-studio"
set "LOG=%ROOT%\apply.log"
set "THEME=sylphiette-91f4818e"

rem Do not pin the bundled Node version: WorkBuddy swaps
rem ~\.workbuddy\binaries\node\versions\<ver> on every update.
call "%ROOT%\scripts\node-env.cmd" || (pause & exit /b 1)

echo ============================================================
echo   WorkBuddy Skin Apply - Sylphiette
echo.
echo   This window will RESTART WorkBuddy in debug mode and
echo   inject the skin. Save your work first.
echo ============================================================
echo.
echo [%date% %time%] ===== apply start ===== >> "%LOG%"

echo [1/2] Restarting WorkBuddy and injecting skin... (20-40s)
"%NODE%" "%ROOT%\scripts\apply.mjs" --theme %THEME% >> "%LOG%" 2>&1
set RC=%errorlevel%
echo [%date% %time%] apply.mjs exit=%RC% >> "%LOG%"

echo [2/2] Verifying injection status...
"%NODE%" "%ROOT%\src\cli.mjs" status >> "%LOG%" 2>&1
echo [%date% %time%] ===== apply end ===== >> "%LOG%"

echo.
if "%RC%"=="0" (
  echo DONE. WorkBuddy has restarted. Look for the palette button top-right.
) else (
  echo FAILED with exit code %RC%. Full log: %LOG%
)
echo.
pause
endlocal
