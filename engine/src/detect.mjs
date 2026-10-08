// WorkBuddy app detection, shared by the launchers (scripts/*.mjs) and `cli.mjs doctor`.
// Cross-platform: resolves the Windows .exe or the macOS .app through several
// strategies, preferring the running process so non-standard install dirs work.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

const isWin = platform() === "win32";

function quietExec(file, args) {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

export function findExeWindows(argExe) {
  if (argExe && existsSync(argExe)) return argExe;
  if (process.env.WORKBUDDY_EXE && existsSync(process.env.WORKBUDDY_EXE)) return process.env.WORKBUDDY_EXE;

  // 1. running process (covers non-standard install dirs like D:\Tencent\WorkBuddy)
  const procPath = quietExec("powershell.exe", [
    "-NoProfile", "-Command",
    "(Get-CimInstance Win32_Process | Where-Object {$_.Name -ieq 'WorkBuddy.exe'} | Select-Object -First 1).ExecutablePath",
  ]).trim();
  if (procPath && existsSync(procPath)) return procPath;

  // 2. well-known install locations
  const la = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const pfx = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const cands = [
    join(la, "workbuddy", "WorkBuddy.exe"),
    join(la, "Programs", "workbuddy", "WorkBuddy.exe"),
    join(pf, "WorkBuddy", "WorkBuddy.exe"),
    join(pfx, "WorkBuddy", "WorkBuddy.exe"),
  ];
  for (const c of cands) if (existsSync(c)) return c;

  // 3. registry Uninstall entries
  const installLoc = quietExec("powershell.exe", [
    "-NoProfile", "-Command",
    "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -like '*WorkBuddy*' -and $_.InstallLocation} | Select-Object -First 1 -ExpandProperty InstallLocation",
  ]).trim();
  if (installLoc) {
    const p = join(installLoc, "WorkBuddy.exe");
    if (existsSync(p)) return p;
  }
  return null;
}

export function findAppMac(argApp) {
  if (argApp && existsSync(argApp)) return argApp;
  if (process.env.WORKBUDDY_APP && existsSync(process.env.WORKBUDDY_APP)) return process.env.WORKBUDDY_APP;

  for (const c of ["/Applications/WorkBuddy.app", join(homedir(), "Applications", "WorkBuddy.app")]) {
    if (existsSync(c)) return c;
  }
  const md = quietExec("mdfind", ["kMDItemKind == 'Application'"]);
  const mdLine = md.split("\n").find((l) => /WorkBuddy\.app/i.test(l));
  if (mdLine && existsSync(mdLine.trim())) return mdLine.trim();
  const pg = quietExec("pgrep", ["-fl", "WorkBuddy.app/Contents/MacOS/Electron"]);
  const m = pg.match(/(\/\S*WorkBuddy\.app)\/Contents\/MacOS\/Electron/);
  if (m && existsSync(m[1])) return m[1];
  return null;
}

// Unified entry: returns the platform-appropriate WorkBuddy path, or null.
export function findWorkBuddy({ exe, app } = {}) {
  return isWin ? findExeWindows(exe) : findAppMac(app);
}

// Read the installed WorkBuddy version so callers can tell which skin layer set
// applies. Windows ships `<install>/resources/install-manifest.json` (appVersion)
// plus a bare `<install>/version` file; macOS uses the bundle's Info.plist.
export function readWorkBuddyVersion(appPath) {
  if (!appPath) return null;
  const root = isWin ? dirname(appPath) : appPath;

  const manifest = join(root, "resources", "install-manifest.json");
  if (existsSync(manifest)) {
    try {
      const parsed = JSON.parse(readFileSync(manifest, "utf8"));
      if (parsed?.appVersion) return String(parsed.appVersion);
    } catch {
      // fall through to the plain version file
    }
  }

  const plain = join(root, "version");
  if (existsSync(plain)) {
    try {
      const v = readFileSync(plain, "utf8").trim();
      if (v) return v;
    } catch {
      // ignore
    }
  }

  if (!isWin) {
    const plist = join(root, "Contents", "Info.plist");
    if (existsSync(plist)) {
      const v = quietExec("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", plist]).trim();
      if (v) return v;
    }
  }
  return null;
}
