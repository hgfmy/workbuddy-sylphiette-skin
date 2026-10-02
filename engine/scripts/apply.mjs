#!/usr/bin/env node
// WorkBuddy Skin Studio - cross-platform apply launcher.
// Replaces apply.command (macOS) and apply.ps1 (Windows) with a single Node script,
// because some distribution channels do not allow executable .command/.ps1 files.
//
// What it does:
//   1. detect WorkBuddy (Windows .exe / macOS .app) via src/detect.mjs
//   2. skip the restart entirely if the CDP port is already open
//   3. otherwise stop WorkBuddy, relaunch it with --remote-debugging-port, wait for CDP
//   4. run src/cli.mjs apply to inject the skin
//
// Usage:
//   node scripts/apply.mjs [--theme genshin-night] [--port 9223]
//   node scripts/apply.mjs --exe "D:\Tencent\WorkBuddy\WorkBuddy.exe"   (Windows)
//   node scripts/apply.mjs --app "/Applications/WorkBuddy.app"          (macOS)
//
// NOTE: run this from a normal terminal. It restarts WorkBuddy, so save your work first.

import { spawn, execFileSync } from "node:child_process";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { findExeWindows, findAppMac } from "../src/detect.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = platform() === "win32";
const RENDERER_HINT = "renderer/index.html";

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--theme") o.theme = argv[++i];
    else if (k === "--port") o.port = Number(argv[++i]);
    else if (k === "--exe") o.exe = argv[++i];
    else if (k === "--app") o.app = argv[++i];
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rendererTargets(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`);
  const j = await r.json();
  return j.filter((t) => t.type === "page" && typeof t.url === "string" && t.url.includes(RENDERER_HINT));
}

export async function cdpReady(port) {
  try {
    return (await rendererTargets(port)).length > 0;
  } catch {
    return false;
  }
}

async function waitCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdpReady(port)) return true;
    await sleep(500);
  }
  return false;
}

function killWorkBuddy() {
  try {
    if (isWin) {
      execFileSync("taskkill", ["/F", "/IM", "WorkBuddy.exe", "/T"], { stdio: "ignore" });
    } else {
      execFileSync("pkill", ["-f", "WorkBuddy.app/Contents/MacOS/Electron"], { stdio: "ignore" });
    }
  } catch {}
}

function relaunch(target, port) {
  const args = [`--remote-debugging-port=${port}`];
  const bin = isWin ? target : join(target, "Contents", "MacOS", "Electron");
  const child = spawn(bin, args, { detached: true, stdio: "ignore" });
  child.unref();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = Number.isInteger(args.port) ? args.port : 9223;

  console.log(`Platform: ${platform()}`);
  console.log(`Port:     ${port}`);

  if (await cdpReady(port)) {
    console.log("CDP already ready, skip restart.");
  } else {
    const target = isWin ? findExeWindows(args.exe) : findAppMac(args.app);
    if (!target) {
      const hint = isWin
        ? "Pass --exe \"C:\\path\\to\\WorkBuddy.exe\" or set WORKBUDDY_EXE."
        : "Pass --app \"/path/to/WorkBuddy.app\" or set WORKBUDDY_APP.";
      console.error(`WorkBuddy not found. ${hint}`);
      process.exit(1);
    }
    console.log(`WorkBuddy: ${target}`);
    console.log("Stopping WorkBuddy...");
    killWorkBuddy();
    await sleep(2500);
    console.log(`Restarting in CDP debug mode (port ${port})...`);
    relaunch(target, port);
    console.log("Waiting for CDP (max 45s)...");
    if (!(await waitCdp(port, 45000))) {
      console.error("CDP not ready in 45s (daemon may have relaunched WorkBuddy in normal mode). Re-run this script.");
      process.exit(1);
    }
    console.log("CDP ready.");
  }

  const cliArgs = [join(root, "src", "cli.mjs"), "apply", "--port", String(port)];
  if (args.theme) cliArgs.push("--theme", args.theme);
  const child = spawn(process.execPath, cliArgs, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    console.error("apply failed:", err?.message ?? err);
    process.exit(1);
  });
}
