import "./styles.css";
import { createStore, defaultMetrics } from "./state/store.js";
import { loadContentBundle } from "./state/content.js";
import { storage } from "./state/storage.js";
import { clamp01, downloadJson, safeJsonParse } from "./util.js";
import { renderTask } from "./tasks/index.js";

const APP_VERSION = "0.1.0";
const SAVE_KEY = "ai_pm_sim_save_v1";

const appEl = document.getElementById("app");
const store = createStore({
  appVersion: APP_VERSION,
  metrics: defaultMetrics(),
  mode: "boot",
  locale: "zh-CN",
  contentMode: "public",
  contentPrivateAvailable: false,
  sceneId: "start",
  chapterIndex: 0,
  deliverables: {},
  history: [],
  flags: {},
  ui: { cardsOpen: false },
  roleplay: { loading: false, error: null, threads: {}, health: { ok: false, checked: false, message: "" } },
  clockMs: 0
});

let content = null;
let renderScheduled = false;

function initGlobalHooks() {
  window.render_game_to_text = () => {
    const state = store.get();
    const scene = content?.scenes?.find((s) => s.id === state.sceneId) ?? null;
    const payload = {
      coordinate_system: "UI-based; not a spatial game. origin: N/A, axis: N/A.",
      mode: state.mode,
      sceneId: state.sceneId,
      sceneTitle: scene?.title ?? "",
      chapterIndex: state.chapterIndex,
      contentMode: state.contentMode,
      metrics: state.metrics,
      clickableOptionIds: (scene?.options ?? []).map((o) => o.id),
      task: scene?.task ? { type: scene.task.type, status: state.flags?.taskStatus?.[scene.id] ?? "idle" } : null,
      roleplay: scene?.roleplay ? { id: scene.roleplay.id ?? scene.id, title: scene.roleplay.title ?? "" } : null
    };
    return JSON.stringify(payload);
  };

  window.advanceTime = async (ms) => {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i++) tick(1000 / 60);
    scheduleRender();
  };

  window.__AI_PM_SIM__ = {
    store,
    getContent: () => content,
    save: () => doSave(),
    load: () => doLoad(),
    reset: () => resetGame({ keepContentMode: true })
  };
}

function tick(dtMs) {
  const state = store.get();
  store.set({ clockMs: state.clockMs + dtMs });
}

function percentFromMetricValue(v) {
  return clamp01((v + 2) / 4);
}

function metricLabel(key) {
  const map = {
    efficiency: "Efficiency",
    accuracy: "Accuracy",
    ux: "UX",
    cost: "Cost",
    risk: "Risk"
  };
  return map[key] ?? key;
}

function fmtMetric(v) {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}

function doSave() {
  const state = store.get();
  const payload = JSON.stringify({
    savedAt: Date.now(),
    appVersion: APP_VERSION,
    state
  });
  storage.setItem(SAVE_KEY, payload);
  flashToast("已保存到本地");
}

function doLoad() {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) {
    flashToast("本地没有存档");
    return;
  }
  const parsed = safeJsonParse(raw);
  if (!parsed?.state) {
    flashToast("存档损坏，无法读取");
    return;
  }
  const { aiLab, roleplay, ...rest } = parsed.state ?? {};
  const next = {
    ...rest,
    roleplay: roleplay ?? {
      loading: false,
      error: null,
      threads: {},
      health: store.get().roleplay?.health ?? { ok: false, checked: false, message: "" }
    }
  };
  const loadedScene = content?.scenes?.find((s) => s.id === next.sceneId) ?? null;
  const nextChapterIndex = typeof loadedScene?.chapter === "number" ? Math.max(0, loadedScene.chapter - 1) : next.chapterIndex ?? 0;
  store.set({ ...next, chapterIndex: nextChapterIndex, mode: "playing" });
  flashToast("已读取存档");
}

function resetGame({ keepContentMode }) {
  const prev = store.get();
  store.set({
    appVersion: APP_VERSION,
    metrics: defaultMetrics(),
    mode: "playing",
    locale: "zh-CN",
    contentMode: keepContentMode ? prev.contentMode : "public",
    contentPrivateAvailable: prev.contentPrivateAvailable,
    sceneId: "start",
    chapterIndex: 0,
    deliverables: {},
    history: [],
    flags: {},
    roleplay: { loading: false, error: null, threads: {}, health: prev.roleplay?.health ?? { ok: false, checked: false, message: "" } },
    clockMs: 0
  });
}

function applyDelta(delta) {
  if (!delta) return;
  const state = store.get();
  const nextMetrics = { ...state.metrics };
  for (const [k, v] of Object.entries(delta)) {
    if (typeof nextMetrics[k] === "number") nextMetrics[k] = Number(nextMetrics[k] + v);
  }
  store.set({ metrics: nextMetrics });
}

function setTaskStatus(sceneId, status) {
  const state = store.get();
  const taskStatus = { ...(state.flags?.taskStatus ?? {}) };
  if (taskStatus[sceneId] === status) return;
  taskStatus[sceneId] = status;
  store.set({ flags: { ...(state.flags ?? {}), taskStatus } });
}

function recordHistory(entry) {
  const state = store.get();
  const next = state.history.slice();
  next.push({ at: Date.now(), ...entry });
  store.set({ history: next });
}

function goToScene(sceneId) {
  const nextScene = content?.scenes?.find((s) => s.id === sceneId) ?? null;
  const nextChapterIndex = typeof nextScene?.chapter === "number" ? Math.max(0, nextScene.chapter - 1) : store.get().chapterIndex;
  store.set({ sceneId, chapterIndex: nextChapterIndex, mode: "playing" });
}

function completeTask(scene, result) {
  setTaskStatus(scene.id, "completed");
  const state = store.get();
  const deliverables = { ...state.deliverables };
  deliverables[scene.id] = result.deliverable;
  store.set({ deliverables });
  if (result?.delta) applyDelta(result.delta);
  recordHistory({ kind: "task", sceneId: scene.id, deliverable: result.deliverable, delta: result.delta });
  if (scene.task?.onCompleteNext) goToScene(scene.task.onCompleteNext);
  doSave();
}

function onChoose(scene, option) {
  applyDelta(option.delta);
  recordHistory({ kind: "choice", sceneId: scene.id, optionId: option.id, delta: option.delta, note: option.note ?? "" });
  if (option.next) goToScene(option.next);
  doSave();
}

function hasPrivateContent() {
  return store.get().contentPrivateAvailable;
}

function getScene() {
  const state = store.get();
  return content?.scenes?.find((s) => s.id === state.sceneId) ?? null;
}

function renderMetricsPanel() {
  const state = store.get();
  const keys = Object.keys(state.metrics);
  return `
    <div class="panel">
      <div class="hd">
        <h2>指标面板</h2>
        <span class="pill">范围: -2.00 ~ +2.00</span>
      </div>
      <div class="bd">
        <div class="metrics">
          ${keys
            .map((k) => {
              const v = state.metrics[k];
              const p = Math.round(percentFromMetricValue(v) * 100);
              return `
                <div class="metric">
                  <div class="row">
                    <div class="name">${metricLabel(k)}</div>
                    <div class="val">${fmtMetric(v)} (${p}%)</div>
                  </div>
                  <div class="bar"><i style="width:${p}%"></i></div>
                </div>
              `;
            })
            .join("")}
        </div>
        <div class="inline-note" style="margin-top:12px">
          指标不是“真实业务数据”，而是把取舍结果映射成可解释的训练反馈。
        </div>
      </div>
    </div>
  `;
}

function renderStart(scene) {
  const state = store.get();
  return `
    <div class="panel">
      <div class="hd"><h2>开始</h2><span class="pill">MVP</span></div>
      <div class="bd">
        <div class="scene">
          <h3>${scene.title}</h3>
          <div class="body">${formatBody(scene.body)}</div>
          <div class="choices">
            <button id="start-btn" class="btn-primary" style="padding:12px 14px">开始一局（30–45 分钟）</button>
            <button id="load-btn">读取本地存档</button>
            <button id="reset-btn" class="btn-danger">清空进度并重开</button>
          </div>
          <div class="inline-note">
            推荐玩法: 先按提示完成每章 1 个任务，再看结算页生成的“作品集摘要”。
          </div>
          <div class="inline-note">
            公开版默认可离线游玩，AI 功能是可选增强，不影响完整通关与学习路径。
          </div>
        </div>
        <div class="task" style="margin-top:16px">
          <div class="grid-2">
            <div class="card">
              <div class="k">内容版本</div>
              <div class="v">
                <div class="row" style="margin-top:8px">
                  <select id="content-mode">
                    <option value="public" ${state.contentMode === "public" ? "selected" : ""}>Public（默认虚构化）</option>
                    <option value="private" ${state.contentMode === "private" ? "selected" : ""} ${hasPrivateContent() ? "" : "disabled"}>Private（本地真名版）</option>
                  </select>
                </div>
                ${
                  hasPrivateContent()
                    ? `<div class="inline-note" style="margin-top:10px">检测到本地 private 内容文件，可切换。</div>`
                    : `<div class="inline-note" style="margin-top:10px">未检测到 private 内容文件。若需要真名版，请按 README 创建它们（默认已 gitignore）。</div>`
                }
              </div>
            </div>
            <div class="card">
              <div class="k">说明</div>
              <div class="v">
                这是“AI 产品经理实习”教育模拟游戏。所有指标、流程与数值为训练用途的抽象，不代表任何真实公司内部信息或真实业务表现。
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAbout() {
  return `
    <div class="panel">
      <div class="hd"><h2>About</h2><span class="pill">合规护栏</span></div>
      <div class="bd">
        <div class="scene">
          <h3>这款游戏如何帮助你练 PM 能力</h3>
          <div class="body">
            <p>你会在 4 章里完成一次完整的 PM 闭环: 立项→洞察→设计→交付→复盘。</p>
            <p>每章会产出一个“小交付物”，并把你的决策映射到 5 个指标（效率、准确性、体验、成本、风险），给到可解释反馈。</p>
            <p>Public 版本默认虚构化，不包含真实公司名、内部指标、内部系统名等敏感信息；Private 版本仅供本地使用，且默认已被 gitignore 防止误提交。</p>
          </div>
          <div class="choices">
            <button id="back-btn">返回</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderEnd(scene) {
  const state = store.get();
  const deliverableList = Object.entries(state.deliverables);
  const summaryText = buildPortfolioSummary();
  return `
    <div class="panel">
      <div class="hd"><h2>结算</h2><span class="pill">作品集摘要</span></div>
      <div class="bd">
        <div class="scene">
          <h3>${scene.title}</h3>
          <div class="body">${formatBody(scene.body)}</div>
          <div class="task">
            <div class="card">
              <div class="k">你的交付物</div>
              <div class="v">
                <ul style="margin:8px 0 0; padding-left:18px">
                  ${
                    deliverableList.length
                      ? deliverableList.map(([sceneId, d]) => `<li><span class="pill">${sceneId}</span> ${escapeHtml(d?.title ?? d?.type ?? "Deliverable")}</li>`).join("")
                      : "<li>（本局未产生交付物）</li>"
                  }
                </ul>
              </div>
            </div>
            <div class="card" style="margin-top:10px">
              <div class="k">可复制的作品集摘要</div>
              <div class="v">
                <textarea id="portfolio-text" readonly>${escapeHtml(summaryText)}</textarea>
                <div class="row" style="margin-top:10px">
                  <button id="copy-portfolio" class="btn-primary">复制文本</button>
                  <button id="download-json">下载 JSON</button>
                </div>
                <div class="inline-note">
                  提示: 你可以把这段摘要改写成简历 bullet，并在面试时用“为什么这样取舍、如何验证、如何处理 bad case”展开。
                </div>
              </div>
            </div>
          </div>
          <div class="choices">
            <button id="restart-btn" class="btn-primary">再来一局</button>
            <button id="back-start-btn">回到首页</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderScene(scene) {
  const state = store.get();
  const tag = scene.tag ? `<span class="pill">${scene.tag}</span>` : "";
  const chapter = scene.chapter ? `<span class="pill">Chapter ${scene.chapter}</span>` : "";
  const taskStatus = state.flags?.taskStatus?.[scene.id] ?? "idle";
  const noteHtml = scene.note ? `<div class="inline-note">${scene.note}</div>` : "";

  const optionsHtml = (scene.options ?? [])
    .map((o) => {
      return `
        <button class="choice" data-choice="${o.id}">
          <div class="t">${o.label}</div>
          <div class="s">${o.subtitle ?? ""}</div>
        </button>
      `;
    })
    .join("");

  const taskHtml = scene.task
    ? `
      <div class="task" id="task-root" data-task-type="${scene.task.type}">
        <div class="row" style="align-items:flex-start">
          <div style="flex:1">
            <div class="pill">任务</div>
            <div style="margin-top:8px; color: rgba(255,255,255,0.88); font-size:14px; line-height:1.6">${scene.task.prompt}</div>
          </div>
          <div class="pill" id="task-status">状态: ${taskStatus}</div>
        </div>
        <div id="task-ui" style="margin-top:12px"></div>
      </div>
    `
    : "";

  const extra = scene.extra ? `<div class="inline-note">${scene.extra}</div>` : "";
  return `
    <div class="panel">
      <div class="hd">
        <h2>场景</h2>
        <div style="display:flex; gap:8px; align-items:center">
          ${chapter}
          ${tag}
        </div>
      </div>
      <div class="bd">
        <div class="scene">
          <h3>${scene.title}</h3>
          <div class="meta">
            <span class="pill">章节进度: ${Math.max(0, state.chapterIndex + 1)}/4</span>
            <span class="pill">内容: ${state.contentMode}</span>
          </div>
          <div class="body">${formatBody(scene.body)}</div>
          ${noteHtml}
          ${extra}
          ${scene.options?.length ? `<div class="choices">${optionsHtml}</div>` : ""}
          ${taskHtml}
        </div>
      </div>
    </div>
  `;
}

function renderRightPanel() {
  const scene = getScene();
  if (!scene) return `<div class="panel"><div class="hd"><h2>加载中</h2></div><div class="bd">…</div></div>`;
  if (scene.id === "start") return renderStart(scene);
  if (scene.id === "about") return renderAbout();
  if (scene.id === "end") return renderEnd(scene);
  const roleplayPanel = scene.roleplay ? renderRoleplay(scene) : "";
  return `
    <div style="display:grid; gap:14px">
      ${renderScene(scene)}
      ${roleplayPanel}
    </div>
  `;
}

function renderTopbar() {
  const state = store.get();
  return `
    <div class="topbar">
      <div class="brand">
        <h1>AI 产品经理·宠物鉴别实习模拟器</h1>
        <span class="pill">v${APP_VERSION}</span>
      </div>
      <div class="top-actions">
        <button id="save-btn">保存</button>
        <button id="export-btn">导出存档</button>
        <button id="import-btn">导入存档</button>
        <button id="cards-btn">知识卡</button>
        <button id="about-btn">About</button>
      </div>
    </div>
  `;
}

function renderRoleplay(scene) {
  const state = store.get();
  const rp = scene.roleplay ?? {};
  const roleplayId = rp.id ?? scene.id;
  const thread = getRoleplayThread(roleplayId);
  const displayThread = thread.length ? thread : (rp.starter ?? []);
  const health = state.roleplay?.health ?? { ok: false, checked: false, message: "" };
  const statusLabel = health.checked ? (health.ok ? "AI 在线" : "AI 离线") : "AI 未检测";
  const statusNote = health.checked
    ? health.ok
      ? "可用：将角色扮演对话延展到更真实的沟通场景。"
      : "未检测到 AI 服务，已切换为离线脚本模式。"
    : "尚未检测 AI 服务，默认使用离线脚本模式。";

  return `
    <div class="panel">
      <div class="hd">
        <h2>协作现场</h2>
        <span class="pill">${statusLabel}</span>
      </div>
      <div class="bd">
        <div class="card">
          <div class="k">${escapeHtml(rp.title ?? "角色扮演")}</div>
          <div class="v" style="margin-top:8px; line-height:1.6">${formatBody(rp.scenario ?? "")}</div>
          ${
            Array.isArray(rp.goals) && rp.goals.length
              ? `<div style="margin-top:8px"><b>你的目标</b>：${rp.goals.map(escapeHtml).join("；")}</div>`
              : ""
          }
          ${
            Array.isArray(rp.roles) && rp.roles.length
              ? `<div style="margin-top:6px"><b>参与角色</b>：${rp.roles.map(escapeHtml).join("、")}</div>`
              : ""
          }
          <div class="inline-note" style="margin-top:10px">${statusNote}</div>
        </div>

        <div class="card" style="margin-top:10px">
          <div class="k">对话记录</div>
          <div class="chat">
            ${
              displayThread.length
                ? displayThread
                    .map((m) => {
                      const role = m.role ?? "系统";
                      const cls = role === "你" ? "you" : role === "AI" ? "ai" : "system";
                      return `
                        <div class="chat-msg ${cls}">
                          <div class="meta">${escapeHtml(role)}</div>
                          <div class="text">${formatBody(m.text ?? "")}</div>
                        </div>
                      `;
                    })
                    .join("")
                : `<div class="inline-note">还没有对话，先从快捷回复或输入内容开始。</div>`
            }
          </div>
          ${
            state.roleplay?.error
              ? `<div class="error" style="margin-top:8px">${escapeHtml(state.roleplay.error)}</div>`
              : ""
          }
        </div>

        <div class="card" style="margin-top:10px">
          <div class="k">你的回应</div>
          <div class="v">
            <div class="row" style="flex-wrap:wrap; gap:8px">
              ${(rp.quickReplies ?? [])
                .map(
                  (q) => `
                    <button class="btn" data-roleplay-quick="${escapeHtml(q.text)}" ${state.roleplay?.loading ? "disabled" : ""}>
                      ${escapeHtml(q.label)}
                    </button>
                  `
                )
                .join("")}
            </div>
            <textarea id="roleplay-input" placeholder="写一句回应（澄清口径/提出假设/确认下一步）"></textarea>
            <div class="row" style="margin-top:10px">
              <button id="roleplay-send" class="btn-primary" ${state.roleplay?.loading ? "disabled" : ""}>发送</button>
              <button id="roleplay-clear" ${state.roleplay?.loading ? "disabled" : ""}>清空对话</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function getRoleplayThread(roleplayId) {
  const state = store.get();
  return state.roleplay?.threads?.[roleplayId] ?? [];
}

function getRoleplayThreadForModel(scene, roleplayId) {
  const thread = getRoleplayThread(roleplayId);
  if (thread.length) return thread;
  return (scene?.roleplay?.starter ?? []).map((m) => ({ role: m.role ?? "系统", text: m.text ?? "" }));
}

function setRoleplayThread(roleplayId, thread) {
  const state = store.get();
  const threads = { ...(state.roleplay?.threads ?? {}) };
  threads[roleplayId] = thread;
  store.set({ roleplay: { ...(state.roleplay ?? {}), threads } });
}

function appendRoleplayMessage(roleplayId, message) {
  const thread = getRoleplayThread(roleplayId);
  const next = thread.concat([{ at: Date.now(), ...message }]);
  setRoleplayThread(roleplayId, next);
}

function localRoleplayReply(scene, userText) {
  const rp = scene?.roleplay ?? {};
  const fallbacks = Array.isArray(rp.fallbacks) && rp.fallbacks.length ? rp.fallbacks : [
    "我先确认一下口径和目标，避免我们在不同定义上讨论。",
    "我建议先明确主指标与护栏指标，再决定是否放量。",
    "我可以先出一个最小闭环的方案，验证后再扩展。",
    "为了降低风险，我建议加入低置信度兜底与回滚开关。"
  ];
  const pick = fallbacks[Math.floor(Math.random() * fallbacks.length)];
  if (!userText) return pick;
  return `${pick}\n\n补充：关于你刚才提到的“${userText.slice(0, 24)}…”，我会整理一版行动清单。`;
}

function renderCardsModal() {
  const state = store.get();
  if (!state.ui?.cardsOpen) return "";
  const cards = content?.cards ?? [];
  return `
    <div id="cards-modal" style="position:fixed; inset:0; background: rgba(0,0,0,0.55); z-index:60; display:flex; align-items:center; justify-content:center; padding:18px">
      <div class="panel" style="max-width: 880px; width: 100%; max-height: 82vh; overflow:hidden">
        <div class="hd">
          <h2>知识卡</h2>
          <button id="cards-close">关闭</button>
        </div>
        <div class="bd" style="max-height: 72vh; overflow:auto">
          ${
            cards.length
              ? cards
                  .map(
                    (c) => `
                      <div class="card" style="margin-bottom:10px">
                        <div class="k">${escapeHtml(c.title)}</div>
                        <div class="v" style="margin-top:8px; line-height:1.7; color: rgba(255,255,255,0.86)">${formatBody(c.body)}</div>
                      </div>
                    `
                  )
                  .join("")
              : `<div class="inline-note">当前内容包没有知识卡。</div>`
          }
        </div>
      </div>
    </div>
  `;
}

function render() {
  const state = store.get();
  const html = `
    <canvas id="game-canvas" class="bg-canvas"></canvas>
    <div class="app-shell">
      ${renderTopbar()}
      <div class="layout">
        ${renderMetricsPanel()}
        ${renderRightPanel()}
      </div>
      <div class="footer">
        <div>快捷键: <span class="kbd">S</span> 保存 <span class="kbd">R</span> 重开 <span class="kbd">F</span> 全屏</div>
        <div class="pill">存档: ${storage.getItem(SAVE_KEY) ? "已存在" : "无"}</div>
      </div>
      <div id="toast" style="position:fixed; left:18px; bottom:16px; z-index:50; pointer-events:none"></div>
      <input id="file-input" type="file" accept="application/json" style="display:none" />
      ${renderCardsModal()}
    </div>
  `;
  appEl.innerHTML = html;

  ensureCanvasPaint();
  wireEvents();

  const scene = getScene();
  if (scene?.task) mountTask(scene);
}

function wireEvents() {
  const state = store.get();
  const scene = getScene();

  const saveBtn = document.getElementById("save-btn");
  if (saveBtn) saveBtn.onclick = () => doSave();

  const exportBtn = document.getElementById("export-btn");
  if (exportBtn) {
    exportBtn.onclick = () => {
      const payload = { appVersion: APP_VERSION, exportedAt: Date.now(), state: store.get() };
      downloadJson(payload, `ai-pm-sim-save-${new Date().toISOString().slice(0, 10)}.json`);
    };
  }

  const importBtn = document.getElementById("import-btn");
  if (importBtn) {
    importBtn.onclick = () => {
      document.getElementById("file-input")?.click();
    };
  }

  const fileInput = document.getElementById("file-input");
  if (fileInput) {
    fileInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = safeJsonParse(text);
        if (!parsed?.state) throw new Error("missing state");
        const { aiLab, roleplay, ...rest } = parsed.state ?? {};
        store.set({
          ...rest,
          mode: "playing",
          roleplay: roleplay ?? {
            loading: false,
            error: null,
            threads: {},
            health: store.get().roleplay?.health ?? { ok: false, checked: false, message: "" }
          }
        });
        flashToast("已导入存档");
        doSave();
      } catch {
        flashToast("导入失败: 文件格式不正确");
      } finally {
        fileInput.value = "";
      }
    };
  }

  const aboutBtn = document.getElementById("about-btn");
  if (aboutBtn) aboutBtn.onclick = () => goToScene("about");

  const cardsBtn = document.getElementById("cards-btn");
  if (cardsBtn) {
    cardsBtn.onclick = () => store.set({ ui: { ...(store.get().ui ?? {}), cardsOpen: true } });
  }
  const cardsClose = document.getElementById("cards-close");
  if (cardsClose) cardsClose.onclick = () => store.set({ ui: { ...(store.get().ui ?? {}), cardsOpen: false } });
  const cardsModal = document.getElementById("cards-modal");
  if (cardsModal) {
    cardsModal.onclick = (e) => {
      if (e.target?.id === "cards-modal") store.set({ ui: { ...(store.get().ui ?? {}), cardsOpen: false } });
    };
  }

  const backBtn = document.getElementById("back-btn");
  if (backBtn) backBtn.onclick = () => goToScene("start");

  const loadBtn = document.getElementById("load-btn");
  if (loadBtn) loadBtn.onclick = () => doLoad();

  const resetBtn = document.getElementById("reset-btn");
  if (resetBtn)
    resetBtn.onclick = () => {
      storage.removeItem(SAVE_KEY);
      resetGame({ keepContentMode: true });
      flashToast("已清空本地存档");
    };

  const startBtn = document.getElementById("start-btn");
  if (startBtn) startBtn.onclick = () => goToScene("c1_intro");

  const restartBtn = document.getElementById("restart-btn");
  if (restartBtn) restartBtn.onclick = () => resetGame({ keepContentMode: true });

  const backStartBtn = document.getElementById("back-start-btn");
  if (backStartBtn) backStartBtn.onclick = () => goToScene("start");

  const copyBtn = document.getElementById("copy-portfolio");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        const text = document.getElementById("portfolio-text")?.value ?? "";
        await navigator.clipboard.writeText(text);
        flashToast("已复制到剪贴板");
      } catch {
        flashToast("复制失败（浏览器可能限制剪贴板）");
      }
    };
  }

  const downloadJsonBtn = document.getElementById("download-json");
  if (downloadJsonBtn) {
    downloadJsonBtn.onclick = () => {
      const exportPayload = {
        appVersion: APP_VERSION,
        exportedAt: Date.now(),
        contentMode: store.get().contentMode,
        metrics: store.get().metrics,
        deliverables: store.get().deliverables,
        history: store.get().history
      };
      downloadJson(exportPayload, `ai-pm-sim-result-${new Date().toISOString().slice(0, 10)}.json`);
    };
  }

  if (scene?.options?.length) {
    for (const el of document.querySelectorAll("[data-choice]")) {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-choice");
        const opt = scene.options.find((o) => o.id === id);
        if (!opt) return;
        onChoose(scene, opt);
      });
    }
  }

  const roleplaySend = document.getElementById("roleplay-send");
  if (roleplaySend && scene?.roleplay) {
    roleplaySend.onclick = () => handleRoleplaySend(scene);
  }
  const roleplayClear = document.getElementById("roleplay-clear");
  if (roleplayClear && scene?.roleplay) {
    roleplayClear.onclick = () => {
      const roleplayId = scene.roleplay?.id ?? scene.id;
      setRoleplayThread(roleplayId, []);
      store.set({ roleplay: { ...(store.get().roleplay ?? {}), error: null } });
    };
  }
  for (const el of document.querySelectorAll("[data-roleplay-quick]")) {
    el.addEventListener("click", () => {
      const text = el.getAttribute("data-roleplay-quick") ?? "";
      if (!scene?.roleplay) return;
      handleRoleplaySend(scene, text);
    });
  }

  const contentModeSelect = document.getElementById("content-mode");
  if (contentModeSelect) {
    contentModeSelect.onchange = async () => {
      const next = contentModeSelect.value;
      if (next === state.contentMode) return;
      store.set({
        contentMode: next,
        mode: "boot",
        sceneId: "start",
        chapterIndex: 0,
        deliverables: {},
        history: [],
        metrics: defaultMetrics(),
        flags: {},
        roleplay: { loading: false, error: null, threads: {}, health: store.get().roleplay?.health ?? { ok: false, checked: false, message: "" } }
      });
      content = await loadContentBundle(next);
      store.set({ mode: "playing" });
      doSave();
      flashToast(`已切换到 ${next} 内容`);
    };
  }

  document.onkeydown = (e) => {
    if (store.get().ui?.cardsOpen && e.key === "Escape") store.set({ ui: { ...(store.get().ui ?? {}), cardsOpen: false } });
    if (e.key.toLowerCase() === "s" && (e.metaKey || e.ctrlKey)) return;
    if (e.key.toLowerCase() === "s") doSave();
    if (e.key.toLowerCase() === "r") resetGame({ keepContentMode: true });
    if (e.key.toLowerCase() === "f") toggleFullscreen();
    handleKeyboardAutomation(e);
  };
}

function handleKeyboardAutomation(e) {
  if (e.repeat) return;
  const target = e.target;
  const tag = target?.tagName?.toLowerCase?.() ?? "";
  const isEditable = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
  if (isEditable) return;

  const key = e.key.toLowerCase();
  const clickIf = (id) => {
    const el = document.getElementById(id);
    if (el && typeof el.click === "function" && !el.disabled) {
      el.click();
      return true;
    }
    return false;
  };

  if (key === "a") {
    if (clickIf("auto")) return;
    const firstChoice = document.querySelector("[data-choice]");
    if (firstChoice) firstChoice.click();
    return;
  }
  if (key === "b") {
    if (clickIf("submit")) return;
    const second = document.querySelectorAll("[data-choice]")[1];
    if (second) second.click();
    return;
  }
  if (key === "enter") {
    if (clickIf("start-btn")) return;
    if (clickIf("back-btn")) return;
    if (clickIf("restart-btn")) return;
    if (clickIf("submit")) return;
    const firstChoice = document.querySelector("[data-choice]");
    if (firstChoice) firstChoice.click();
  }
}

async function handleRoleplaySend(scene, presetText) {
  const input = document.getElementById("roleplay-input");
  const text = (presetText ?? input?.value ?? "").trim();
  if (!text) return;
  if (input) input.value = "";

  const roleplayId = scene.roleplay?.id ?? scene.id;
  appendRoleplayMessage(roleplayId, { role: "你", text });
  const health = store.get().roleplay?.health;
  if (health?.ok) {
    await requestRoleplay(scene, text);
  } else {
    const reply = localRoleplayReply(scene, text);
    appendRoleplayMessage(roleplayId, { role: "AI", text: reply });
  }
}

let canvasWired = false;
function ensureCanvasPaint() {
  const canvas = document.getElementById("game-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const resize = () => {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paintBackdrop(ctx, canvas.width, canvas.height, dpr);
  };

  if (!canvasWired) {
    canvasWired = true;
    window.addEventListener("resize", resize, { passive: true });
  }
  resize();
}

function paintBackdrop(ctx, w, h, dpr) {
  ctx.clearRect(0, 0, w, h);

  const grd = ctx.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, "rgba(124, 92, 255, 0.22)");
  grd.addColorStop(0.45, "rgba(45, 212, 191, 0.10)");
  grd.addColorStop(1, "rgba(251, 113, 133, 0.10)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  const step = Math.floor(60 * dpr);
  for (let x = 0; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

function mountTask(scene) {
  setTaskStatus(scene.id, store.get().flags?.taskStatus?.[scene.id] ?? "active");
  const taskRoot = document.getElementById("task-ui");
  if (!taskRoot) return;

  renderTask({
    taskRoot,
    scene,
    store,
    metrics: store.get().metrics,
    onComplete: (result) => completeTask(scene, result)
  });
}

function buildPortfolioSummary() {
  const state = store.get();
  const name = state.contentMode === "private" ? "（本地真名版）" : "（Public 虚构版）";
  const lines = [];
  lines.push(`项目: 宠物鉴别教育模拟${name}`);
  lines.push(`角色: AI 产品经理（模拟）`);
  lines.push("");
  lines.push("我在一次端到端项目周期内完成了:");
  lines.push("- 立项: 将业务目标拆解为北极星指标与过程指标，并明确约束与风险边界");
  lines.push("- 洞察: 输出竞品差异矩阵与可复用优化点，并在取舍中优先解决主矛盾");
  lines.push("- 设计: 结合相似检索/降噪/分类三条 AI 能力做方案组合与 bad case 兜底");
  lines.push("- 交付: 设计灰度与 A/B，建立反馈 triage 机制并推动迭代闭环");
  lines.push("");
  lines.push("关键取舍的结果（游戏指标）:");
  for (const [k, v] of Object.entries(state.metrics)) {
    lines.push(`- ${metricLabel(k)}: ${fmtMetric(v)}`);
  }
  lines.push("");
  lines.push("我的交付物摘要:");
  for (const d of Object.values(state.deliverables)) {
    const title = d?.title ?? d?.type ?? "Deliverable";
    const brief = d?.brief ?? "";
    lines.push(`- ${title}${brief ? `: ${brief}` : ""}`);
  }
  lines.push("");
  lines.push("复盘要点（可在面试展开）:");
  lines.push("- 我如何定义 success metric、避免口径冲突，并用实验验证因果");
  lines.push("- 我如何为低置信度与数据偏差设计兜底，保证可靠性与信任");
  lines.push("- 我如何在成本/风险约束下分阶段上线，兼顾体验与业务节奏");
  return lines.join("\n");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBody(text) {
  const safe = escapeHtml(text ?? "");
  return safe
    .split("\n\n")
    .map((p) => `<p style="margin: 0 0 10px">${p.replaceAll("\n", "<br/>")}</p>`)
    .join("")
    .trim();
}

let toastTimer = null;
function flashToast(text) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.innerHTML = `<div class="pill" style="display:inline-block; padding:10px 12px; background: rgba(0,0,0,0.35); border-color: rgba(255,255,255,0.14)">${escapeHtml(text)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (el) el.innerHTML = "";
  }, 1800);
}

async function boot() {
  initGlobalHooks();
  content = await loadContentBundle("public");
  const avail = await loadContentBundle("__probe_private__");
  store.set({ contentPrivateAvailable: Boolean(avail?.privateAvailable) });
  const raw = storage.getItem(SAVE_KEY);
  const parsed = raw ? safeJsonParse(raw) : null;
  if (parsed?.state?.contentMode) {
    const nextMode = parsed.state.contentMode;
    if (nextMode === "private" && !store.get().contentPrivateAvailable) {
      store.set({ contentMode: "public" });
    } else {
      store.set({ contentMode: nextMode });
      content = await loadContentBundle(nextMode);
    }
  }
  await checkAiHealth();
  store.set({ mode: "playing" });
  store.subscribe(scheduleRender);
  scheduleRender();
}

boot().catch((e) => {
  console.error(e);
  appEl.innerHTML = `<div style="padding:18px; color:white">启动失败：请检查控制台错误</div>`;
});

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  queueMicrotask(() => {
    renderScheduled = false;
    render();
  });
}

async function checkAiHealth() {
  try {
    const res = await fetch("/api/health");
    const text = await res.text();
    const json = safeJsonParse(text);
    const ok = Boolean(res.ok && json?.ok);
    store.set({
      roleplay: {
        ...(store.get().roleplay ?? {}),
        health: { ok, checked: true, message: json?.message ?? "" }
      }
    });
  } catch {
    store.set({
      roleplay: {
        ...(store.get().roleplay ?? {}),
        health: { ok: false, checked: true, message: "AI 服务不可用" }
      }
    });
  }
}

async function requestRoleplay(scene, userText) {
  const state = store.get();
  store.set({ roleplay: { ...(state.roleplay ?? {}), loading: true, error: null } });
  const roleplayId = scene.roleplay?.id ?? scene.id;
  try {
    const payload = {
      ...buildAiPayload(),
      roleplay: scene.roleplay ?? {},
      thread: getRoleplayThreadForModel(scene, roleplayId).slice(-6),
      userText
    };
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "roleplay_step", payload })
    });
    const text = await res.text();
    const json = safeJsonParse(text);
    if (!res.ok) {
      const msg = json?.error || text || "AI 服务不可用";
      throw new Error(msg);
    }
    const result = json?.result?.json ?? json?.result ?? json;
    const reply = result?.reply || result?.text || "";
    const nextActions = Array.isArray(result?.next_actions) ? result.next_actions : [];
    const risks = Array.isArray(result?.risks) ? result.risks : [];
    let replyText = reply || localRoleplayReply(scene, userText);
    if (nextActions.length) replyText += `\n\n下一步建议：${nextActions.join("；")}`;
    if (risks.length) replyText += `\n\n注意风险：${risks.join("；")}`;
    appendRoleplayMessage(roleplayId, { role: "AI", text: replyText });
    store.set({ roleplay: { ...(store.get().roleplay ?? {}), loading: false, error: null } });
  } catch (err) {
    const fallback = localRoleplayReply(scene, userText);
    appendRoleplayMessage(roleplayId, { role: "AI", text: fallback });
    store.set({ roleplay: { ...(store.get().roleplay ?? {}), loading: false, error: String(err?.message || err) } });
  }
}

function buildAiPayload() {
  const state = store.get();
  const scene = getScene();
  return {
    contentMode: state.contentMode,
    sceneId: scene?.id ?? "",
    sceneTitle: scene?.title ?? "",
    chapterIndex: state.chapterIndex,
    metrics: state.metrics,
    deliverables: state.deliverables,
    history: state.history
  };
}
