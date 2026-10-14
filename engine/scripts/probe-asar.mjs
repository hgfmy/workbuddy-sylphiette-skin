#!/usr/bin/env node
// 静态取证：不开 CDP 端口也能查「新版 WorkBuddy 有没有需要重新适配的地方」。
//
// 原理：WorkBuddy 5.7.x 起把整壳背景统一收敛到两个设计 token ——
//   .teams-container.is-mac { --wb-home-bg-primary:#f2f2f2; --wb-home-bg-secondary:#fff }
// 所以「谁需要被皮肤透明化」= 「谁消费了 var(--wb-home-bg-secondary|primary)」。
// 本脚本解开 app.asar 里 renderer/**/*.css，列出全部 token 定义与消费选择器，
// 再拿 src/skin-css.mjs 里已覆盖的类名做差集 —— 打印出的就是待补清单。
//
// ⚠ WorkBuddy 5.8.2 起 renderer/** 资源整体转为 unpacked：CSS 真实内容不再位于
//   app.asar 数据区，而在同级的 app.asar.unpacked/ 目录。旧版按 offset 读取会得到
//   错位字节，表现为「token 消费方 0 个」的假阴性 —— 极易被误判成「无需适配」。
//   本脚本已同时支持 packed / unpacked 两种布局（见下方 walk）。
//
// 体检项：
//   1) token 定义与消费方                → 有没有新增需要透明化的具名容器
//   2) 锚点存活（ANCHORS）               → 皮肤赖以生效的关键选择器是否还在
//   3) 反向死规则                        → 皮肤覆盖的类名是否已被改名（静默失效）
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
// 注意：WorkBuddy 5.8.2 起把 renderer/** 资源整体标记为 unpacked，
// 真实内容不再位于 app.asar 数据区（val.offset === undefined），
// 而是落在同级的 app.asar.unpacked/ 目录里。旧版按 offset 读取会
// 读到错位字节（表现为「token 消费方 0 个」的假阴性）。这里两种都支持。
const UNPACKED_ROOT = `${ASAR}.unpacked`;
const buf = fs.readFileSync(ASAR);
const jsonLen = buf.readUInt32LE(12);            // 头部 JSON 长度
const header = JSON.parse(buf.toString("utf8", 16, 16 + jsonLen));
const dataStart = 16 + jsonLen;

let css = "";
let fileCount = 0;
let unpackedCount = 0;
const rendererCodePaths = [];   // renderer 下的 JS：锚点检查的回退检索目标
(function walk(node, prefix) {
  for (const [name, val] of Object.entries(node.files || {})) {
    const p = `${prefix}/${name}`;
    if (val.files) { walk(val, p); continue; }
    if (!p.includes("/renderer/")) continue;
    if (/\.(js|mjs|cjs)$/i.test(name)) { rendererCodePaths.push(path.join(UNPACKED_ROOT, p)); continue; }
    if (!/\.css$/i.test(name)) continue;
    let content;
    if (val.unpacked || val.offset === undefined) {
      const up = path.join(UNPACKED_ROOT, p);
      if (!fs.existsSync(up)) continue;
      content = fs.readFileSync(up, "utf8");
      unpackedCount += 1;
    } else {
      const s = dataStart + (val.offset >>> 0);
      content = buf.toString("utf8", s, s + (val.size >>> 0));
    }
    css += `\n/*===== ${p} =====*/\n` + content;
    fileCount += 1;
  }
})(header, "");

/* ── 2. 提取 token 定义 / 消费方 ──────────────────────────────────────── */
const marks = [];
const markRe = /\/\*===== (\S+?) =====\*\//g;
let m;
while ((m = markRe.exec(css))) marks.push({ idx: m.index, file: m[1] });
const srcOf = (i) => { let n = "?"; for (const mk of marks) if (mk.idx <= i) n = mk.file; return n; };

const TOKEN = /var\(--wb-home-bg-(primary|secondary|image|video)/;
const TOKEN_GROUP = "(primary|secondary|image|video)";

const definitions = [];
const defRe = new RegExp(`([^{}]{0,300})\\{[^{}]*?--wb-home-bg-${TOKEN_GROUP}\\s*:\\s*([^;{}]+)`, "g");
while ((m = defRe.exec(css))) {
  definitions.push({
    token: m[2],
    value: m[3].trim().slice(0, 60),
    selector: m[1].trim().split("\n").pop().trim().slice(-200),
    file: srcOf(m.index),
  });
}

const consumers = new Map(); // selector -> token
const useRe = new RegExp(`([^{}]{0,300})\\{([^{}]*?var\\(--wb-home-bg-${TOKEN_GROUP}[^{}]*)\\}`, "g");
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

/* ── 4. 锚点存活 + 反向死规则 ────────────────────────────────────────────
   光看「token 消费方是否已覆盖」不够：如果某个容器被改名，旧的透明化规则
   会静默变成死规则，而新名字的容器可能直接露白。这里双向校验：
     · 正向：皮肤赖以生效的关键选择器是否仍在新版 CSS 里；
     · 反向：皮肤覆盖的类名是否已从新版 CSS 中消失（疑似改名）。 */
const ANCHORS = [
  ".teams-container", ".teams-grid-scroll-content", ".conversation-shell",
  "[data-view-id=sidebar]", "[data-view-id=main-content]", "[data-view-id=detail-panel]",
  ".wb-home-route", ".wb-home-cloud-header", ".wb-home-mobile-header",
  ".workspace-preparing", ".project-detail-view", ".skills-view", ".skill-market",
  ".connector-panel", ".discover-panel-page", ".expert-center-page", ".kb-onboarding-panel",
  ".claw-agent-chat-pane", ".atm-detail-page", ".wb-skill-rec-bar", ".wb-share-bar",
  ".workbuddy-topbar", ".cr-input", "#workbuddy-menubar-container",
  "lexiang-library-iframe-view", "tencent-lexiang-panel",
];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 锚点可能只由 JS 动态创建（如 #workbuddy-menubar-container 只在 main-*.js 里出现），
// 因此 CSS 未命中时回退到 renderer 的 JS 文本里再找一次，避免误报「已消失」。
const anchorsDead = [];
const anchorsJsOnly = [];
for (const a of ANCHORS) {
  if ((css.match(new RegExp(escapeRe(a), "g")) || []).length > 0) continue;
  let inJs = false;
  for (const fp of rendererCodePaths) {
    if (!fs.existsSync(fp)) continue;
    if (fs.readFileSync(fp, "utf8").includes(a)) { inJs = true; break; }
  }
  if (inJs) anchorsJsOnly.push(a);
  else anchorsDead.push(a);
}

// 反向死规则：皮肤覆盖的类名若在新版 CSS 中已不存在，说明容器可能被改名（死规则）。
// 过滤掉驼峰（JS 变量误匹配）、无分隔符的通用英文词（surface/brand/entries…多为皮肤内部键名）、
// 过短类名与皮肤自建前缀；保留 kebab-case / BEM 风格（WorkBuddy 组件类名的实际形态）。
const deadRules = [...covered].filter((c) => {
  if (/[A-Z]/.test(c)) return false;
  if (!/[-_]/.test(c)) return false;
  if (c.length < 5) return false;
  if (/^(wb-skin|workbuddy-skin|skill-|json-)/i.test(c)) return false;
  return !new RegExp("\\." + escapeRe(c) + "\\b").test(css);
}).sort();

/* ── 5. 报告 ──────────────────────────────────────────────────────────── */
if (args.json) {
  process.stdout.write(JSON.stringify({ definitions, missing, opaqueKept, hashedSkipped, anchorsDead, deadRules }, null, 2) + "\n");
  process.exit(0);
}

console.log(`app.asar      : ${ASAR}`);
console.log(`renderer CSS  : ${fileCount} 个文件 / ${(css.length / 1048576).toFixed(2)} MB` +
  (unpackedCount ? `（其中 ${unpackedCount} 个为 unpacked 外部文件）` : ""));
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

console.log(`\n── 锚点存活：${ANCHORS.length - anchorsDead.length}/${ANCHORS.length} ──`);
if (anchorsDead.length) {
  console.log("  ✘ 完全消失（CSS 与 JS 中均未找到；对应适配大概率失效，需人工跟进）：");
  for (const a of anchorsDead) console.log(`     ${a}`);
} else {
  console.log("  ✔ 全部关键锚点健在。");
}
if (anchorsJsOnly.length) {
  console.log(`  注：${anchorsJsOnly.length} 个仅在 JS 中定义（DOM id / 动态类名，正常）：${anchorsJsOnly.join(", ")}`);
}

console.log("\n── 反向死规则（皮肤覆盖但新版 CSS 中已不存在，疑似改名）──");
if (deadRules.length) {
  console.log("  以下类名请人工确认是否被改名（若为 JS 侧类名则可忽略）：");
  for (const c of deadRules) console.log(`  .${c}`);
} else {
  console.log("  ✔ 无。");
}
