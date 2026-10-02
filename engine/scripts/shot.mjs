#!/usr/bin/env node
// WorkBuddy Skin Studio - renderer screenshot helper.
//
// 用途：换肤迭代时抓一张 WorkBuddy 渲染进程的真实截图，用来肉眼比对效果。
// 只读操作（Page.captureScreenshot），不修改任何东西。
//
// Usage:
//   node scripts/shot.mjs --out preview.jpg [--port 9223] [--quality 92]
//
// 需要 WorkBuddy 已带 --remote-debugging-port 启动（即皮肤注入后）。

import { writeFileSync } from "node:fs";

import { CdpSession, fetchRendererTargets } from "../src/cdp-client.mjs";

function parseArgs(argv) {
  const o = { port: 9223, quality: 92, out: "workbuddy-skin.jpg" };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--out") o.out = argv[++i];
    else if (k === "--port") o.port = Number(argv[++i]);
    else if (k === "--quality") o.quality = Number(argv[++i]);
  }
  return o;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = await fetchRendererTargets(args.port);
  if (targets.length === 0) {
    throw new Error(`未在 127.0.0.1:${args.port} 找到 renderer 目标；请先应用皮肤`);
  }

  let saved = 0;
  for (const target of targets) {
    const session = new CdpSession(target.webSocketDebuggerUrl);
    try {
      await session.open();
      const result = await session.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: args.quality,
      });
      const data = result?.data;
      if (!data) continue;
      const path = targets.length > 1 && saved > 0
        ? args.out.replace(/\.jpg$/, `-${saved}.jpg`)
        : args.out;
      writeFileSync(path, Buffer.from(data, "base64"));
      console.log(`saved ${path} (${Buffer.from(data, "base64").length} bytes)`);
      saved += 1;
    } finally {
      session.close();
    }
  }
  if (saved === 0) throw new Error("截图失败：未取得画面数据");
}

main().catch((err) => {
  console.error("shot failed:", err?.message ?? err);
  process.exit(1);
});
