#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEFAULT_CDP_PORT, DEFAULT_THEME_ID, EXPECTED_BUNDLE_ID, RENDERER_URL_HINT, SKIN_ENGINE_VERSION, SUPPORTED_WORKBUDDY_SERIES, resolveStudioPaths } from "./constants.mjs";
import { applySkin, removeSkin, skinStatus } from "./injector.mjs";
import { loadTheme } from "./theme-schema.mjs";
import { createSingleImageTheme, listThemes } from "./theme-store.mjs";
import { findWorkBuddy, readWorkBuddyVersion } from "./detect.mjs";

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function options(argv) {
  const result = {};
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`无法识别的参数：${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${key} 缺少值`);
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

function portFrom(value) {
  const port = value === undefined ? DEFAULT_CDP_PORT : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port 必须是 1024 到 65535 的整数");
  return port;
}

function defaults(overrides) {
  const paths = resolveStudioPaths();
  return {
    bundledThemesRoot: join(sourceRoot, "themes"),
    userThemesRoot: paths.userThemesRoot,
    loadTheme,
    listThemes,
    createSingleImageTheme,
    applySkin,
    removeSkin,
    skinStatus,
    ...overrides,
  };
}

export async function runCli(argv, overrides = {}) {
  const command = argv[0] ?? "help";
  const args = options(argv);
  const deps = defaults(overrides);
  const roots = [deps.bundledThemesRoot, deps.userThemesRoot];

  if (command === "help") {
    return {
      commands: ["list", "create --image PATH --name NAME", "apply [--theme ID] [--port 9223]", "pause", "status", "doctor"],
    };
  }
  if (command === "list") return deps.listThemes({ roots });
  if (command === "create") {
    if (!args.image) throw new Error("create 需要 --image");
    if (!args.name) throw new Error("create 需要 --name");
    return deps.createSingleImageTheme({ imagePath: args.image, name: args.name, storeRoot: deps.userThemesRoot });
  }
  if (command === "apply") {
    const themeId = args.theme ?? DEFAULT_THEME_ID;
    const themes = await deps.listThemes({ roots });
    const selected = themes.find((theme) => theme.id === themeId);
    if (!selected) throw new Error(`找不到主题：${themeId}`);
    const loadedTheme = await deps.loadTheme(selected.path);
    const menuThemes = [];
    for (const theme of themes) {
      if (theme.id === themeId) {
        menuThemes.push(loadedTheme);
        continue;
      }
      try {
        menuThemes.push(await deps.loadTheme(theme.path));
      } catch {
        // 坏主题不阻塞换肤，只是不进菜单
      }
    }
    return deps.applySkin({ loadedTheme, themes: menuThemes, port: portFrom(args.port) });
  }
  if (command === "pause" || command === "restore") {
    return deps.removeSkin({ port: portFrom(args.port) });
  }
  if (command === "status") return deps.skinStatus({ port: portFrom(args.port) });
  if (command === "doctor") {
    if (process.platform === "win32") {
      const candidates = [
        process.env.WORKBUDDY_EXE,
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "workbuddy", "WorkBuddy.exe"),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "workbuddy", "WorkBuddy.exe"),
        process.env.ProgramFiles && join(process.env.ProgramFiles, "WorkBuddy", "WorkBuddy.exe"),
        process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "WorkBuddy", "WorkBuddy.exe"),
      ].filter(Boolean);
      const app = findWorkBuddy();
      return {
        platform: "win32",
        app,
        appFound: !!app,
        appVersion: readWorkBuddyVersion(app),
        skinEngine: SKIN_ENGINE_VERSION,
        supportedSeries: SUPPORTED_WORKBUDDY_SERIES,
        candidates,
        cdpPort: DEFAULT_CDP_PORT,
        rendererHint: RENDERER_URL_HINT,
        installRoot: resolveStudioPaths().installRoot,
      };
    }
    const app = findWorkBuddy();
    return {
      platform: "darwin",
      app,
      appFound: !!app,
      appVersion: readWorkBuddyVersion(app),
      skinEngine: SKIN_ENGINE_VERSION,
      supportedSeries: SUPPORTED_WORKBUDDY_SERIES,
      bundleId: EXPECTED_BUNDLE_ID,
      cdpPort: DEFAULT_CDP_PORT,
      rendererHint: RENDERER_URL_HINT,
      installRoot: resolveStudioPaths().installRoot,
    };
  }
  throw new Error(`未知命令：${command}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`WorkBuddy Skin Studio：${error.message}\n`);
      process.exitCode = 1;
    });
}
