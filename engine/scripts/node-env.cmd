@echo off
rem ---------------------------------------------------------------------------
rem Resolve a Node runtime for the skin launchers.
rem
rem Do NOT pin the bundled version. WorkBuddy installs its Node under
rem   %USERPROFILE%\.workbuddy\binaries\node\versions\<ver>\
rem and that <ver> changes on every WorkBuddy update (e.g. 22.22.2-3 -> 22.22.2-6),
rem which silently breaks any launcher that hardcodes it.
rem
rem Order: PATH first, then the newest bundled copy (dir /o-n = name desc).
rem Sets NODE and returns errorlevel 0, or prints a hint and returns 1.
rem
rem Usage from a launcher (ROOT must already be set):
rem   call "%ROOT%\scripts\node-env.cmd" || exit /b 1
rem ---------------------------------------------------------------------------

set "NODE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE set "NODE=%%N"

if not defined NODE (
  for /f "delims=" %%D in ('dir /b /ad /o-n "%USERPROFILE%\.workbuddy\binaries\node\versions" 2^>nul') do (
    if not defined NODE if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\%%D\node.exe" set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\%%D\node.exe"
  )
)

if not defined NODE (
  echo [ERROR] Node.js not found. Looked on PATH and under:
  echo   %USERPROFILE%\.workbuddy\binaries\node\versions\
  echo Install Node.js 18+ or let WorkBuddy finish its setup, then retry.
  exit /b 1
)

exit /b 0
