#!/usr/bin/env node
// WorkBuddy Skin Studio - diagnose WorkBuddy/node detection.
// Run this when apply.mjs reports "WorkBuddy not found".
//
// Usage: node scripts/find-workbuddy.mjs

import { platform } from "node:os";
import { findExeWindows, findAppMac } from "../src/detect.mjs";

const isWin = platform() === "win32";
const target = isWin ? findExeWindows() : findAppMac();

console.log("=== WorkBuddy Skin Studio detection ===");
console.log(`Platform:  ${platform()}`);
console.log(`WorkBuddy: ${target ?? "NOT FOUND"}`);
console.log(`node:      ${process.execPath}`);

if (!target) {
  console.log("");
  if (isWin) {
    console.log("Not found. Specify it via:");
    console.log('  node scripts/apply.mjs --exe "C:\\path\\to\\WorkBuddy.exe"');
    console.log("  or set the WORKBUDDY_EXE environment variable.");
  } else {
    console.log("Not found. Specify it via:");
    console.log('  node scripts/apply.mjs --app "/path/to/WorkBuddy.app"');
    console.log("  or set the WORKBUDDY_APP environment variable.");
  }
  console.log("Tip: if WorkBuddy is currently running, its process path is detected automatically.");
}
