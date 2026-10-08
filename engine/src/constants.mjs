import { homedir } from "node:os";
import { join } from "node:path";

export const PRODUCT_ID = "workbuddy-skin-studio";
export const PRODUCT_NAME = "WorkBuddy Skin Studio";
export const STATE_SCHEMA_VERSION = 1;
export const THEME_SCHEMA_VERSION = 1;
export const DEFAULT_THEME_ID = "sylphiette-91f4818e";
export const DEFAULT_CDP_PORT = 9223;
export const EXPECTED_BUNDLE_ID = "com.workbuddy.workbuddy";

// 皮肤引擎版本（与 package.json 的 version 同步），供 `doctor` 输出。
export const SKIN_ENGINE_VERSION = "1.2.0";

// 注入规则实测覆盖过的 WorkBuddy 版本区间。5.7.x 把整壳背景从硬编码白底
// 收敛成了 --wb-home-bg-primary / --wb-home-bg-secondary 两个 token，
// 所以 skin-css.mjs 里必须同时覆盖两代容器名（见那里的注释）。
export const SUPPORTED_WORKBUDDY_SERIES = ["5.6.x", "5.7.x"];

// WorkBuddy renderer target 的 URL 特征：app.asar/renderer/index.html
export const RENDERER_URL_HINT = "renderer/index.html";

export function resolveStudioPaths({ home = homedir() } = {}) {
  const isWin = process.platform === "win32";
  const installRoot = join(home, ".workbuddy", PRODUCT_ID);
  const stateRoot = isWin
    ? join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "WorkBuddySkinStudio")
    : join(home, "Library", "Application Support", "WorkBuddySkinStudio");

  return {
    installRoot,
    stateRoot,
    statePath: join(stateRoot, "state.json"),
    logPath: join(stateRoot, "injector.log"),
    userThemesRoot: join(stateRoot, "themes"),
  };
}
