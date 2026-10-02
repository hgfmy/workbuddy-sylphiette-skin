// WorkBuddy Skin Studio - fast-attach：事件驱动的秒级注入通道。
//
// 与旧的「轮询 + spawn apply 子进程」路线不同，本模块在守护进程与 WorkBuddy
// CDP 浏览器端点之间维持一条常驻 WebSocket：
//   1. Target.setAutoAttach(flatten) —— 任何渲染目标出现（新窗口 / 重启 / 冷启动）
//      都会立刻收到 attachedToTarget 事件；
//   2. Page.addScriptToEvaluateOnNewDocument —— 把皮肤脚本注册成「新文档起始脚本」，
//      之后每次导航、刷新、首次加载，脚本都在 first paint 之前执行；
//   3. 对已存在的文档补一次 Runtime.evaluate，覆盖「注册时页面已加载完」的情况。
// 效果：皮肤在文档创建的同一帧内就位，无需等页面渲染完再补。
//
// 断线（WorkBuddy 退出 / 重启）自动重连；连接存活期间不占轮询。

import { RENDERER_URL_HINT } from "./constants.mjs";

const RECONNECT_DELAY_MS = 500;
const COMMAND_TIMEOUT_MS = 10000;

function isRelevantPage(targetInfo) {
  if (!targetInfo || targetInfo.type !== "page") return false;
  const url = String(targetInfo.url ?? "");
  // 渲染目标已定型 → 直接注入；尚在 about:blank → 先注册新文档脚本，等它导航到 renderer
  return url.includes(RENDERER_URL_HINT) || url === "about:blank" || url === "";
}

export function startFastAttach({ port, script, log = () => {} }) {
  if (!Number.isInteger(port)) throw new TypeError("port must be an integer");
  if (typeof script !== "string" || script.length === 0) throw new TypeError("script must be a non-empty string");

  let stopped = false;
  let ws = null;
  let reconnectTimer = null;
  let connecting = false;
  let nextId = 1;
  let connectEpoch = 0;

  const pending = new Map(); // "sessionId|id" -> { resolve, reject, timer, method }
  const sessions = new Map(); // sessionId -> { url, registered }

  const key = (sessionId, id) => `${sessionId ?? ""}|${id}`;

  function failAllPending(reason) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`fast-attach: ${reason}`));
    }
    pending.clear();
  }

  function rawSend(method, params = {}, sessionId = undefined, timeoutMs = COMMAND_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) {
        reject(new Error("fast-attach: socket 未打开"));
        return;
      }
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        pending.delete(key(sessionId, id));
        reject(new Error(`fast-attach: ${method} 超时 (${timeoutMs}ms)`));
      }, timeoutMs);
      pending.set(key(sessionId, id), { resolve, reject, timer, method });
      try {
        ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(key(sessionId, id));
        reject(new Error(`fast-attach: 发送 ${method} 失败: ${error?.message ?? error}`));
      }
    });
  }

  async function injectInto(sessionId, url) {
    const state = sessions.get(sessionId);
    if (state?.registered) {
      // 早已注册过新文档脚本：只需给当前文档补一次
      await rawSend("Runtime.evaluate", { expression: script, returnByValue: true, awaitPromise: true }, sessionId);
      return "reapplied";
    }
    await rawSend("Page.enable", {}, sessionId);
    await rawSend("Page.addScriptToEvaluateOnNewDocument", { source: script }, sessionId);
    sessions.set(sessionId, { url, registered: true });
    await rawSend("Runtime.evaluate", { expression: script, returnByValue: true, awaitPromise: true }, sessionId);
    return "registered+applied";
  }

  async function handleAttach(params) {
    const { sessionId, targetInfo } = params ?? {};
    if (!sessionId || !isRelevantPage(targetInfo)) return;
    const url = String(targetInfo.url ?? "");
    sessions.set(sessionId, { url, registered: false });
    try {
      const mode = await injectInto(sessionId, url);
      log(`fast-attach: 目标已就位 [${mode}] ${url.slice(0, 72)}`);
    } catch (error) {
      sessions.delete(sessionId);
      // about:blank 阶段 evaluate 失败是常态（无 DOM），脚本注册成功即达标
      log(`fast-attach: 注入受阻（将随新文档自动补上）: ${error?.message ?? error}`);
    }
  }

  function handleMessage(data) {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (Number.isInteger(message?.id)) {
      const entry = pending.get(key(message.sessionId, message.id));
      if (!entry) return;
      pending.delete(key(message.sessionId, message.id));
      clearTimeout(entry.timer);
      if (message.error) {
        entry.reject(new Error(`fast-attach: ${entry.method} 失败: ${message.error.message ?? "unknown"}`));
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    if (message.method === "Target.attachedToTarget") {
      handleAttach(message.params).catch((error) => log(`fast-attach: attach 处理异常: ${error?.message ?? error}`));
    } else if (message.method === "Target.detachedFromTarget") {
      sessions.delete(message.params?.sessionId);
    }
  }

  function scheduleReconnect(delayMs = RECONNECT_DELAY_MS) {
    if (stopped) return;
    connectEpoch += 1;
    failAllPending("socket 已关闭");
    sessions.clear();
    ws = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, delayMs);
  }

  async function connect() {
    if (stopped || connecting) return;
    connecting = true;
    const epoch = connectEpoch;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
      const info = await response.json();
      const wsUrl = info?.webSocketDebuggerUrl;
      if (typeof wsUrl !== "string" || wsUrl.length === 0) throw new Error("browser 端点缺少 webSocketDebuggerUrl");
      if (stopped || epoch !== connectEpoch) return;

      const socket = new WebSocket(wsUrl);
      ws = socket;
      socket.onopen = () => {
        if (stopped || epoch !== connectEpoch) return;
        log("fast-attach: 已连接 CDP 浏览器通道");
        rawSend("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
          .catch((error) => log(`fast-attach: setAutoAttach 失败: ${error?.message ?? error}`));
      };
      socket.onmessage = (event) => {
        if (typeof event?.data === "string") handleMessage(event.data);
      };
      socket.onclose = () => {
        if (epoch === connectEpoch && !stopped) {
          log("fast-attach: 连接断开，0.5s 后重连");
          scheduleReconnect();
        }
      };
      socket.onerror = () => {}; // onclose 必然跟随，不重复处理
    } catch {
      if (!stopped && epoch === connectEpoch) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS + 200);
    } finally {
      connecting = false;
    }
  }

  connect();

  return {
    stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      failAllPending("fast-attach 已停止");
      sessions.clear();
      try { ws?.close(); } catch {}
      ws = null;
    },
    // 当前是否有一条健康连接且至少挂住了一个渲染目标
    get healthy() {
      return Boolean(ws && ws.readyState === 1 && sessions.size > 0);
    },
    get sessionCount() {
      return sessions.size;
    },
    // 安全网：向所有已挂目标重新补一次当前文档注入
    async reapply() {
      const ids = [...sessions.keys()];
      let done = 0;
      for (const sessionId of ids) {
        try {
          await rawSend("Runtime.evaluate", { expression: script, returnByValue: true, awaitPromise: true }, sessionId);
          done += 1;
        } catch {
          sessions.delete(sessionId);
        }
      }
      return done;
    },
  };
}
