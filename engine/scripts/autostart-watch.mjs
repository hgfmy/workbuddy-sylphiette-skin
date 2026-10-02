#!/usr/bin/env node
// WorkBuddy Skin Studio - 常驻守护进程（Windows）
//
// 目标：只要你打开 WorkBuddy，皮肤就已经在位，不需要手动做任何事。
//
// 它做什么：
//   1. CDP 调试端口在，但皮肤不在位 → 立刻重新注入
//      （顺便自愈：渲染进程刷新 / 崩溃恢复后样式丢了，也会自动补回来）
//   2. WorkBuddy 在跑但没有调试端口（即用普通方式启动的）→ 等一个宽限期后
//      带 --remote-debugging-port 重启一次，再注入
//   3. WorkBuddy 没在跑 → 待机，什么都不做
//
// 它刻意不做什么：
//   - 不会主动启动 WorkBuddy
//   - 不会打断「守护进程启动之前就已经开着的」会话（那种情况下只等下一次启动生效）
//
// 由 Startup 文件夹里的 wb-skin-autostart.vbs 以隐藏窗口启动，退出方式：
//   双击「停用自动皮肤.cmd」→ 写一个 stop 标记，本进程下一轮自行退出。

import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cdpReady } from "./apply.mjs";
import { resolveStudioPaths } from "../src/constants.mjs";
import { skinStatus } from "../src/injector.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const paths = resolveStudioPaths();
const stateRoot = paths.stateRoot;
const CONFIG_PATH = join(stateRoot, "autostart.json");
const LOG_PATH = join(stateRoot, "autostart.log");
const LOCK_PATH = join(stateRoot, "autostart.lock");
const STOP_PATH = join(stateRoot, "autostart.stop");
const LOG_MAX_BYTES = 256 * 1024;

const DEFAULTS = {
  theme: "sylphiette-91f4818e",
  port: 9223,
  // WorkBuddy 在跑、命令行里**没有**调试端口：等这么久就重启它
  graceNoPortSeconds: 10,
  // 命令行里**有**调试端口、只是 CDP 还没起来：给启动留足时间
  graceStartingSeconds: 45,
  relaunchCooldownSeconds: 180,
  maxRelaunchPerSession: 4,
};

function loadConfig() {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

const cfg = loadConfig();
const PORT = Number.isInteger(cfg.port) ? cfg.port : DEFAULTS.port;
const GRACE_NO_PORT_MS = Math.max(3, Number(cfg.graceNoPortSeconds) || DEFAULTS.graceNoPortSeconds) * 1000;
const GRACE_STARTING_MS = Math.max(10, Number(cfg.graceStartingSeconds) || DEFAULTS.graceStartingSeconds) * 1000;
const COOLDOWN_MS = Math.max(30, Number(cfg.relaunchCooldownSeconds) || DEFAULTS.relaunchCooldownSeconds) * 1000;
const MAX_RELAUNCH = Math.max(1, Number(cfg.maxRelaunchPerSession) || DEFAULTS.maxRelaunchPerSession);

try { mkdirSync(stateRoot, { recursive: true }); } catch {}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    if (existsSync(LOG_PATH) && statSync(LOG_PATH).size > LOG_MAX_BYTES) {
      const kept = readFileSync(LOG_PATH, "utf8").slice(-32 * 1024);
      writeFileSync(LOG_PATH, "[log truncated]\n" + kept);
    }
    appendFileSync(LOG_PATH, line);
  } catch {}
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function acquireLock() {
  try {
    if (existsSync(LOCK_PATH)) {
      const previous = Number(readFileSync(LOCK_PATH, "utf8").trim());
      if (Number.isInteger(previous) && previous > 0 && isAlive(previous)) {
        log(`已有守护进程在运行 (pid ${previous})，本次退出`);
        return false;
      }
      log(`清理失效的锁文件 (pid ${previous})`);
    }
  } catch {}
  writeFileSync(LOCK_PATH, String(process.pid));
  return true;
}

function releaseLock() {
  try {
    if (existsSync(LOCK_PATH) && Number(readFileSync(LOCK_PATH, "utf8").trim()) === process.pid) unlinkSync(LOCK_PATH);
  } catch {}
}

function isRunning() {
  try {
    const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq WorkBuddy.exe", "/NH", "/FO", "CSV"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: 8000,
    });
    return /WorkBuddy\.exe/i.test(out);
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// WorkBuddy 是不是天生带调试端口启动的？
// 带 = CDP 只是还没起来，耐心等；不带 = 永远等不到，准备重启。
// 只在「它刚出现且端口没开」时查一次，不是每轮都查。
function hasDebugFlag() {
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", "(Get-CimInstance Win32_Process -Filter \"Name='WorkBuddy.exe'\" | Where-Object { $_.CommandLine -like '*--remote-debugging-port*' } | Measure-Object).Count"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 20000 },
    );
    return Number(out.trim()) > 0;
  } catch {
    return false;
  }
}

let busy = false;

function runApply(reason) {
  busy = true;
  log(`apply: ${reason}`);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        process.execPath,
        [join(root, "scripts", "apply.mjs"), "--theme", cfg.theme, "--port", String(PORT)],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
    } catch (error) {
      busy = false;
      log(`apply 启动失败: ${error?.message ?? error}`);
      resolve(false);
      return;
    }
    let buffer = "";
    const collect = (chunk) => { buffer += chunk.toString(); };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const finish = (code) => {
      busy = false;
      const tail = buffer.trim().split("\n").filter(Boolean).slice(-3).join(" | ");
      log(`apply 结束 exit=${code}${tail ? " :: " + tail : ""}`);
      resolve(code === 0);
    };
    child.on("exit", finish);
    child.on("error", (error) => { busy = false; log(`apply 异常: ${error?.message ?? error}`); resolve(false); });
  });
}

// 守护启动时就已经在跑的实例：不打断它，只等下一次启动
let preexisting = isRunning();
let appearedAt = 0;
let appearedHasFlag = false;
let relaunches = 0;
let lastRelaunchAt = 0;
let lastReported = null;

async function tick() {
  if (existsSync(STOP_PATH)) {
    log("收到停用标记，守护进程退出");
    return -1;
  }

  const running = isRunning();
  if (!running) {
    if (preexisting) log("WorkBuddy 已退出，解除「不打断既有会话」的保护");
    preexisting = false;
    appearedAt = 0;
    appearedHasFlag = false;
    relaunches = 0;
    lastReported = null;
    return 8000;
  }

  const cdp = await cdpReady(PORT);
  if (cdp) {
    appearedAt = 0;
    if (busy) return 3000;
    const status = await skinStatus({ port: PORT }).catch(() => null);
    const targets = Array.isArray(status) ? status : [];
    const ok = targets.length > 0 && targets.every((target) => target && target.installed && target.menu);
    if (ok !== lastReported) {
      log(ok ? "皮肤在位" : `皮肤缺失（${targets.length} 个渲染目标）→ 重新注入`);
      lastReported = ok;
    }
    if (!ok) {
      const applied = await runApply("皮肤缺失，重新注入");
      lastReported = applied ? true : null;
      return 2000;
    }
    return 8000;
  }

  // WorkBuddy 在跑但调试端口没开
  lastReported = false;

  if (preexisting) return 8000;

  if (appearedAt === 0) {
    appearedAt = Date.now();
    appearedHasFlag = hasDebugFlag();
    log(appearedHasFlag
      ? "WorkBuddy 正在启动（命令带调试端口），等待 CDP 就绪"
      : "检测到 WorkBuddy 启动（命令不带调试端口），宽限后将以调试模式重启它");
    return 3000;
  }

  const graceMs = appearedHasFlag ? GRACE_STARTING_MS : GRACE_NO_PORT_MS;
  if (Date.now() - appearedAt < graceMs) return 3000;

  if (relaunches >= MAX_RELAUNCH) {
    if (relaunches === MAX_RELAUNCH) {
      log(`重启次数已达上限 ${MAX_RELAUNCH}，停止自动重启（可双击启用脚本重新开始）`);
      relaunches += 1;
    }
    return 60000;
  }
  if (Date.now() - lastRelaunchAt < COOLDOWN_MS) return 10000;

  relaunches += 1;
  lastRelaunchAt = Date.now();
  const ok = await runApply(`以调试模式重启 WorkBuddy（第 ${relaunches}/${MAX_RELAUNCH} 次）`);
  appearedAt = 0;
  appearedHasFlag = false;
  return ok ? 4000 : 15000;
}

async function main() {
  if (!acquireLock()) process.exit(0);
  log(`守护进程启动 pid=${process.pid} theme=${cfg.theme} port=${PORT} grace=${GRACE_NO_PORT_MS / 1000}s/${GRACE_STARTING_MS / 1000}s`);
  log(preexisting
    ? "启动时 WorkBuddy 已在运行：本次只做注入/自愈，不主动重启它"
    : "启动时 WorkBuddy 未运行：等待它被打开");

  // --once：只跑一轮就退出，用于诊断
  if (process.argv.includes("--once")) {
    const next = await tick();
    releaseLock();
    process.exit(next < 0 ? 0 : 0);
  }

  process.on("exit", releaseLock);
  process.on("SIGINT", () => { releaseLock(); process.exit(0); });

  for (;;) {
    let waitMs = 8000;
    try {
      waitMs = await tick();
    } catch (error) {
      log(`tick 异常: ${error?.message ?? error}`);
      waitMs = 10000;
    }
    if (waitMs < 0) break;
    await sleep(waitMs);
  }
  releaseLock();
  process.exit(0);
}

main().catch((error) => {
  log(`守护进程崩溃: ${error?.stack ?? error}`);
  releaseLock();
  process.exit(1);
});
