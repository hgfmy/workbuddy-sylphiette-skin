#!/usr/bin/env node
// 静态取证：不开 CDP 端口也能查「新版 WorkBuddy 有没有新增需要透明化的容器」。
//
// 原理：WorkBuddy 5.7.x 起把整壳背景统一收敛到两个设计 token ——
//   .teams-container.is-mac { --wb-home-bg-primary:#f2f2f2; --wb-home-bg-secondary:#fff }
// 所以「谁需要被皮肤透明化」= 「谁消费了 var(--wb-home-bg-secondary|primary)」。
// 本脚本解开 app.asar 里 renderer/**/*.css，列出全部 token 定义与消费选择器，
// 再拿 src/skin-css.mjs 里已覆盖的类名做差集 —— 打印出的就是待补清单。
//
// 用法：
//   node scripts/probe-asar.mjs
//   node scripts/probe-asar.mjs --asar "D:/Workbuddy/resources/app.asar"
//   node scripts/probe-asar.mjs --json > report.json
//
// 无第三方依赖；app.asar 只在内存里解析，不落盘。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SKIN_CSS = path.join(here, "..", "src", "skin-css.mjs");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) { out[k.slice(2)] = true; continue; }
    out[k.slice(2)] = v; i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const ASAR = args.asar || "D:/Workbuddy/resources/app.asar";

if (!fs.existsSync(ASAR)) {
  console.error(`找不到 app.asar：${ASAR}\n用 --asar 指定路径。`);
  process.exit(1);
}

/* ── 1. 解析 asar ─────────────────────────────────────────────────────── */
const buf = fs.readFileSync(ASAR);
const jsonLen = buf.readUInt32LE(12);            // 头部 JSON 长度
const header = JSON.parse(buf.toString("utf8", 16, 16 + jsonLen));
const dataStart = 16 + jsonLen;

let css = "";
let fileCount = 0;
(function walk(node, prefix) {
  for (const [name, val] of Object.entries(node.files || {})) {
    const p = `${prefix}/${name}`;
    if (val.files) { walk(val, p); continue; }
    if (!/\.css$/i.test(name)) continue;
    if (!p.includes("/renderer/")) continue;
    const s = dataStart + (val.offset >>> 0);
    css += `\n/*===== ${p} =====*/\n` + buf.toString("utf8", s, s + (val.size >>> 0));
    fileCount += 1;
  }
})(header, "");

/* ── 2. 提取 token 定义 / 消费方 ──────────────────────────────────────── */
const marks = [];
const markRe = /\/\*===== (\S+?) =====\*\//g;
let m;
while ((m = markRe.exec(css))) marks.push({ idx: m.index, file: m[1] });
const srcOf = (i) => { let n = "?"; for (const mk of marks) if (mk.idx <= i) n = mk.file; return n; };

const TOKEN = /var\(--wb-home-bg-(secondary|primary)/;

const definitions = [];
const defRe = /([^{}]{0,300})\{[^{}]*?--wb-home-bg-(primary|secondary)\s*:\s*([^;{}]+)/g;
while ((m = defRe.exec(css))) {
  definitions.push({
    token: m[2],
    value: m[3].trim().slice(0, 60),
    selector: m[1].trim().split("\n").pop().trim().slice(-200),
    file: srcOf(m.index),
  });
}

const consumers = new Map(); // selector -> token
const useRe = /([^{}]{0,300})\{([^{}]*?var\(--wb-home-bg-(secondary|primary)[^{}]*)\}/g;
while ((m = useRe.exec(css))) {
  const token = m[3];
  for (const raw of m[1].split(",")) {
    const sel = raw.trim().split("\n").pop().replace(/\s+/g, " ").trim();
    if (!sel || sel.length > 140 || sel.startsWith("@") || sel.startsWith("/*")) continue;
    if (!consumers.has(sel)) consumers.set(sel, { token, file: srcOf(m.index) });
  }
}

/* ── 3. 与 skin-css.mjs 已覆盖的类名做差集 ────────────────────────────── */
const skinSource = fs.readFileSync(SKIN_CSS, "utf8");
const covered = new Set();
for (const mm of skinSource.matchAll(/\.([a-z][a-z0-9_-]{2,})/gi)) covered.add(mm[1]);

// 必须保持不透明、绝不能进透明化名单的控件与浮层（它们复用了同一组 token）
const MUST_STAY_OPAQUE = /cfp-|skill-picker|document-upload-dock|user-menu-theme-switcher|dropdown|share-bar__|tooltip|popover|segmented|__sort|theme-switcher/i;

const classesOf = (sel) => [...sel.matchAll(/\.([a-z][a-z0-9_-]{2,})/gi)].map((x) => x[1]);
// 只看复合选择器的最后一段（目标元素）：只要目标元素的任意一个类名已被覆盖，
// CSS 类选择器就会命中它，即已被透明化 —— 祖先链上的类名无需重复出现。
const targetOf = (sel) => sel.split(/[\s>]+/).filter(Boolean).pop() || "";
const hashed = (sel) => /\._[a-z0-9]+_[a-z0-9]{4,}_\d+/i.test(sel);

const missing = [];
const opaqueKept = [];
const hashedSkipped = [];
for (const [sel, meta] of consumers) {
  if (MUST_STAY_OPAQUE.test(sel)) { opaqueKept.push({ sel, ...meta }); continue; }
  if (hashed(sel)) { hashedSkipped.push({ sel, ...meta }); continue; }
  const target = classesOf(targetOf(sel));
  if (target.length === 0) continue;                 // 无类名的目标（body / :root / 纯属性选择器）
  if (target.some((c) => covered.has(c))) continue;   // 已覆盖
  missing.push({ sel, missing: target.filter((c) => !covered.has(c)), ...meta });
}

/* ── 4. 报告 ──────────────────────────────────────────────────────────── */
if (args.json) {
  process.stdout.write(JSON.stringify({ definitions, missing, opaqueKept, hashedSkipped }, null, 2) + "\n");
  process.exit(0);
}

console.log(`app.asar      : ${ASAR}`);
console.log(`renderer CSS  : ${fileCount} 个文件 / ${(css.length / 1048576).toFixed(2)} MB`);
console.log(`已核对皮肤文件: ${SKIN_CSS}`);
console.log(`已覆盖类名    : ${covered.size} 个\n`);

console.log("── token 定义 ──");
for (const d of definitions) console.log(`  [${d.token}] ${d.selector}  =>  ${d.value}`);

console.log(`\n── token 消费方：${consumers.size} 个选择器 ──`);
console.log(`  · 已覆盖            : ${consumers.size - missing.length - opaqueKept.length - hashedSkipped.length}`);
console.log(`  · ⚠ 未覆盖（待补）  : ${missing.length}`);
console.log(`  · 刻意保持不透明    : ${opaqueKept.length}`);
console.log(`  · 哈希类名（跳过）  : ${hashedSkipped.length}`);

if (missing.length) {
  console.log("\n── 待补清单（消费 token 但 skin-css.mjs 未覆盖）──");
  for (const x of missing) console.log(`  ${x.sel}\n     缺: ${x.missing.join(", ")}   [${x.token}]  <${x.file.replace("__renderer__", "")}>`);
} else {
  console.log("\n✔ 没有发现未覆盖的具名容器。");
}

if (hashedSkipped.length) {
  console.log("\n── 哈希类名（每次构建都会变，不建议硬编码）──");
  for (const x of hashedSkipped.slice(0, 20)) console.log(`  ${x.sel}  <${x.file.replace("__renderer__", "")}>`);
}

if (opaqueKept.length) {
  console.log("\n── 复用 token 但必须保持不透明（别加进透明化名单）──");
  for (const x of opaqueKept.slice(0, 20)) console.log(`  ${x.sel}`);
}
