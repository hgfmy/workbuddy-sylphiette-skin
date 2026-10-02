#!/usr/bin/env node
// WorkBuddy Skin Studio - 安装「打开 WorkBuddy 就自动带皮肤」
//
// 做四件事：
//   1. 写配置 %LOCALAPPDATA%\WorkBuddySkinStudio\autostart.json
//   2. 往「启动」文件夹放一个隐藏窗口的 VBS，登录时自动拉起守护进程
//   3. 给 WorkBuddy 的快捷方式补上 --remote-debugging-port（改前先备份 .lnk）
//   4. 立刻启动一次守护进程（这样不用重新登录就生效）
//
// 用法：node scripts/autostart-install.mjs [--theme <id>] [--port 9223] [--skip-shortcuts]

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveStudioPaths } from "../src/constants.mjs";

function parseArgs(argv) {
  const out = { theme: "sylphiette-91f4818e", port: 9223, shortcuts: true, startupDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--theme") out.theme = argv[++i];
    else if (key === "--port") out.port = Number(argv[++i]);
    else if (key === "--skip-shortcuts") out.shortcuts = false;
    else if (key === "--startup-dir") out.startupDir = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const paths = resolveStudioPaths();
const stateRoot = paths.stateRoot;
const CONFIG_PATH = join(stateRoot, "autostart.json");
const LOG_PATH = join(stateRoot, "autostart.log");
const STOP_PATH = join(stateRoot, "autostart.stop");
const LOCK_PATH = join(stateRoot, "autostart.lock");
const BACKUP_DIR = join(stateRoot, "shortcut-backup");
const STARTUP_DIR = args.startupDir ?? join(process.env.APPDATA ?? join(process.env.USERPROFILE ?? "", "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
const VBS_NAME = "wb-skin-autostart.vbs";
const VBS_PATH = join(STARTUP_DIR, VBS_NAME);
const WATCH_SCRIPT = join(root, "scripts", "autostart-watch.mjs");
const PS_SCRIPT = join(root, "scripts", "patch-shortcuts.ps1");

const line = (message) => process.stdout.write(`${message}\n`);

line("============================================================");
line("  WorkBuddy 皮肤 - 安装「打开即带皮肤」");
line("============================================================");
line("");

if (process.platform !== "win32") {
  line("只支持 Windows。");
  process.exit(1);
}

// ---- 1. 配置 ----
mkdirSync(stateRoot, { recursive: true });
const config = {
  theme: args.theme,
  port: Number.isInteger(args.port) ? args.port : 9223,
  graceNoPortSeconds: 10,
  graceStartingSeconds: 45,
  relaunchCooldownSeconds: 180,
  maxRelaunchPerSession: 4,
};
writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
line(`[1/4] 配置已写入：${CONFIG_PATH}`);

// 清掉可能残留的停用标记
if (existsSync(STOP_PATH)) {
  try { unlinkSync(STOP_PATH); } catch {}
  line("      已清除上一次的停用标记");
}

// ---- 2. 启动文件夹里的隐藏启动器 ----
// 纯 ASCII 内容：VBScript 在非 UTF-8 代码页下读中文注释会出问题
const vbs = [
  "' WorkBuddy Skin Studio - autostart watcher launcher (hidden window).",
  "' Managed by scripts/autostart-install.mjs. Do not edit by hand.",
  "Option Explicit",
  "Dim sh, fso, nodeExe, watchScript, workDir",
  'Set sh = CreateObject("WScript.Shell")',
  'Set fso = CreateObject("Scripting.FileSystemObject")',
  `nodeExe = "${process.execPath}"`,
  `watchScript = "${WATCH_SCRIPT}"`,
  `workDir = "${root}"`,
  'If Not fso.FileExists(nodeExe) Then nodeExe = "node"',
  "If Not fso.FileExists(watchScript) Then WScript.Quit 1",
  "sh.CurrentDirectory = workDir",
  'sh.Run """" & nodeExe & """ """ & watchScript & """", 0, False',
  "",
].join("\r\n");

mkdirSync(STARTUP_DIR, { recursive: true });
writeFileSync(VBS_PATH, vbs, "latin1");
line(`[2/4] 登录启动项已写入：${VBS_PATH}`);

// ---- 3. 快捷方式补上调试端口（改前备份）----
if (!args.shortcuts) {
  line("[3/4] 已跳过快捷方式补丁（--skip-shortcuts）");
} else {
  const targets = [
    join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "WorkBuddy.lnk"),
    join(process.env.APPDATA ?? "", "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar", "WorkBuddy.lnk"),
    join(process.env.USERPROFILE ?? "", "Desktop", "WorkBuddy.lnk"),
  ];
  mkdirSync(BACKUP_DIR, { recursive: true });
  let backedUp = 0;
  for (const target of targets) {
    if (!existsSync(target)) continue;
    const stamp = `${Date.now()}`.slice(-6);
    const dest = join(BACKUP_DIR, `${basename(dirname(target))}-${stamp}-${basename(target)}`);
    try { copyFileSync(target, dest); backedUp += 1; } catch {}
  }
  line(`[3/4] 快捷方式补丁（备份 ${backedUp} 个到 ${BACKUP_DIR}）`);
  let patchFailed = false;
  try {
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "-Action", "add", "-Port", String(config.port)],
      { encoding: "utf8", windowsHide: true },
    );
    for (const l of output.trim().split(/\r?\n/)) if (l.trim()) line(`      ${l.trim()}`);
  } catch (error) {
    patchFailed = true;
    const text = `${error?.stdout ?? ""}${error?.stderr ?? ""}`.trim();
    if (text) for (const l of text.split(/\r?\n/)) if (l.trim()) line(`      ${l.trim()}`);
    line("      ⚠ 快捷方式补丁未成功——不影响使用：守护进程会在 WorkBuddy 启动后自动重启它一次，");
    line("        皮肤照样会出现，只是多花十几秒。");
  }
  if (!patchFailed) line("      完成");
}

// ---- 4. 启动守护进程（若已有旧实例，先让它体面退出，由本次新进程接管）----
line("[4/4] 启动守护进程");

function watcherPid() {
  try {
    const pid = Number(readFileSync(LOCK_PATH, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch (error) {
    if (error?.code === "EPERM") {
      try { return Number(readFileSync(LOCK_PATH, "utf8").trim()); } catch { return null; }
    }
    return null;
  }
}

const stale = watcherPid();
if (stale) {
  line(`      检测到旧守护进程 pid=${stale}，让它退出后由本次接管`);
  try { writeFileSync(STOP_PATH, new Date().toISOString()); } catch {}
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && watcherPid()) await new Promise((resolve) => setTimeout(resolve, 350));
  if (watcherPid()) line("      ⚠ 旧进程未按时退出，新的会因单实例锁自动跳过（不影响使用）");
} else {
  line("      当前没有运行中的守护进程");
}
try { if (existsSync(STOP_PATH)) unlinkSync(STOP_PATH); } catch {}

if (existsSync(VBS_PATH)) {
  // 由 VBS 拉起：WScript.Shell.Run 不在安装脚本的进程树里，安装窗口关掉也继续常驻
  try {
    execFileSync("cscript.exe", ["//nologo", "//B", VBS_PATH], { stdio: "ignore", timeout: 15000 });
  } catch (error) {
    line(`      ⚠ 启动器执行异常：${error?.message ?? error}`);
  }
  // 等它就位
  const ready = Date.now() + 8000;
  while (Date.now() < ready && !watcherPid()) await new Promise((resolve) => setTimeout(resolve, 300));
  const live = watcherPid();
  line(live ? `      守护进程已启动 pid=${live}` : "      ⚠ 未检测到守护进程，请把本窗口内容发给助手");
} else {
  line(`      ⚠ 启动器不存在：${VBS_PATH}`);
}

line("");
line("------------------------------------------------------------");
line("安装完成。现在的行为：");
line("  · 你像平时一样打开 WorkBuddy -> 皮肤自动出现，不用手动操作");
line("  · 实测 WorkBuddy 若以不带调试端口的方式启动，守护进程会自动");
line("    以正确方式重启它一次（十几秒），然后注入");
line("  · 你之前在 🎨 里选的皮肤会被记住，下次打开还是那一张");
line("");
line(`  守护进程日志：${LOG_PATH}`);
line("  停用：双击「停用自动皮肤.cmd」");
line("------------------------------------------------------------");
