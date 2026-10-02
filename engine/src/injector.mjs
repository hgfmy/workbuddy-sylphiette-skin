import { readFile } from "node:fs/promises";

import { CdpSession, fetchRendererTargets, waitForRendererTargets } from "./cdp-client.mjs";
import { sniffImage } from "./image-sniff.mjs";
import { buildFramingCss, buildSkinCss, buildVeilCss, FRAMING_PRESETS, VEIL_PRESETS } from "./skin-css.mjs";
import { buildSkinMenuScript, CSS_SENTINELS } from "./skin-menu.mjs";

const STYLE_ID = "workbuddy-skin-style";
const OVERRIDE_STYLE_ID = `${STYLE_ID}-override`;
const MENU_ID = "workbuddy-skin-menu";

async function evaluateTargets(targets, expression, Session) {
  const values = [];
  for (const target of targets) {
    const session = new Session(target.webSocketDebuggerUrl);
    try {
      await session.open();
      values.push(await session.evaluate(expression));
    } finally {
      session.close();
    }
  }
  return values;
}

async function themeEntry(loadedTheme) {
  const bytes = await readFile(loadedTheme.heroPath);
  // Prefer the MIME sniffed during loadTheme; fall back to sniffing the bytes.
  const mime = loadedTheme.imageMime ?? sniffImage(bytes)?.mime;
  if (!mime) throw new Error("不支持的 hero 图片类型");
  const heroDataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
  return {
    id: loadedTheme.manifest.id,
    name: loadedTheme.manifest.name,
    accent: loadedTheme.manifest.colors?.accent,
    surface: loadedTheme.manifest.colors?.surface,
    css: buildSkinCss({ theme: loadedTheme.manifest, heroDataUrl }),
  };
}

export async function applySkin({ loadedTheme, themes, port, deps = {} }) {
  const wait = deps.waitForRendererTargets ?? waitForRendererTargets;
  const Session = deps.Session ?? CdpSession;
  const menuThemes = themes?.length ? themes : [loadedTheme];
  const entries = [];
  for (const theme of menuThemes) entries.push(await themeEntry(theme));
  const themeId = loadedTheme.manifest.id;
  // 自定义上传主题的客户端 CSS 模板：哨兵值占位，页面内替换，和内置主题同一套模板
  const cssTemplate = buildSkinCss({
    theme: {
      id: CSS_SENTINELS.id,
      name: "custom",
      colors: {
        accent: CSS_SENTINELS.accent,
        secondary: CSS_SENTINELS.secondary,
        surface: CSS_SENTINELS.surface,
        text: CSS_SENTINELS.text,
      },
      copy: null,
    },
    heroDataUrl: CSS_SENTINELS.hero,
  });
  // 可在 🎨 菜单里实时切换的预设。它们只含少量纯 CSS（底图走 --wb-hero 变量复用），
  // 所以全部塞进注入脚本也不会撑大消息。
  const veils = VEIL_PRESETS.map(({ id, name, scale }) => ({ id, name, css: buildVeilCss(scale) }));
  const framings = FRAMING_PRESETS.map(({ id, name, size }) => ({ id, name, css: buildFramingCss(size) }));
  const expression = buildSkinMenuScript({
    entries,
    activeId: themeId,
    styleId: STYLE_ID,
    overrideStyleId: OVERRIDE_STYLE_ID,
    menuId: MENU_ID,
    cssTemplate,
    veils,
    framings,
  });
  const targets = await wait(port, {
    timeoutMs: deps.waitTimeoutMs ?? 20_000,
    pollMs: deps.pollMs ?? 500,
  });
  const values = await evaluateTargets(targets, expression, Session);
  return { applied: values.length, themeId, menuThemes: entries.map(({ id }) => id), targets: targets.map(({ id }) => id) };
}

export async function removeSkin({ port, deps = {} }) {
  const fetchTargets = deps.fetchRendererTargets ?? fetchRendererTargets;
  const Session = deps.Session ?? CdpSession;
  const expression = `(() => {
    document.getElementById(${JSON.stringify(STYLE_ID)})?.remove();
    document.getElementById(${JSON.stringify(OVERRIDE_STYLE_ID)})?.remove();
    document.getElementById(${JSON.stringify(MENU_ID)})?.remove();
    delete document.documentElement.dataset.workbuddySkin;
    return true;
  })()`;
  const targets = await fetchTargets(port);
  const values = await evaluateTargets(targets, expression, Session);
  return { removed: values.length };
}

export async function skinStatus({ port, deps = {} }) {
  const fetchTargets = deps.fetchRendererTargets ?? fetchRendererTargets;
  const Session = deps.Session ?? CdpSession;
  const expression = `(() => ({
    installed: Boolean(document.getElementById(${JSON.stringify(STYLE_ID)})),
    menu: Boolean(document.getElementById(${JSON.stringify(MENU_ID)})),
    overrides: Boolean(document.getElementById(${JSON.stringify(OVERRIDE_STYLE_ID)})),
    presets: window.__workbuddySkin?.getPresets?.() ?? null,
    themeId: document.documentElement.dataset.workbuddySkin ?? null
  }))()`;
  const targets = await fetchTargets(port);
  return evaluateTargets(targets, expression, Session);
}
