#!/usr/bin/env node
// WorkBuddy Skin Studio - cross-platform pause launcher.
// Removes the injected skin and restores the native look (does NOT restart WorkBuddy).
//
// Usage: node scripts/pause.mjs [--port 9223]

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--port") o.port = Number(argv[++i]);
  }
  return o;
}

const args = parseArgs(process.argv.slice(2));
const port = Number.isInteger(args.port) ? args.port : 9223;

const child = spawn(process.execPath, [join(root, "src", "cli.mjs"), "pause", "--port", String(port)], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
