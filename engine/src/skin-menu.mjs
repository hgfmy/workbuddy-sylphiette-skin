const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;
const DEFAULT_ACCENT = "#24c9d7";

// 客户端 CSS 由 Node 端模板加哨兵生成，替换后与内置主题同源，避免两套模板漂移
export const CSS_SENTINELS = {
  id: "workbuddy-custom-sentinel-id",
  hero: "data:image/png;base64,WORKBUDDYHEROSENTINEL",
  accent: "#010203",
  secondary: "#040506",
  surface: "#070809",
  text: "#0a0b0c",
};

export function buildSkinMenuScript({
  entries,
  activeId,
  styleId,
  overrideStyleId = `${styleId}-override`,
  menuId,
  cssTemplate = "",
  veils = [],
  framings = [],
  // true  → 返回「函数表达式」(() => {...})，由调用方决定何时执行（document-start 引导用）
  // false → 返回「立即执行」的表达式 (() => {...})()，供 Runtime.evaluate 直接跑
  defer = false,
}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("皮肤菜单至少需要一个主题");
  }
  const themes = entries.map((entry) => {
    if (!entry?.id || typeof entry.css !== "string") throw new Error("主题条目缺少 id 或 css");
    return {
      id: String(entry.id),
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name : String(entry.id),
      accent: HEX_COLOR.test(entry.accent ?? "") ? entry.accent : DEFAULT_ACCENT,
      surface: typeof entry.surface === "string" ? entry.surface : "#ffffff",
      css: entry.css,
    };
  });
  if (activeId !== null && !themes.some((theme) => theme.id === activeId)) {
    throw new Error(`当前主题不在菜单列表中：${activeId}`);
  }
  const normalizePresets = (list) =>
    (Array.isArray(list) ? list : [])
      .filter((item) => item && typeof item.id === "string" && typeof item.css === "string")
      .map((item) => ({ id: item.id, name: String(item.name ?? item.id), css: item.css }));
  const payload = JSON.stringify({
    styleId,
    overrideStyleId,
    menuId,
    activeId,
    themes,
    cssTemplate,
    veils: normalizePresets(veils),
    framings: normalizePresets(framings),
    sentinels: CSS_SENTINELS,
    customId: "custom-upload",
    customSlots: 10,
    storageVersion: 2,
    storageKey: "workbuddyCustomThemes",
    legacyStorageKey: "workbuddyCustomTheme",
    hiddenKey: "workbuddyHiddenThemes",
    presetKey: "workbuddySkinPresets",
    activeKey: "workbuddySkinActive",
  });

  const source = `(() => {
  const data = ${payload};
  let style = document.getElementById(data.styleId);
  if (!style) {
    style = document.createElement("style");
    style.id = data.styleId;
    document.head.appendChild(style);
  }
  // 预设覆盖层：独占一个 <style>，必须始终排在主题样式之后才能压住它
  let override = document.getElementById(data.overrideStyleId);
  if (!override) {
    override = document.createElement("style");
    override.id = data.overrideStyleId;
  }
  document.head.appendChild(override);

  document.getElementById(data.menuId)?.remove();
  const root = document.createElement("div");
  root.id = data.menuId;
  root.style.cssText = "position:fixed;top:96px;right:16px;z-index:2147483000;font:500 13px/1.4 system-ui;user-select:none;";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "\\u{1F3A8}";
  button.title = "WorkBuddy Skin Studio";
  button.style.cssText = "display:block;margin-left:auto;width:38px;height:38px;border-radius:50%;border:1px solid rgba(0,0,0,.18);background:rgba(255,255,255,.92);backdrop-filter:blur(10px);box-shadow:0 3px 12px rgba(0,0,0,.24);cursor:pointer;font-size:19px;padding:0;";

  const panel = document.createElement("div");
  panel.style.cssText = "display:none;margin-top:8px;min-width:200px;max-width:264px;max-height:calc(100vh - 150px);overflow-y:auto;padding:6px;border-radius:12px;border:1px solid rgba(0,0,0,.1);background:rgba(255,255,255,.94);backdrop-filter:blur(16px);box-shadow:0 10px 30px rgba(0,0,0,.18);color:#17344f;";

  const rows = new Map();
  // 面板内一次性提示（保存失败等），几秒后自动收走
  let toastTimer = null;
  const toast = (message) => {
    let node = panel.querySelector("[data-skin-toast]");
    if (!node) {
      node = document.createElement("div");
      node.dataset.skinToast = "1";
      node.style.cssText = "margin:2px 4px 6px;padding:7px 9px;border-radius:8px;background:rgba(214,58,58,.12);color:#a32626;font-size:12px;line-height:1.45;white-space:normal;";
      panel.insertBefore(node, panel.firstChild);
    }
    node.textContent = message;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.remove(); toastTimer = null; }, 7000);
  };
  const paint = (id) => {
    for (const [rowId, row] of rows) {
      row.style.background = rowId === id ? "rgba(36,201,215,.16)" : "transparent";
      row.style.fontWeight = rowId === id ? "700" : "500";
    }
  };
  const row = (label, dotColor, onPick, before) => {
    const item = document.createElement("div");
    item.style.cssText = "display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;";
    const dot = document.createElement("span");
    dot.style.cssText = "width:10px;height:10px;border-radius:50%;flex:none;background:" + dotColor + ";";
    const text = document.createElement("span");
    text.textContent = label;
    item.append(dot, text);
    item.addEventListener("mouseenter", () => { if (item.style.fontWeight !== "700") item.style.background = "rgba(0,0,0,.05)"; });
    item.addEventListener("mouseleave", () => paint(document.documentElement.dataset.workbuddySkin ?? null));
    item.addEventListener("click", () => onPick(item));
    if (before) panel.insertBefore(item, before); else panel.appendChild(item);
    return item;
  };

  // ---- 分组标题 ----
  const section = (title, first) => {
    const el = document.createElement("div");
    el.textContent = title;
    el.style.cssText = "padding:" + (first ? "5px" : "11px") + " 10px 4px;font-size:11px;font-weight:700;letter-spacing:.06em;color:rgba(0,0,0,.4);";
    panel.appendChild(el);
    return el;
  };

  // ---- 可实时切换的预设（薄纱浓度 / 背景取景）----
  // 这些预设只含少量纯 CSS，底图通过 --wb-hero 变量复用，所以切换不需要重载图片。
  const pickDefault = (list, preferred) => (list.find((item) => item.id === preferred) ?? list[0] ?? { id: null }).id;
  const presets = {
    veil: pickDefault(data.veils, "normal"),
    framing: pickDefault(data.framings, "wide"),
  };
  try {
    const savedPresets = JSON.parse(localStorage.getItem(data.presetKey) ?? "null");
    if (savedPresets) {
      if (data.veils.some((item) => item.id === savedPresets.veil)) presets.veil = savedPresets.veil;
      if (data.framings.some((item) => item.id === savedPresets.framing)) presets.framing = savedPresets.framing;
    }
  } catch {}

  const applyOverrides = () => {
    const veilCss = data.veils.find((item) => item.id === presets.veil)?.css ?? "";
    const framingCss = data.framings.find((item) => item.id === presets.framing)?.css ?? "";
    override.textContent = veilCss + "\\n" + framingCss;
  };
  const savePresets = () => {
    try { localStorage.setItem(data.presetKey, JSON.stringify(presets)); } catch {}
  };

  const presetRows = [];
  const paintPresets = () => {
    for (const entry of presetRows) {
      const on = presets[entry.group] === entry.id;
      entry.mark.style.borderColor = on ? "rgba(0,0,0,.75)" : "rgba(0,0,0,.26)";
      entry.mark.style.background = on ? "rgba(0,0,0,.75)" : "transparent";
      entry.el.style.fontWeight = on ? "700" : "500";
      entry.el.style.background = "transparent";
    }
  };
  const presetRow = (group, item) => {
    const el = document.createElement("div");
    el.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;cursor:pointer;";
    const mark = document.createElement("span");
    mark.style.cssText = "width:10px;height:10px;border-radius:50%;flex:none;box-sizing:border-box;border:1.5px solid rgba(0,0,0,.26);background:transparent;";
    const text = document.createElement("span");
    text.textContent = item.name;
    el.append(mark, text);
    el.addEventListener("mouseenter", () => { if (presets[group] !== item.id) el.style.background = "rgba(0,0,0,.05)"; });
    el.addEventListener("mouseleave", () => { el.style.background = "transparent"; });
    el.addEventListener("click", () => {
      presets[group] = item.id;
      savePresets();
      applyOverrides();
      paintPresets();
    });
    panel.appendChild(el);
    presetRows.push({ el, mark, group, id: item.id });
    return el;
  };

  const isLightSurface = (hex) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return true;
    const v = parseInt(m[1], 16);
    return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) > 140;
  };
  // 同步切换 WorkBuddy 的 VS Code 主题模式，让原生控件（输入框/按钮等）跟着深浅色变
  const applyMode = (surface) => {
    const dark = !isLightSurface(surface);
    const body = document.body;
    const html = document.documentElement;
    body.dataset.vscodeThemeKind = dark ? "vscode-dark" : "vscode-light";
    body.dataset.vscodeThemeName = dark ? "IDE Dark" : "IDE Light";
    html.style.colorScheme = dark ? "dark" : "light";
    ["light", "vscode-light", "cb-light", "dark", "vscode-dark", "cb-dark"].forEach((cls) => {
      const isDarkCls = cls === "dark" || cls === "vscode-dark" || cls === "cb-dark";
      body.classList.toggle(cls, dark ? isDarkCls : !isDarkCls);
      html.classList.toggle(cls, dark ? isDarkCls : !isDarkCls);
    });
  };
  // 记住「当前用的是哪一张」。重启 WorkBuddy 后由重注入的脚本自动还原，
  // 所以开机守护只需要带一个默认主题注入，用户上次的选择不会丢。
  const saveActive = (value) => { try { localStorage.setItem(data.activeKey, JSON.stringify(value)); } catch {} };
  const readActive = () => { try { return JSON.parse(localStorage.getItem(data.activeKey) ?? "null"); } catch { return null; } };
  const setTheme = (id) => {
    const theme = data.themes.find((candidate) => candidate.id === id);
    if (!theme) return;
    style.textContent = theme.css;
    document.documentElement.dataset.workbuddySkin = theme.id;
    applyMode(theme.surface);
    paint(theme.id);
    applyOverrides();
    saveActive({ k: "theme", id: theme.id });
  };
  const clearTheme = () => {
    style.textContent = "";
    override.textContent = "";   // 归还原生界面时必须连预设覆盖层一起清掉
    delete document.documentElement.dataset.workbuddySkin;
    applyMode("#ffffff");
    paint(null);
    saveActive({ k: "native" });
  };

  // ══ 自定义分组：已装主题也占一格（可清空可换图）+ 自定义图片槽位 + 原生界面 ══
  // 已装主题不再单独成行，而是和自定义图片共用同一套槽位：第 i 个已装主题落在第 i 格，
  // 用户上传的图可以顶掉它，× 也能把主题收进「已隐藏」。
  section("自定义", true);

  // ---- 自定义图片：本地选图 -> 压缩 -> 取色 -> 生成 CSS -> 持久化 ----
  // 一共 data.customSlots 格，每格各占菜单里的一行，可随时切换。
  // 只有「当前正在用的那一张」会生成 CSS 塞进 <style>，其余只是 localStorage 里的一份
  // dataUrl，所以槽位数量不影响注入体积（CDP 消息不会因此变大）。
  // 但槽位越多、localStorage 里共存的数据就越多，所以每格的存储预算按槽位数摊薄
  // （见下面的 STORAGE_BUDGET_CHARS / encodeWithinBudget）。
  const customSlotId = (index) => data.customId + "-" + (index + 1);

  const buildCustomCss = (dataUrl, colors, id) => data.cssTemplate
    .split(data.sentinels.hero).join(dataUrl)
    .split(data.sentinels.accent).join(colors.accent)
    .split(data.sentinels.secondary).join(colors.secondary)
    .split(data.sentinels.surface).join(colors.surface)
    .split(data.sentinels.text).join(colors.text)
    .split(data.sentinels.id).join(id);

  // 槽位存储：{ v: 2, slots: [theme|null × customSlots] }，下标即槽位号。
  // 槽位 0 默认留给「已装主题」（当前是希露菲），用户上传的图也可以占用它。
  const blankSlots = () => Array.from({ length: data.customSlots }, () => null);
  const readRaw = (key) => {
    try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
  };
  const loadCustoms = () => {
    const raw = readRaw(data.storageKey);
    let list = null;
    let migrated = false;
    if (raw && raw.v === data.storageVersion && Array.isArray(raw.slots)) {
      list = raw.slots;
    } else if (Array.isArray(raw)) {
      list = [null, ...raw];              // v1 的 3 格整体右移一位，0 号让给已装主题
      migrated = true;
    } else if (raw && raw.dataUrl) {
      list = [null, raw];                 // 更早的单条对象结构
      migrated = true;
    }
    if (!list) {
      const legacy = readRaw(data.legacyStorageKey);
      if (legacy && legacy.dataUrl) { list = [null, legacy]; migrated = true; }
    }
    const result = blankSlots();
    if (Array.isArray(list)) {
      for (let index = 0; index < data.customSlots; index += 1) {
        const theme = list[index];
        if (theme && theme.dataUrl && theme.colors) result[index] = theme;
      }
    }
    if (migrated) {
      saveCustoms(result);
      try { localStorage.removeItem(data.legacyStorageKey); } catch {}
    }
    return result;
  };
  // 存储预算：Chromium 的 localStorage 配额约 5MB/源，槽位一多，base64 dataUrl 很容易顶到上限。
  // 于是按槽位数摊薄——10 格约 420K 字符/格，4 格时约 1M 字符/格（老配置的行为不回归）。
  const STORAGE_BUDGET_CHARS = 4200000;
  const slotBudgetChars = Math.max(120000, Math.floor(STORAGE_BUDGET_CHARS / data.customSlots));

  // 编码阶梯：从大而清往下退，取第一个塞得进预算的档位（图片再大也不会超编）。
  // 只在图片确实超编时才会退档，正常情况下第一档就够，画质与旧版一致。
  const ENCODE_LADDER = [[1600, 0.82], [1440, 0.8], [1280, 0.78], [1120, 0.74], [960, 0.7], [800, 0.66], [640, 0.62]];
  const encodeWithinBudget = (img) => {
    let fallback = null;
    for (const [maxWidth, quality] of ENCODE_LADDER) {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const encoded = { dataUrl: canvas.toDataURL("image/webp", quality), maxWidth, quality };
      if (encoded.dataUrl.length <= slotBudgetChars) return encoded;
      fallback = encoded;
    }
    return fallback;
  };

  const saveCustoms = (list) => {
    try {
      localStorage.setItem(data.storageKey, JSON.stringify({ v: data.storageVersion, slots: list }));
      return true;
    } catch (error) {
      console.warn("WorkBuddy Skin：自定义图片总体积超出 localStorage 配额", error);
      return false;
    }
  };

  // 被用户从菜单里清掉的已装主题（可以随时恢复回来）
  const hidden = (() => {
    const raw = readRaw(data.hiddenKey);
    return Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
  })();
  const saveHidden = () => {
    try { localStorage.setItem(data.hiddenKey, JSON.stringify(hidden)); } catch {}
  };

  const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  const extractPalette = (canvas) => {
    const ctx = canvas.getContext("2d");
    const { data: px } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const buckets = new Map();
    let lumSum = 0, count = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumSum += lum; count += 1;
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat < 0.18 || lum < 24 || lum > 245) continue;   // 灰、过暗、过曝不参与取主色
      const d = max - min || 1;
      let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      const bucket = Math.round(h) % 6 * 2 + (sat > 0.55 ? 1 : 0);
      const entry = buckets.get(bucket) ?? { w: 0, r: 0, g: 0, b: 0, h: h * 60 };
      const weight = sat * sat;
      entry.w += weight; entry.r += r * weight; entry.g += g * weight; entry.b += b * weight;
      buckets.set(bucket, entry);
    }
    const avgLum = count ? lumSum / count : 128;
    const ranked = [...buckets.values()].sort((a, b2) => b2.w - a.w)
      .map((e) => ({ rgb: [e.r / e.w, e.g / e.w, e.b / e.w], h: e.h, w: e.w }));
    const accent = ranked[0]?.rgb ?? [36, 201, 215];
    const second = ranked.find((e) => Math.abs(e.h - (ranked[0]?.h ?? 0)) > 50)?.rgb
      ?? mix(accent, [255, 255, 255], 0.35);
    const light = avgLum > 128;
    const surface = light ? mix(accent, [252, 252, 255], 0.92) : mix(accent, [12, 12, 18], 0.86);
    const text = light ? mix(accent, [16, 24, 40], 0.82) : mix(accent, [244, 246, 252], 0.85);
    return {
      accent: hex(...accent),
      secondary: hex(...second),
      surface: hex(...surface),
      text: hex(...text),
    };
  };

  const slots = loadCustoms();
  const slotRows = [];
  let pendingSlot = 0;

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/png,image/jpeg,image/webp";
  picker.style.display = "none";
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    const target = pendingSlot;
    picker.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importFromDataUrl(reader.result, file.name.replace(/\.[a-z0-9]+$/i, ""), target);
    reader.readAsDataURL(file);
    panel.style.display = "none";
  });

  const applyCustomTheme = (theme, index) => {
    const id = customSlotId(index);
    style.textContent = buildCustomCss(theme.dataUrl, theme.colors, id);
    document.documentElement.dataset.workbuddySkin = id;
    applyMode(theme.colors.surface);
    paint(id);
    applyOverrides();
    saveActive({ k: "slot", i: index });
  };

  // 槽位三态：用户上传的图 > 该位的已装主题 > 空槽（上传入口）
  const themeAt = (index) => {
    const theme = data.themes[index];
    return theme && !hidden.includes(theme.id) ? theme : null;
  };

  const renderSlot = (index) => {
    const entry = slotRows[index];
    const custom = slots[index];
    const theme = custom ? null : themeAt(index);
    // 这一行在 rows 里的别名会变（槽位 id / 主题 id），先清掉旧的再做高亮索引
    for (const [key, node] of [...rows]) if (node === entry.item) rows.delete(key);
    if (custom) {
      entry.dot.style.background = custom.colors.accent;
      entry.dot.style.border = "0";
      entry.text.textContent = custom.name;
      entry.text.style.color = "";
      entry.del.style.display = "";
      entry.item.title = "点击应用这张图片";
    } else if (theme) {
      entry.dot.style.background = theme.accent;
      entry.dot.style.border = "0";
      entry.text.textContent = theme.name;
      entry.text.style.color = "";
      entry.del.style.display = "";
      entry.item.title = "点击应用这个皮肤（× 清空这一格）";
    } else {
      entry.dot.style.background = "transparent";
      entry.dot.style.border = "1.5px dashed rgba(0,0,0,.34)";
      entry.text.textContent = "\\uff0b \\u81ea\\u5b9a\\u4e49\\u56fe\\u7247 " + (index + 1);
      entry.text.style.color = "rgba(0,0,0,.52)";
      entry.del.style.display = "none";
      entry.item.title = "点击选择一张本地图片";
    }
    rows.set(customSlotId(index), entry.item);
    if (theme) rows.set(theme.id, entry.item);
  };

  const renderAllSlots = () => {
    for (let index = 0; index < data.customSlots; index += 1) renderSlot(index);
  };

  // × 的语义：占着格子的是用户图就删图，是已装主题就把它收进「已隐藏」
  const clearSlot = (index) => {
    const id = customSlotId(index);
    if (slots[index]) {
      slots[index] = null;
      saveCustoms(slots);
      if (document.documentElement.dataset.workbuddySkin === id) clearTheme();
    } else {
      const theme = themeAt(index);
      if (!theme) return;
      hidden.push(theme.id);
      saveHidden();
      if (document.documentElement.dataset.workbuddySkin === theme.id) clearTheme();
    }
    renderSlot(index);
    renderRestoreRow();
  };

  const importFromDataUrl = (dataUrl, name, index = pendingSlot) => new Promise((resolve, reject) => {
    const slot = Number.isInteger(index) && index >= 0 && index < data.customSlots ? index : 0;
    const img = new Image();
    img.onload = () => {
      // 先按预算编码（普通图取第一档 1600/q0.82，与旧版画质一致；大图才会自动退档）
      const encoded = encodeWithinBudget(img);
      const sample = document.createElement("canvas");
      sample.width = 48; sample.height = Math.max(1, Math.round(48 * img.height / img.width));
      sample.getContext("2d").drawImage(img, 0, 0, sample.width, sample.height);
      const theme = {
        name: name || "\\u6211\\u7684\\u56fe\\u7247 " + (slot + 1),
        dataUrl: encoded.dataUrl,
        colors: extractPalette(sample),
        filledAt: Date.now(),
      };
      slots[slot] = theme;
      const persisted = saveCustoms(slots);
      renderSlot(slot);
      applyCustomTheme(theme, slot);
      if (!persisted) {
        // 压到阶梯最低档仍塞不下：本格现在能用，但刷新后会丢，明确告诉用户而不是静默失败
        toast("第 " + (slot + 1) + " 格图片已自动压到最小，但仍超出浏览器存储配额：本次可用，重启后会丢失。可先清掉几格再重传，或换张更小的图。");
      }
      resolve(theme.colors);
    };
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = dataUrl;
  });

  const buildSlotRow = (index) => {
    const item = document.createElement("div");
    item.style.cssText = "display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;";
    const dot = document.createElement("span");
    dot.style.cssText = "width:10px;height:10px;border-radius:50%;flex:none;box-sizing:border-box;background:transparent;";
    const text = document.createElement("span");
    text.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    const del = document.createElement("span");
    del.textContent = "\\u00d7";
    del.title = "\\u79fb\\u9664\\u8fd9\\u5f20\\u56fe\\u7247";
    del.style.cssText = "flex:none;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;color:rgba(0,0,0,.45);font-size:14px;";
    del.addEventListener("mouseenter", () => { del.style.background = "rgba(220,60,60,.15)"; del.style.color = "#c03030"; });
    del.addEventListener("mouseleave", () => { del.style.background = "transparent"; del.style.color = "rgba(0,0,0,.45)"; });
    del.addEventListener("click", (event) => { event.stopPropagation(); clearSlot(index); });
    item.append(dot, text, del);
    item.addEventListener("mouseenter", () => { if (document.documentElement.dataset.workbuddySkin !== customSlotId(index)) item.style.background = "rgba(0,0,0,.05)"; });
    item.addEventListener("mouseleave", () => paint(document.documentElement.dataset.workbuddySkin ?? null));
    item.addEventListener("click", () => {
      if (slots[index]) { applyCustomTheme(slots[index], index); panel.style.display = "none"; return; }
      const theme = themeAt(index);
      if (theme) { setTheme(theme.id); panel.style.display = "none"; return; }
      pendingSlot = index;
      picker.click();
    });
    panel.appendChild(item);
    return { item, dot, text, del };
  };

  for (let index = 0; index < data.customSlots; index += 1) slotRows[index] = buildSlotRow(index);

  const native = row("\\u539f\\u751f\\u754c\\u9762", "rgba(0,0,0,.24)", () => { clearTheme(); panel.style.display = "none"; });
  rows.set(null, native);

  // 有已装主题被清掉时，在「原生界面」上方插一行恢复入口
  let restoreRow = null;
  const renderRestoreRow = () => {
    const names = hidden.map((id) => data.themes.find((theme) => theme.id === id)?.name ?? id);
    if (names.length === 0) {
      restoreRow?.remove();
      restoreRow = null;
      return;
    }
    if (!restoreRow) {
      restoreRow = row("\\u21ba \\u6062\\u590d", "rgba(0,0,0,.24)", () => {
        const restored = hidden.splice(0, hidden.length);
        saveHidden();
        for (const id of restored) {
          const index = data.themes.findIndex((theme) => theme.id === id);
          // 恢复主题意味着这格要还给皮肤，占着它的自定义图让位
          if (index >= 0 && index < data.customSlots) slots[index] = null;
        }
        saveCustoms(slots);
        renderAllSlots();
        renderRestoreRow();
      }, native);
      const label = restoreRow.querySelector("span + span");
      label.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(0,0,0,.62);";
    }
    restoreRow.title = "\\u6062\\u590d\\u88ab\\u9690\\u85cf\\u7684\\u76ae\\u80a4\\uff1a" + names.join("\\u3001");
    restoreRow.querySelector("span + span").textContent = "\\u21ba \\u6062\\u590d\\u88ab\\u9690\\u85cf\\u7684\\u76ae\\u80a4";
  };

  section("薄纱浓度");
  for (const item of data.veils) presetRow("veil", item);
  section("背景取景");
  for (const item of data.framings) presetRow("framing", item);
  paintPresets();
  applyOverrides();

  renderAllSlots();
  renderRestoreRow();

  button.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  root.append(button, panel, picker);
  document.body.appendChild(root);
  // 还原上次的选择：自定义图片槽位 > 该格的已装主题 > 注入时带的默认主题。
  // 注：优先「先解析再应用」，避免先把默认主题写进 localStorage 又立刻被覆盖。
  const restoreActive = () => {
    const saved = readActive();
    if (saved && typeof saved === "object") {
      if (saved.k === "native") { clearTheme(); return; }
      if (saved.k === "slot" && Number.isInteger(saved.i) && saved.i >= 0 && saved.i < data.customSlots) {
        const custom = slots[saved.i];
        if (custom) { applyCustomTheme(custom, saved.i); return; }
        const skin = themeAt(saved.i);
        if (skin) { setTheme(skin.id); return; }
      }
      if (saved.k === "theme") {
        const theme = data.themes.find((candidate) => candidate.id === saved.id);
        if (theme && !hidden.includes(theme.id)) { setTheme(theme.id); return; }
      }
    }
    if (data.activeId === null) clearTheme();
    else setTheme(data.activeId);
  };
  restoreActive();

  // 供脚本化调用与测试：
  //   window.__workbuddySkin.importFromDataUrl(dataUrl, name)
  //   window.__workbuddySkin.setPreset("veil" | "framing", id)
  window.__workbuddySkin = {
    importFromDataUrl,
    setTheme,
    clearTheme,
    clearSlot,
    getSlots: () => slots.map((theme, index) => {
      if (theme) return { index, kind: "custom", name: theme.name, accent: theme.colors.accent };
      const skin = themeAt(index);
      return { index, kind: skin ? "theme" : "empty", name: skin?.name ?? null, accent: skin?.accent ?? null };
    }),
    getHiddenThemes: () => [...hidden],
    getActive: () => readActive(),
    restoreActive,
    getPresets: () => ({ ...presets }),
    getPresetOptions: () => ({
      veils: data.veils.map((item) => ({ id: item.id, name: item.name })),
      framings: data.framings.map((item) => ({ id: item.id, name: item.name })),
    }),
    setPreset: (group, id) => {
      if (group === "veil" && data.veils.some((item) => item.id === id)) presets.veil = id;
      else if (group === "framing" && data.framings.some((item) => item.id === id)) presets.framing = id;
      else return false;
      savePresets();
      applyOverrides();
      paintPresets();
      return true;
    },
  };
  return true;
})()`;
  // defer 模式：去掉末尾的调用括号 "()"，得到可赋值/可延后执行的函数表达式
  return defer ? source.slice(0, -2) : source;
}
