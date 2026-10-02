# WorkBuddy Skin Studio - WorkBuddy shortcut patcher
#
# Appends --remote-debugging-port=<port> to the WorkBuddy shortcuts so the app
# opens in debug mode by itself and the resident watcher only has to inject.
#
# KEEP THIS FILE PURE ASCII. Windows PowerShell 5.1 reads .ps1 as ANSI when the
# file has no BOM, so any non-ASCII literal (e.g. Chinese) turns into mojibake
# and breaks the parse. All user-facing Chinese text lives in the caller
# (autostart-install.mjs / autostart-uninstall.mjs), which is UTF-8 safe.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File patch-shortcuts.ps1 -Action add -Port 9223
#   powershell -NoProfile -ExecutionPolicy Bypass -File patch-shortcuts.ps1 -Action remove
#   powershell -NoProfile -ExecutionPolicy Bypass -File patch-shortcuts.ps1 -Action status

param(
  [ValidateSet("add", "remove", "status")]
  [string]$Action = "status",
  [int]$Port = 9223
)

$ErrorActionPreference = "Continue"

# Built here so callers never pass a value starting with "--"
# (PowerShell would try to bind it as a parameter name).
$Flag = "--remote-debugging-port=" + $Port

$targets = @(
  @{ Name = "StartMenu"; Path = (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\WorkBuddy.lnk") },
  @{ Name = "TaskBar  "; Path = (Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\WorkBuddy.lnk") },
  @{ Name = "Desktop  "; Path = (Join-Path ([Environment]::GetFolderPath("Desktop")) "WorkBuddy.lnk") }
)

try {
  $ws = New-Object -ComObject WScript.Shell
} catch {
  Write-Output ("FAIL  cannot create WScript.Shell: " + $_.Exception.Message)
  exit 1
}

$changed = 0
$failed = 0

foreach ($t in $targets) {
  if (-not (Test-Path -LiteralPath $t.Path)) {
    Write-Output ("SKIP  " + $t.Name + "  (missing)")
    continue
  }
  try {
    $lnk = $ws.CreateShortcut($t.Path)
    $current = [string]$lnk.Arguments
    $hasFlag = $current -match [regex]::Escape($Flag)

    if ($Action -eq "status") {
      Write-Output ("INFO  " + $t.Name + "  args=[" + $current + "]")
      continue
    }

    if ($Action -eq "add") {
      if ($hasFlag) {
        Write-Output ("OK    " + $t.Name + "  already has the flag")
        continue
      }
      $lnk.Arguments = (($current + " " + $Flag).Trim())
      $lnk.Save()
      $changed++
      Write-Output ("ADD   " + $t.Name + "  -> [" + $lnk.Arguments + "]")
    }
    else {
      if (-not $hasFlag) {
        Write-Output ("OK    " + $t.Name + "  nothing to remove")
        continue
      }
      $kept = @()
      foreach ($piece in ($current -split "\s+")) {
        if ($piece -and $piece -ne $Flag) { $kept += $piece }
      }
      $lnk.Arguments = ($kept -join " ")
      $lnk.Save()
      $changed++
      Write-Output ("DEL   " + $t.Name + "  -> [" + $lnk.Arguments + "]")
    }
  } catch {
    $failed++
    Write-Output ("FAIL  " + $t.Name + "  " + $_.Exception.Message)
  }
}

Write-Output ("DONE  changed=" + $changed + " failed=" + $failed)
if ($failed -gt 0) { exit 2 }
exit 0
