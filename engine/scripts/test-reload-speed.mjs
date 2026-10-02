// 精测 v2：只认「新文档」——performance.now() < 8s 且皮肤在位
import { CdpSession, fetchRendererTargets } from "../src/cdp-client.mjs";

const port = 9223;
const expr = `(() => ({
  installed: Boolean(document.getElementById("workbuddy-skin-style")),
  ready: document.readyState,
  age: performance.now()
}))()`;

const targets = await fetchRendererTargets(port);
const s = new CdpSession(targets[0].webSocketDebuggerUrl);
await s.open();
await s.send("Page.enable");

const t0 = Date.now();
await s.send("Page.reload", { ignoreCache: false });

let skinMs = null;
let detail = null;
for (let i = 0; i < 400; i += 1) {
  try {
    const r = await s.evaluate(expr);
    if (r.installed && r.age < 2500) {
      skinMs = Date.now() - t0;
      detail = r;
      break;
    }
  } catch { /* 导航瞬间 */ }
  await new Promise((r2) => setTimeout(r2, 20));
}
if (skinMs === null) { console.log("TIMEOUT"); process.exit(1); }
console.log(`reload→新文档皮肤就位: ${skinMs}ms (readyState=${detail.ready}, docAge=${Math.round(detail.age)}ms)`);
await s.close();
