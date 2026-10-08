// WorkBuddy 皮肤 CSS 生成
// 基于实测：WorkBuddy renderer 的 body[data-application-name=workbuddy] 上有完整的
// --cb-* 设计变量系统（60+ 个），override 它们即可全局换色；#root 作背景图层。
// 不使用 CSS module 哈希类名（._grid_xxx），只用稳定锚点。
//
// 两条主线互相独立，调参时别混在一起：
//   1. 底图本身清不清晰 —— 属于素材问题，用 scripts/enhance-hero.py 处理；
//   2. 底图透出多少     —— 就是下面的「薄纱浓度」，只靠 CSS 调。
// 底图偏淡时单靠降薄纱只会得到「白雾」，必须先把底图提上去。

const DEFAULT_COLORS = {
  accent: "#24c9d7",
  secondary: "#ef8fd3",
  surface: "#f7fbff",
  text: "#17344f",
};

function color(value, fallback) {
  const result = value ?? fallback;
  if (!/^#[0-9a-f]{3,8}$/i.test(result)) throw new Error(`无效主题颜色：${result}`);
  return result;
}

function copy(value, fallback = "") {
  return JSON.stringify(typeof value === "string" ? value : fallback);
}

/* ── 薄纱浓度 ────────────────────────────────────────────────────────────
   所有「盖在底图上的白纱」的基准浓度（scale = 1 时的百分比）。
   数值越大越不透、越不抢戏；越小底图越清楚、文字也越难读。

   调这组数请小步走：实测从 34/38 一口气降到 24/26 会被要求退回，
   一次跨 20% 体感太猛，±5~8% 才是舒服的粒度。 */
const VEIL_BASE = {
  menubar: 34, // 顶部 30px 窗口菜单栏
  sidebar: 38, // 左侧边栏
  mainTop: 34, // 主内容区顶部
  mainBottom: 60, // 主内容区底部
  rootBottom: 58, // #root 底部渐变
  detail: 82, // 详情面板
  input: 36, // 输入框
  panel: 82, // --cb-panel-bg-primary / 卡片
  bgSecondary: 90, // --cb-bg-secondary
  vscodeSidebar: 85, // VS Code 式侧边栏
};

export const VEIL_PRESETS = [
  { id: "clear", name: "清透", scale: 0.45 },
  { id: "light", name: "较透", scale: 0.72 },
  { id: "normal", name: "标准", scale: 1 },
  { id: "firm", name: "较实", scale: 1.35 },
  { id: "dense", name: "浓实", scale: 1.7 },
];

const clampPct = (base, scale) => Math.max(0, Math.min(100, Math.round(base * scale)));

/* 底图取景：放大底图等于把人物拉近。cover 时图片宽度只有 ±3% 的水平余量，
   所以「左右移动」几乎没有意义；真正有效的是缩放。 */
export const FRAMING_PRESETS = [
  { id: "wide", name: "远景", size: "cover" },
  { id: "mid", name: "近景", size: "118% auto" },
  { id: "close", name: "特写", size: "136% auto" },
];

export function buildFramingCss(size = "cover") {
  return `html, body, #root {
  --wb-hero-size: ${size} !important;
}`;
}

export function buildVeilCss(scale = 1) {
  const v = Object.fromEntries(Object.entries(VEIL_BASE).map(([key, base]) => [key, clampPct(base, scale)]));
  return `/* ── 薄纱浓度 scale=${scale} ── */
body[data-application-name=workbuddy] {
  --cb-bg-secondary: color-mix(in srgb, var(--wb-surface) ${v.bgSecondary}%, transparent) !important;
  --cb-panel-bg-primary: color-mix(in srgb, var(--wb-surface) ${v.panel}%, transparent) !important;
  --cb-team-member-card-background: color-mix(in srgb, var(--wb-surface) ${v.panel}%, transparent) !important;
  --cb-vscode-sideBar-background: color-mix(in srgb, var(--wb-surface) ${v.vscodeSidebar}%, transparent) !important;
}

/* 顶部窗口 chrome：WorkBuddy 最上面有一条 30px 高的菜单栏/标题栏
   （#workbuddy-menubar-container，默认 rgb(242,242,242)），
   而 #root 是从 y=30px 才开始的 —— 所以那 30px 拿不到 #root 的底图。
   做法：把同一张底图也挂到 body 上（同样 fixed，按视口定位，
   与 #root 的底图完全对齐），再把这两层 chrome 变成半透明。 */
#workbuddy-menubar-container,
#workbuddy-titlebar-left-slot,
#workbuddy-window-controls-container,
.workbuddy-window-controls {
  background: color-mix(in srgb, var(--wb-surface) ${v.menubar}%, transparent) !important;
}

/* #root 的底图 + 底部渐变。底图走 --wb-hero 变量，这样切换浓度为预设时
   不必在每个预设里重复内嵌一遍 base64（一张图 ~800KB，重复 5 份会撑爆注入消息）。 */
#root {
  color: var(--wb-text) !important;
  background:
    linear-gradient(180deg, transparent 0 62%, color-mix(in srgb, var(--wb-surface) ${v.rootBottom}%, transparent) 92% 100%),
    var(--wb-hero) center center / var(--wb-hero-size) no-repeat fixed !important;
}

/* 侧边栏：透出底图，只留一层薄纱保证导航文字可读 */
[data-view-id=sidebar] {
  background: color-mix(in srgb, var(--wb-surface) ${v.sidebar}%, transparent) !important;
  border-right: 1px solid color-mix(in srgb, var(--wb-accent) 45%, transparent) !important;
}

/* 主内容区：上轻下重的可读性底衬 */
[data-view-id=main-content] {
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--wb-surface) ${v.mainTop}%, transparent) 0%,
    color-mix(in srgb, var(--wb-surface) ${v.mainBottom}%, transparent) 100%) !important;
}

[data-view-id=detail-panel] {
  background: color-mix(in srgb, var(--wb-surface) ${v.detail}%, transparent) !important;
}

/* 输入框（composer）：实测 .cr-input-container 是纯白 rgb(255,255,255) 硬底，
   是整条输入栈里唯一的不透明层；它内部再没有别的实底，所以只需处理这一层。
   注意 .cr-input-toolbar__right 自带白底，在纯白输入框上看不见，
   一旦输入框变透就会浮出一条白带，必须一并透明化（见下方静态规则）。 */
.cr-input-container {
  background: color-mix(in srgb, var(--wb-surface) ${v.input}%, transparent) !important;
}`;
}

export function buildSkinCss({ theme, heroDataUrl }) {
  if (!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(heroDataUrl)) {
    throw new Error("hero 必须是本地 PNG、JPEG 或 WebP 数据");
  }
  const colors = {
    accent: color(theme.colors?.accent, DEFAULT_COLORS.accent),
    secondary: color(theme.colors?.secondary, DEFAULT_COLORS.secondary),
    surface: color(theme.colors?.surface, DEFAULT_COLORS.surface),
    text: color(theme.colors?.text, DEFAULT_COLORS.text),
  };
  const id = String(theme.id ?? "custom").replace(/[^a-z0-9_-]/gi, "");

  return `/* WORKBUDDY_SKIN:${id} */
body[data-application-name=workbuddy] {
  --wb-accent: ${colors.accent};
  --wb-secondary: ${colors.secondary};
  --wb-surface: ${colors.surface};
  --wb-text: ${colors.text};

  /* 底图与取景：只在这里存一份 base64，薄纱预设与取景预设都复用它 */
  --wb-hero: url(${JSON.stringify(heroDataUrl)});
  --wb-hero-size: cover;

  /* 背景 */
  --cb-bg-primary: var(--wb-surface) !important;

  /* 文字：底图透出后，次级/禁用态文字要比默认更深，否则在图上读不清 */
  --cb-text-primary: color-mix(in srgb, var(--wb-text) 100%, transparent) !important;
  --cb-text-secondary: color-mix(in srgb, var(--wb-text) 90%, transparent) !important;
  --cb-text-disabled: color-mix(in srgb, var(--wb-text) 76%, transparent) !important;
  --cb-text-link: var(--wb-accent) !important;
  --cb-text-error-active: var(--wb-accent) !important;

  /* VS Code 主题色包装 */
  --cb-vscode-editor-background: var(--wb-surface) !important;
  --cb-vscode-foreground: var(--wb-text) !important;
  --cb-vscode-editor-foreground: var(--wb-text) !important;
  --cb-vscode-descriptionForeground: color-mix(in srgb, var(--wb-text) 70%, transparent) !important;
  --cb-vscode-titleBar-activeBackground: var(--wb-accent) !important;
  --cb-vscode-titleBar-activeForeground: #ffffff !important;
  --cb-vscode-titleBar-inactiveBackground: color-mix(in srgb, var(--wb-accent) 80%, var(--wb-surface)) !important;
  --cb-vscode-titleBar-inactiveForeground: color-mix(in srgb, #ffffff 70%, transparent) !important;
  --cb-titlebar-control-hover-background: color-mix(in srgb, var(--wb-accent) 16%, transparent) !important;
  --cb-vscode-input-background: color-mix(in srgb, var(--wb-surface) 88%, transparent) !important;
  --cb-vscode-dropdown-background: color-mix(in srgb, var(--wb-surface) 94%, transparent) !important;
  --cb-vscode-list-hoverBackground: color-mix(in srgb, var(--wb-accent) 16%, transparent) !important;
  --cb-vscode-toolbar-hoverBackground: color-mix(in srgb, var(--wb-accent) 16%, transparent) !important;
  --cb-vscode-scrollbarSlider-background: color-mix(in srgb, var(--wb-accent) 30%, transparent) !important;
  --cb-vscode-scrollbarSlider-hoverBackground: color-mix(in srgb, var(--wb-accent) 50%, transparent) !important;
  --cb-vscode-textLink-foreground: var(--wb-accent) !important;
  --cb-vscode-widget-border: color-mix(in srgb, var(--wb-accent) 45%, transparent) !important;
  --cb-vscode-panel-border: color-mix(in srgb, var(--wb-accent) 30%, transparent) !important;

  /* 按钮 */
  --cb-button-dark-background: var(--wb-accent) !important;
  --cb-button-dark-foreground: #ffffff !important;
  --cb-button-dark-hover-background: color-mix(in srgb, var(--wb-accent) 85%, #000000) !important;
  --cb-vscode-button-background: var(--wb-accent) !important;
  --cb-vscode-button-foreground: #ffffff !important;
  --cb-vscode-button-hoverBackground: color-mix(in srgb, var(--wb-accent) 85%, #000000) !important;

  /* 描边 */
  --cb-stroke-secondary: color-mix(in srgb, var(--wb-accent) 45%, transparent) !important;
  --cb-markdown-hr-border-color: color-mix(in srgb, var(--wb-accent) 30%, transparent) !important;

  /* 顶部 30px 拿不到 #root 的底图，所以 body 上也挂一份，两层用同一个 fixed 定位自动对齐 */
  background: var(--wb-hero) center center / var(--wb-hero-size) no-repeat fixed !important;

  /* 5.7.x 新增：整壳背景图 token。默认 none，但一旦被主题/活动换上，
     它会画在 .teams-container 上盖住底图 —— 这里钉死为 none。 */
  --wb-home-bg-image: none !important;
}

/* 关键：teams-container 是 #root 直接子层，默认有不透明灰底，会完全盖住背景图。
   5.6.x 是硬编码 rgb(255,255,255)；5.7.x 改为 background-color:var(--wb-home-bg-primary)
   （.teams-container.is-mac 里为 #f2f2f2），外加 background-image:var(--wb-home-bg-image)。
   注意：不要图省事去改 --wb-home-bg-* 这两个 token —— 它们是全局变量，还会被
   .cfp-type-dropdown__menu、.cfp-card、.skill-picker-panel 这类必须不透明的浮层复用，
   置空会让下拉菜单和卡片变透明、文字糊在底图上。逐层覆盖背景才是安全的。 */
.teams-container,
.teams-container.is-mac {
  background: transparent !important;
  background-image: none !important;
}

/* 所有 grid 项容器透明，让 #root 背景图大面积透出。
   5.7.x 里 .teams-container [data-view-id=sidebar] 用 --wb-home-bg-primary、
   .teams-container [data-view-id]:not([data-view-id=sidebar]) 用 --wb-home-bg-secondary，
   两条都是非 !important 规则，会被下面这条盖掉。 */
[data-view-id] {
  background: transparent !important;
}

/* 内容区内的子层也透明（否则会盖住背景图和薄纱层）
   注：.workbuddy-topbar 默认有不透明 rgb(20,20,20) 硬底 + 1px solid rgb(242,242,242) 底边，
   会挡住主内容区顶栏的底图并产生一条白线。
   5.7.x 新增 .main-content--chat / .main-content--initializing / .main-content--genie
   三个变体，它们同样用 --wb-home-bg-secondary 铺满整屏（含 .workbuddy-topbar.ec-topbar），
   必须一并列进来，否则对话页会退回一整块白。 */
.conversation-list,
.main-content,
.main-content--welcome,
.main-content--chat,
.main-content--initializing,
.main-content--genie,
.main-content-panel-shell,
.sidebar-next,
.workbuddy-topbar,
.workbuddy-topbar::before,
.workbuddy-topbar-options {
  background: transparent !important;
  border-bottom: 0 !important;
}

/* 实测遮罩层。5.6.2 起新增了一批铺满全屏的不透明层：
   .teams-grid-scroll-content 是 #root 的直接子层，默认纯白硬底 rgb(255,255,255)，
   会整块盖住 #root 的底图；conversation-shell / detail-panel / detail-main__body
   同为不透明白底，一并透明化。
   另外 ._gridView_xxx_9 这类 CSS-module 网格容器用的是 --cb-panel-bg-primary，
   铺满全屏会把底图压成一层白纱，必须透明；
   它后面的 [data-view-id=sidebar] / main-content 规则会重新给各自面板上色。

   .wb-home-route 是「新建任务」页（WorkBuddy, 我帮你）的 <main> 根容器，
   默认纯白硬底铺满 1443x989，把底图整块盖死。
   它是独立路由视图，和对话页不共用容器，所以必须单独列出来。

   ── 5.7.x 的变化 ──
   5.7.x 把上面这些硬编码白底统一收敛成了 --wb-home-bg-secondary
   （.teams-container.is-mac 内为 #fff），容器名基本沿用了下来，但新增了
   若干独立路由页的根容器，它们各自铺满全屏、互不共用：
     .claw-agent-chat-pane  智能体对话
     .atm-detail-page       自动化详情
     .project-detail-view   项目详情（含 __top-tabs / __input-area--project）
     .skills-view           技能页
     .skill-market          技能市场
     .connector-panel       连接器面板
     .discover-panel-page   发现页
     .expert-center-page    专家中心
     .kb-onboarding-panel   知识库引导
     .workspace-preparing   工作区准备中
     .welcome               欢迎页
   下面这份名单同时覆盖 5.6.x / 5.7.x 两代。 */
.teams-grid-scroll-content,
[class*="gridView"],
.conversation-shell,
.conversation-route,
.detail-panel,
.detail-main__body,
.detail-layout,
.sidebar-next-main-header,
.sources-panel,
.conversation-section-label,
.wb-home-route,
[class*="wb-home-route"],
.wb-home-page,
.claw-agent-chat-pane,
.atm-detail-page,
.project-detail-view,
.project-detail-view__input-area--project,
.skills-view,
.skill-market,
.connector-panel,
.discover-panel-page,
.expert-center-page,
.kb-onboarding-panel,
.workspace-preparing,
.welcome {
  background: transparent !important;
}

/* 5.7.x 新增：输入框顶部那道 72px 的渐隐白带。
   选择器是 CSS-module 哈希类名 [class*=input-area-container]::before，
   底色同样来自 --wb-home-bg-secondary，且 top:-48px、左右各内缩 16px ——
   它会从 composer 顶边向上溢出 48px，正好压在底图正中偏下，
   是「输入框上方浮出一片白雾」的新来源。
   这里只在这个伪元素作用域内把 token 置空（不影响 .cfp-* 等浮层），
   再显式清掉 background，双保险。 */
[class*=input-area-container]::before {
  --wb-home-bg-secondary: transparent;
  --cb-colleagues-prompt-bg: transparent;
  background: none !important;
}

${buildVeilCss(1)}

/* 详情面板额外做一层磨砂（浓度同样由薄纱规则控制） */
[data-view-id=detail-panel] {
  backdrop-filter: blur(18px) saturate(1.08);
}

/* 输入框的非浓度属性（浓度由上面的薄纱规则控制）
   backdrop-filter 刻意不加 blur：底图偏淡时大模糊会把仅有的线稿糊成纯白，
   「透明」和「不透明白」肉眼就分不出来了。saturate/contrast 反而能把线条拉出来。 */
.cr-input-container {
  border: 1px solid color-mix(in srgb, var(--wb-accent) 34%, transparent) !important;
  box-shadow:
    0 10px 24px -16px color-mix(in srgb, var(--wb-text) 30%, transparent),
    0 1px 2px color-mix(in srgb, var(--wb-text) 5%, transparent) !important;
  backdrop-filter: saturate(1.4) contrast(1.06);
}

/* 输入框底部的工具栏分组也带白底（.cr-input-toolbar__right），
   浮在薄纱层上会显出一条突兀的白带，一并透明化。 */
.cr-input-toolbar,
.cr-input-toolbar__left,
.cr-input-toolbar__right,
.cr-input-editor-host,
.cr-input-box,
.cr-input-box__main {
  background: transparent !important;
}

/* brand 文案（copy 为空时不显示） */
#root::before {
  position: fixed;
  z-index: 20;
  top: 60px;
  left: max(300px, 22vw);
  content: ${copy(theme.copy?.brand)};
  color: var(--wb-accent);
  font: 800 clamp(16px, 2vw, 30px)/1.2 ui-rounded, system-ui;
  text-shadow: 0 2px 10px white;
  pointer-events: none;
}

/* headline 文案 */
#root::after {
  position: fixed;
  z-index: 20;
  top: 104px;
  left: max(300px, 22vw);
  max-width: 42vw;
  content: ${copy(theme.copy?.headline)};
  color: var(--wb-text);
  font: 750 clamp(18px, 2.7vw, 42px)/1.15 ui-rounded, system-ui;
  text-shadow: 0 2px 12px white;
  pointer-events: none;
}
`;
}
