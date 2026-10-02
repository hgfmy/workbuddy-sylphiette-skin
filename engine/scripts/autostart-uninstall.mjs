#!/usr/bin/env node
// WorkBuddy Skin Studio - 卸载「打开 WorkBuddy 就自动带皮肤」
//
//   1. 写停用标记，让守护进程下一轮自行退出
//   2. 删掉「启动」文件夹里的启动器
//   3. 把快捷方式上的 --remote-debugging-port 去掉
//
// 不会动已经注入到界面里的皮肤，也不会删你的主题和自定义图片。

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveStudioPaths } from "../src/constants.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const paths = resolveStudioPaths();
const stateRoot = paths.stateRoot;
const STOP_PATH = join(stateRoot, "autostart.stop");
const LOCK_PATH = join(stateRoot, "autostart.lock");
const LOG_PATH = join(stateRoot, "autostart.log");
const STARTUP_DIR = join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
const VBS_PATH = join(STARTUP_DIR, "wb-skin-autostart.vbs");
const PS_SCRIPT = join(root, "scripts", "patch-shortcuts.ps1");

const line = (message) => process.stdout.write(`${message}\n`);

line("============================================================");
line("  WorkBuddy 皮肤 - 停用「打开即带皮肤」");
line("============================================================");
line("");

// ---- 1. 让守护进程退出 ----
writeFileSync(STOP_PATH, new Date().toISOString());
line(`[1/3] 已写入停用标记：${STOP_PATH}`);
let previousPid = null;
try { previousPid = Number(readFileSync(LOCK_PATH, "utf8").trim()); } catch {}
if (previousPid) line(`      守护进程 pid=${previousPid} 会在几秒内自行退出`);
else line("      当前没有检测到运行中的守护进程");

// ---- 2. 删启动器 ----
if (existsSync(VBS_PATH)) {
  try {
    unlinkSync(VBS_PATH);
    line(`[2/3] 已删除登录启动项：${VBS_PATH}`);
  } catch (error) {
    line(`[2/3] ⚠ 删除失败：${error?.message ?? error}`);
  }
} else {
  line("[2/3] 登录启动项不存在，跳过");
}

// ---- 3. 还原快捷方式 ----
line("[3/3] 还原快捷方式");
try {
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "-Action", "remove"],
    { encoding: "utf8", windowsHide: true },
  );
  for (const l of output.trim().split(/\r?\n/)) if (l.trim()) line(`      ${l.trim()}`);
} catch (error) {
  const text = `${error?.stdout ?? ""}${error?.stderr ?? ""}`.trim();
  if (text) for (const l of text.split(/\r?\n/)) if (l.trim()) line(`      ${l.trim()}`);
  line("      ⚠ 未能自动还原快捷方式");
}

line("");
line("------------------------------------------------------------");
line("已停用。");
line("  · 以后打开 WorkBuddy 就是官方原样，不会再自动注入");
line("  · 想临时换肤，仍然可以双击「apply-skin(一键换肤).cmd」");
line("  · 想重新启用，双击「启用自动皮肤.cmd」");
line(`  · 日志留在：${LOG_PATH}（可随时删除）`);
line("------------------------------------------------------------");
