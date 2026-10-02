#!/usr/bin/env node
// WorkBuddy Skin Studio - 常驻守护进程（Windows）v2：事件驱动、秒级注入
//
// 目标：只要你打开 WorkBuddy，皮肤就已经在位，不需要手动做任何事。
//
// v2 与 v1 的区别：
//   v1：每 8 秒轮询一次皮肤状态，丢了就 spawn 一个 apply 子进程补——
//       从界面出现/刷新到皮肤上屏普遍 3~12 秒，且刷新瞬间必然「白屏闪一下」。
//   v2：通过 fast-attach 常连 CDP 浏览器通道，用 Page.addScriptToEvaluateOnNewDocument
//       把皮肤脚本注册成「新文档起始脚本」——每个新文档（首次启动、刷新、新窗口）
//       都在 first paint 之前执行皮肤脚本，肉眼等同秒上。
//       轮询只作为低频安全网保留。
//
// 仍然刻意不做的事：
//   - 不主动启动 WorkBuddy（只在它没带调试端口时才重启它）
//   - 「不打断既有会话」的绝对保护已移除：实测它会死锁（守护启动后
//     用户新开的无端口实例永远不被接管，皮肤回不来），改由宽限期 + 重启上限兜底
//
// 由 Startup 文件夹里的 wb-skin-autostart.vbs 以隐藏窗口启动，退出方式：
//   双击「停用自动皮肤.cmd」→ 写一个 stop 标记，本进程下一轮自行退出。

import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cdpReady } from "./apply.mjs";
import { resolveStudioPaths } from "../src/constants.mjs";
import { buildSkinScript, skinStatus } from "../src/injector.mjs";
import { startFastAttach } from "../src/fast-attach.mjs";
import { loadTheme } from "../src/theme-schema.mjs";
import { listThemes } from "../src/theme-store.mjs";

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

// ---- v2：document-start 引导包装 ----
// 内层脚本是函数表达式（defer 模式），首次执行时 document.head 可能还是 null
// （document-start 阶段），所以包一层：head+body 就绪前用 16ms 轮询 + DOMContentLoaded 兜底。
function wrapForDocumentStart(fnExpression) {
  return `(function(){
  var boot = ${fnExpression};
  if (document.head && document.body) { boot(); return; }
  var timer = setInterval(function(){
    if (document.head && document.body) { clearInterval(timer); boot(); }
  }, 16);
  document.addEventListener("DOMContentLoaded", function(){
    clearInterval(timer);
    if (document.head && document.body) boot();
  }, { once: true });
})();`;
}

// 启动时把注入脚本一次性构建好（主题文件读取 + base64 都在进程内完成）
async function buildDaemonScript() {
  const roots = [join(root, "themes"), paths.userThemesRoot];
  const themes = await listThemes({ roots });
  const selected = themes.find((theme) => theme.id === cfg.theme);
  if (!selected) throw new Error(`找不到主题：${cfg.theme}`);
  const loadedTheme = await loadTheme(selected.path);
  const menuThemes = [];
  for (const theme of themes) {
    if (theme.id === cfg.theme) {
      menuThemes.push(loadedTheme);
      continue;
    }
    try {
      menuThemes.push(await loadTheme(theme.path));
    } catch {
      // 坏主题不阻塞守护，只是不进菜单
    }
  }
  const { expression } = await buildSkinScript({ loadedTheme, themes: menuThemes, defer: true });
  return wrapForDocumentStart(expression);
}

// ---- 状态 ----
let fast = null;          // fast-attach 通道
let skinScript = null;    // document-start 包装后的注入脚本（null = 构建失败，退回 v1 路线）

// 注：不再做「不打断既有会话」的绝对保护——实测它会形成死锁（守护启动后
// 用户新开的无端口实例永远不被接管，皮肤永远回不来）。改由宽限期 + 重启上限兜底：
// 无端口实例宽限 10s 后带端口重启，最多 4 次 + 180s 冷却。
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
    appearedAt = 0;
    appearedHasFlag = false;
    relaunches = 0;
    lastReported = null;
    if (fast) { fast.stop(); fast = null; }
    return 2500;
  }

  const cdp = await cdpReady(PORT);
  if (cdp) {
    appearedAt = 0;

    // v2 主通道：还没建立就立即建立（fast-attach 连上后对既有目标立即注入）
    if (skinScript && !fast) {
      fast = startFastAttach({ port: PORT, script: skinScript, log });
      lastReported = null;
      return 2500;
    }

    if (busy) return 3000;

    // 安全网：确认皮肤真的在位（fast-attach 正常时这一步几乎总是 true）
    const status = await skinStatus({ port: PORT }).catch(() => null);
    const targets = Array.isArray(status) ? status : [];
    const ok = targets.length > 0 && targets.every((target) => target && target.installed && target.menu);
    if (ok !== lastReported) {
      log(ok ? "皮肤在位" : `皮肤缺失（${targets.length} 个渲染目标）→ 立即补注`);
      lastReported = ok;
    }
    if (!ok) {
      if (fast && fast.sessionCount > 0) {
        const done = await fast.reapply().catch(() => 0);
        if (done > 0) {
          log(`fast-attach 补注完成（${done} 个目标）`);
          return 4000;
        }
      }
      // 通道不可用或补注失败 → 退回 v1 子进程路线
      const applied = await runApply("fast-attach 不可用，走子进程注入");
      lastReported = applied ? true : null;
      return 2000;
    }
    return 12000;
  }

  // WorkBuddy 在跑但调试端口没开
  lastReported = false;
  if (fast) { fast.stop(); fast = null; }

  if (appearedAt === 0) {
    appearedAt = Date.now();
    appearedHasFlag = hasDebugFlag();
    log(appearedHasFlag
      ? "WorkBuddy 正在启动（命令带调试端口），等待 CDP 就绪"
      : "检测到 WorkBuddy 启动（命令不带调试端口），宽限后将以调试模式重启它");
    return 1200;
  }

  if (!appearedHasFlag) {
    // 无端口启动：永远等不到 CDP，宽限后带端口重启
    if (Date.now() - appearedAt < GRACE_NO_PORT_MS) return 1200;

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
    return ok ? 2000 : 15000;
  }

  // 带端口启动：CDP 就绪时间取决于应用自身（冷启动可能远超 45s），
  // 重启它不会更快反而打断使用——无限等待，每 2s 复查。
  return 2000;
}

async function main() {
  if (!acquireLock()) process.exit(0);
  log(`守护进程启动 pid=${process.pid} theme=${cfg.theme} port=${PORT} grace=${GRACE_NO_PORT_MS / 1000}s/${GRACE_STARTING_MS / 1000}s mode=v2-fast-attach`);
  log(isRunning()
    ? "启动时 WorkBuddy 已在运行：先尝试注入；若它没带调试端口，宽限后将带端口重启一次"
    : "启动时 WorkBuddy 未运行：等待它被打开");

  try {
    skinScript = await buildDaemonScript();
    log(`注入脚本构建完成（${Math.round(skinScript.length / 1024)} KB）`);
  } catch (error) {
    log(`注入脚本构建失败，退回 v1 子进程路线: ${error?.message ?? error}`);
    skinScript = null;
  }

  // --once：只跑一轮就退出，用于诊断
  if (process.argv.includes("--once")) {
    await tick();
    fast?.stop();
    releaseLock();
    process.exit(0);
  }

  process.on("exit", () => { fast?.stop(); releaseLock(); });
  process.on("SIGINT", () => { fast?.stop(); releaseLock(); process.exit(0); });

  loop:
  for (;;) {
    let waitMs = 8000;
    try {
      waitMs = await tick();
    } catch (error) {
      log(`tick 异常: ${error?.message ?? error}`);
      waitMs = 10000;
    }
    if (waitMs < 0) break;
    // 分片睡眠：停用标记最迟 2 秒内响应。
    // 安装脚本等旧守护退出只给 15 秒，整段长睡眠会让「启用」流程超时失败。
    let remaining = waitMs;
    while (remaining > 0) {
      const slice = Math.min(2000, remaining);
      await sleep(slice);
      remaining -= slice;
      if (existsSync(STOP_PATH)) continue loop;
    }
  }
  fast?.stop();
  releaseLock();
  process.exit(0);
}

main().catch((error) => {
  log(`守护进程崩溃: ${error?.stack ?? error}`);
  fast?.stop();
  releaseLock();
  process.exit(1);
});
