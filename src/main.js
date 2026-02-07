import "./styles.css";
import { createStore, defaultMetrics } from "./state/store.js";
import { loadContentBundle } from "./state/content.js";
import { storage } from "./state/storage.js";
import { clamp01, downloadJson, safeJsonParse } from "./util.js";
import { renderTask } from "./tasks/index.js";

const APP_VERSION = "0.1.0";
const SAVE_KEY = "ai_pm_sim_save_v1";
const MILESTONE_CUE_VISIBLE_MS = 5200;
const XP_PER_CHOICE = 10;
const XP_PER_TASK = 35;
const XP_PER_EVENT = 12;
const XP_PER_SKIPPED_TASK = 16;
const LEVEL_PULSE_VISIBLE_MS = 3800;
const SKIP_CARD_NAME = "直通终面卡";
const DUEL_HINT_NAME = "面试锦囊";
const LEVEL_TIERS = [
  { minXp: 0, title: "简历优化中" },
  { minXp: 55, title: "一面通话中" },
  { minXp: 130, title: "二面深挖中" },
  { minXp: 230, title: "三面压力测" },
  { minXp: 350, title: "交叉面拉齐" },
  { minXp: 500, title: "HR 面对齐" },
  { minXp: 680, title: "背调待通过" },
  { minXp: 890, title: "审批流转中" },
  { minXp: 1130, title: "OC 已到账" }
];

const ACHIEVEMENT_META = {
  first_choice: { title: "第一决策", desc: "你完成了第一条关键决策。" },
  first_task: { title: "第一交付", desc: "你提交了第一份 PM 交付物。" },
  chapter_1: { title: "立项完成", desc: "你完成了 Chapter 1 的关键训练。" },
  chapter_2: { title: "洞察完成", desc: "你完成了 Chapter 2 的关键训练。" },
  chapter_3: { title: "设计完成", desc: "你完成了 Chapter 3 的关键训练。" },
  chapter_4: { title: "交付完成", desc: "你完成了 Chapter 4 的关键训练。" },
  ab_analyst: { title: "实验分析师", desc: "你完成了 A/B 结果解读任务。" },
  all_tasks_done: { title: "全流程通关", desc: "你完成了全局任务闭环。" }
};

const SKIPPABLE_TASK_TYPES = new Set(["bottleneck_hypothesis", "experience_flow", "ab_quality"]);
const DECISION_WEIGHTS = { efficiency: 1, accuracy: 1.1, ux: 0.9, cost: -1, risk: -1.2 };
const ACHIEVEMENT_REWARDS = {
  first_task: { skipTaskCharges: 1, label: `奖励解锁：${SKIP_CARD_NAME} x1（可跳过 1 次低优先任务）` },
  chapter_2: { insightLens: true, label: "奖励解锁：洞察透镜（显示隐藏线索）" },
  ab_analyst: { duelHintCharges: 2, label: `奖励解锁：${DUEL_HINT_NAME} x2（对打模式可用）` }
};

const CHAPTER_RANDOM_EVENTS = {
  1: [
    {
      id: "c1_budget_cut",
      title: "突发：预算被临时砍 20%",
      body: "老板要求不加人不加时长。你必须在“可交付”与“可验证”之间重新取舍。",
      options: [
        {
          id: "keep_scope",
          label: "保留原范围，压缩测试与回归",
          note: "短期推进更快，但灰度风险明显上升。",
          delta: { efficiency: 0.08, risk: 0.1, cost: -0.04 }
        },
        {
          id: "narrow_scope",
          label: "收缩范围，保留实验与回滚能力",
          note: "节奏稍慢，但可验证、可兜底。",
          delta: { efficiency: -0.03, risk: -0.08, accuracy: 0.04 }
        }
      ]
    },
    {
      id: "c1_deadline_pullin",
      title: "突发：灰度窗口提前 3 天",
      body: "你需要在时间压力下重排里程碑。",
      options: [
        {
          id: "rush_all",
          label: "全功能硬上，后续再补质量",
          note: "看起来交付完整，但返工成本高。",
          delta: { efficiency: 0.1, risk: 0.09, cost: 0.06 }
        },
        {
          id: "core_first",
          label: "仅保留核心链路，其他放二期",
          note: "先保闭环，减少不可控风险。",
          delta: { efficiency: 0.04, risk: -0.06, ux: 0.03 }
        }
      ]
    }
  ],
  2: [
    {
      id: "c2_competitor_launch",
      title: "突发：竞品今天发布同类功能",
      body: "运营要求你立刻复制竞品页面，减少流失。",
      options: [
        {
          id: "copy_fast",
          label: "快速照搬竞品方案",
          note: "节省讨论时间，但可能偏离自身场景。",
          delta: { efficiency: 0.06, ux: 0.03, risk: 0.06 }
        },
        {
          id: "hypothesis_first",
          label: "先验证瓶颈，再选关键点借鉴",
          note: "多花一点时间，但更稳。",
          delta: { efficiency: -0.02, accuracy: 0.05, risk: -0.06 }
        }
      ]
    },
    {
      id: "c2_data_gap",
      title: "突发：关键漏斗埋点缺失",
      body: "你无法确认流失到底发生在上传前还是等待中。",
      options: [
        {
          id: "guess_and_move",
          label: "先凭经验改交互，埋点后补",
          note: "动作快，但可能误判主问题。",
          delta: { efficiency: 0.05, risk: 0.08, accuracy: -0.04 }
        },
        {
          id: "patch_tracking",
          label: "先补 2 个关键埋点再推进方案",
          note: "节奏更慢，但能避免方向错误。",
          delta: { efficiency: -0.03, risk: -0.07, accuracy: 0.06 }
        }
      ]
    }
  ],
  3: [
    {
      id: "c3_gpu_pressure",
      title: "突发：算力配额吃紧",
      body: "算法建议先上重模型，但后端担心线上延迟与成本。",
      options: [
        {
          id: "heavy_model",
          label: "坚持上重模型，追求准确率",
          note: "准确率可能提升，但延迟和成本压力加大。",
          delta: { accuracy: 0.08, cost: 0.12, efficiency: -0.06, risk: 0.04 }
        },
        {
          id: "hybrid_strategy",
          label: "先上轻量方案 + 低置信度复核",
          note: "先保体验与稳定，再逐步增强。",
          delta: { accuracy: 0.04, risk: -0.06, ux: 0.06, cost: 0.03 }
        }
      ]
    },
    {
      id: "c3_trust_public",
      title: "突发：社区出现“AI 乱判”吐槽",
      body: "你需要决定先优化模型，还是先补解释与申诉机制。",
      options: [
        {
          id: "model_only",
          label: "只做模型修复，不改前台表达",
          note: "技术路径直接，但用户感知改善慢。",
          delta: { accuracy: 0.08, ux: -0.03, risk: 0.04 }
        },
        {
          id: "trust_bundle",
          label: "模型修复 + 解释文案 + 申诉入口",
          note: "工作量更大，但信任恢复更快。",
          delta: { accuracy: 0.04, ux: 0.08, risk: -0.07, cost: 0.05 }
        }
      ]
    }
  ],
  4: [
    {
      id: "c4_srm_alert",
      title: "突发：SRM 报警（样本比例异常）",
      body: "运营催你继续放量，数据同学建议先停。",
      options: [
        {
          id: "ignore_srm",
          label: "忽略 SRM，按原计划放量",
          note: "短期结果更快，但结论可信度下降。",
          delta: { efficiency: 0.07, risk: 0.12, accuracy: -0.05 }
        },
        {
          id: "pause_fix",
          label: "暂停放量，先排查分流与埋点",
          note: "延迟决策，但避免错误结论。",
          delta: { efficiency: -0.04, risk: -0.09, accuracy: 0.07 }
        }
      ]
    },
    {
      id: "c4_exec_push",
      title: "突发：老板要求今晚全量",
      body: "主指标涨了，但护栏有轻微恶化。",
      options: [
        {
          id: "full_release",
          label: "直接全量，先抢窗口期",
          note: "业务短期受益，但风险不可逆。",
          delta: { efficiency: 0.09, risk: 0.11, ux: -0.03 }
        },
        {
          id: "segment_release",
          label: "分人群放量 + 设回滚阈值",
          note: "稳健推进，便于控制外溢风险。",
          delta: { efficiency: 0.02, risk: -0.08, ux: 0.05 }
        }
      ]
    }
  ]
};

const HIDDEN_INSIGHTS_BY_CHAPTER = {
  2: "洞察透镜：过去 7 天里，超过半数流失发生在“等待超过 4 分钟”阶段。",
  3: "洞察透镜：低置信度样本若直接出结论，会显著拉低信任与复购意愿。",
  4: "洞察透镜：A/A 不通过时继续放量，常见后果是错误归因与返工成本飙升。"
};

const LOCAL_DUEL_QUESTIONS = [
  {
    question: "你做的 A/B 主指标涨了 6%，但护栏指标恶化，你会怎么决策？",
    focus: "取舍与风险控制",
    rubric: ["先判断显著性与业务影响", "给出分阶段放量/回滚策略", "明确后续验证动作"],
    keywords: ["护栏", "回滚", "分阶段", "显著", "验证"]
  },
  {
    question: "如果业务要求两周上线，你如何拆 MVP 范围并保证可信验证？",
    focus: "范围管理与实验思维",
    rubric: ["定义最小闭环", "给出北极星+护栏", "说明灰度与停线条件"],
    keywords: ["MVP", "闭环", "灰度", "护栏", "停线"]
  },
  {
    question: "面对跨部门分歧，你会如何推动技术、运营、设计达成一致？",
    focus: "协作推进",
    rubric: ["先统一目标口径", "再拆职责与里程碑", "最后明确风险 owner"],
    keywords: ["目标", "口径", "里程碑", "风险", "owner"]
  },
  {
    question: "线上出现大量误判投诉，你会先做哪三件事？",
    focus: "故障应对与闭环",
    rubric: ["先止损", "再定位原因", "最后复盘机制化"],
    keywords: ["止损", "定位", "复盘", "申诉", "回滚"]
  },
  {
    question: "请你解释一次“效率、准确率、体验、成本、风险”的平衡案例。",
    focus: "结构化表达",
    rubric: ["有背景与约束", "有取舍逻辑", "有数据验证与反思"],
    keywords: ["约束", "取舍", "验证", "风险", "反思"]
  }
];

function defaultPowerups() {
  return { skipTaskCharges: 0, insightLens: false, duelHintCharges: 0 };
}

function defaultReplayState() {
  return { active: false, sceneIds: [], index: 0 };
}

function defaultDuelState() {
  return {
    active: false,
    loading: false,
    error: null,
    round: 0,
    maxRounds: 5,
    totalScore: 0,
    currentQuestion: null,
    currentFeedback: null,
    hintText: "",
    history: [],
    summary: ""
  };
}

function normalizePowerups(raw) {
  return {
    skipTaskCharges: Math.max(0, Number(raw?.skipTaskCharges ?? 0)),
    insightLens: Boolean(raw?.insightLens),
    duelHintCharges: Math.max(0, Number(raw?.duelHintCharges ?? 0))
  };
}

function normalizeReplay(raw) {
  return {
    active: Boolean(raw?.active),
    sceneIds: Array.isArray(raw?.sceneIds) ? raw.sceneIds.filter((s) => typeof s === "string") : [],
    index: Math.max(0, Number(raw?.index ?? 0))
  };
}

function normalizeDuel(raw) {
  return {
    ...defaultDuelState(),
    ...(raw ?? {}),
    loading: false,
    error: null,
    history: Array.isArray(raw?.history) ? raw.history : [],
    round: Math.max(0, Number(raw?.round ?? 0)),
    maxRounds: Math.max(1, Number(raw?.maxRounds ?? 5)),
    totalScore: Math.max(0, Number(raw?.totalScore ?? 0))
  };
}

const appEl = document.getElementById("app");
const store = createStore({
  appVersion: APP_VERSION,
  metrics: defaultMetrics(),
  mode: "boot",
  locale: "zh-CN",
  contentMode: "public",
  sceneId: "start",
  chapterIndex: 0,
  xp: 0,
  achievements: [],
  navStack: [],
  powerups: defaultPowerups(),
  mistakes: [],
  replay: defaultReplayState(),
  duel: defaultDuelState(),
  deliverables: {},
  history: [],
  flags: { guideDismissed: false, taskStatus: {}, chapterEvents: {} },
  ui: { cardsOpen: false, mistakesOpen: false, actionFeedback: null, metricPulse: null, levelPulse: null, milestoneCue: null },
  roleplay: { loading: false, error: null, threads: {}, healthChecking: false, health: { ok: false, checked: false, message: "" } },
  clockMs: 0
});

let content = null;
let renderScheduled = false;
let healthPollTimer = null;
let milestoneCueTimer = null;

function initGlobalHooks() {
  window.render_game_to_text = () => {
    const state = store.get();
    const scene = content?.scenes?.find((s) => s.id === state.sceneId) ?? null;
    const level = getLevelFromXp(state.xp ?? 0);
    const levelProgress = getLevelProgress(state.xp ?? 0);
    const chapterEventState = typeof scene?.chapter === "number" ? getChapterEventState(scene.chapter) : null;
    const payload = {
      coordinate_system: "UI-based; not a spatial game. origin: N/A, axis: N/A.",
      mode: state.mode,
      sceneId: state.sceneId,
      sceneTitle: scene?.title ?? "",
      chapterIndex: state.chapterIndex,
      contentMode: state.contentMode,
      metrics: state.metrics,
      xp: state.xp,
      level: {
        value: level.level,
        title: level.title,
        progressPct: levelProgress.pct,
        xpToNext: levelProgress.remaining
      },
      powerups: normalizePowerups(state.powerups),
      mistakeCount: Array.isArray(state.mistakes) ? state.mistakes.length : 0,
      replay: normalizeReplay(state.replay),
      duel: {
        active: Boolean(state.duel?.active),
        round: Number(state.duel?.round ?? 0),
        maxRounds: Number(state.duel?.maxRounds ?? 5),
        totalScore: Number(state.duel?.totalScore ?? 0)
      },
      chapterEventPending: Boolean(chapterEventState?.eventId && !chapterEventState?.resolved),
      achievements: (state.achievements ?? []).map((a) => a.id),
      canGoBack: (state.navStack?.length ?? 0) > 0,
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

function isPositiveMetricDelta(metricKey, delta) {
  if (typeof delta !== "number" || Math.abs(delta) <= 0.0001) return false;
  const direction = metricKey === "cost" || metricKey === "risk" ? -1 : 1;
  return delta * direction > 0;
}

function getFeedbackOutcome(delta) {
  const entries = Object.entries(delta ?? {}).filter(([, value]) => typeof value === "number" && Math.abs(value) > 0.0001);
  if (!entries.length) {
    return {
      tone: "neutral",
      summary: "本次操作影响较小，建议结合后续数据再判断。",
      suggestion: "下一步建议：继续推进当前章节任务，优先补充可验证数据。",
      chips: []
    };
  }
  const positives = [];
  const negatives = [];
  for (const [key, value] of entries) {
    const row = { key, value, abs: Math.abs(value), positive: isPositiveMetricDelta(key, value) };
    if (row.positive) positives.push(row);
    else negatives.push(row);
  }
  positives.sort((a, b) => b.abs - a.abs);
  negatives.sort((a, b) => b.abs - a.abs);
  let tone = "neutral";
  if (positives.length > negatives.length) tone = "good";
  if (negatives.length > positives.length) tone = "bad";
  const best = positives[0];
  const risk = negatives[0];
  const summary =
    tone === "good"
      ? `整体正向：${best ? `${metricLabel(best.key)}改善` : "收益侧提升"}。`
      : tone === "bad"
        ? `需要警惕：${risk ? `${metricLabel(risk.key)}恶化` : "关键指标承压"}。`
        : "整体中性：收益与风险并存。";
  const suggestion =
    tone === "good"
      ? "下一步建议：保持当前策略，并在下一节点复核护栏指标。"
      : tone === "bad"
        ? "下一步建议：优先降风险或补兜底，再继续放量。"
        : "下一步建议：补充验证数据，再决定是否扩大策略。";
  const chips = entries
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 4)
    .map(([key, value]) => ({
      key,
      text: `${metricLabel(key)} ${fmtMetric(value)}`,
      positive: isPositiveMetricDelta(key, value)
    }));
  return { tone, summary, suggestion, chips };
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
  const next = parsed.state;
  const loadedScene = content?.scenes?.find((s) => s.id === next.sceneId) ?? null;
  const nextChapterIndex = typeof loadedScene?.chapter === "number" ? Math.max(0, loadedScene.chapter - 1) : next.chapterIndex ?? 0;
  store.set({
    ...next,
    contentMode: "public",
    chapterIndex: nextChapterIndex,
    mode: "playing",
    powerups: normalizePowerups(next?.powerups),
    mistakes: Array.isArray(next?.mistakes) ? next.mistakes : [],
    replay: normalizeReplay(next?.replay),
    duel: normalizeDuel(next?.duel),
    flags: {
      ...(next?.flags ?? {}),
      guideDismissed: Boolean(next?.flags?.guideDismissed),
      taskStatus: { ...(next?.flags?.taskStatus ?? {}) },
      chapterEvents: { ...(next?.flags?.chapterEvents ?? {}) }
    },
    ui: {
      cardsOpen: Boolean(next?.ui?.cardsOpen),
      mistakesOpen: false,
      actionFeedback: null,
      metricPulse: null,
      levelPulse: null,
      milestoneCue: null
    },
    roleplay: {
      ...(next?.roleplay ?? {}),
      loading: false,
      error: null,
      healthChecking: false
    }
  });
  if (typeof loadedScene?.chapter === "number") ensureChapterEvent(loadedScene.chapter);
  flashToast("已读取存档");
}

function resetGame({ keepContentMode }) {
  const prev = store.get();
  store.set({
    appVersion: APP_VERSION,
    metrics: defaultMetrics(),
    mode: "playing",
    locale: "zh-CN",
    contentMode: "public",
    sceneId: "start",
    chapterIndex: 0,
    xp: 0,
    achievements: [],
    navStack: [],
    powerups: defaultPowerups(),
    mistakes: [],
    replay: defaultReplayState(),
    duel: defaultDuelState(),
    deliverables: {},
    history: [],
    flags: { guideDismissed: false, taskStatus: {}, chapterEvents: {} },
    ui: { cardsOpen: false, mistakesOpen: false, actionFeedback: null, metricPulse: null, levelPulse: null, milestoneCue: null },
    roleplay: { loading: false, error: null, threads: {}, healthChecking: false, health: prev.roleplay?.health ?? { ok: false, checked: false, message: "" } },
    clockMs: 0
  });
}

function applyDelta(delta) {
  if (!delta) return;
  const state = store.get();
  const nextMetrics = { ...state.metrics };
  const metricDelta = {};
  for (const [k, v] of Object.entries(delta)) {
    if (typeof nextMetrics[k] === "number") {
      nextMetrics[k] = Number(nextMetrics[k] + v);
      metricDelta[k] = Number(v);
    }
  }
  store.set({
    metrics: nextMetrics,
    ui: {
      ...(state.ui ?? {}),
      metricPulse: {
        at: Date.now(),
        delta: metricDelta
      }
    }
  });
}

function setActionFeedback({ title, note, delta }) {
  const state = store.get();
  store.set({
    ui: {
      ...(state.ui ?? {}),
      actionFeedback: {
        at: Date.now(),
        title,
        note,
        delta: delta ?? {}
      }
    }
  });
}

function setMilestoneCue({ title, subtitle, badges = [] }) {
  const state = store.get();
  const safeBadges = Array.isArray(badges) ? badges.filter(Boolean).slice(0, 4) : [];
  store.set({
    ui: {
      ...(state.ui ?? {}),
      milestoneCue: {
        at: Date.now(),
        title,
        subtitle: subtitle ?? "",
        badges: safeBadges
      }
    }
  });
  clearTimeout(milestoneCueTimer);
  milestoneCueTimer = setTimeout(() => {
    const nowState = store.get();
    store.set({
      ui: {
        ...(nowState.ui ?? {}),
        milestoneCue: null
      }
    });
  }, MILESTONE_CUE_VISIBLE_MS);
}

function triggerMilestoneCue({ levelInfo, achievements, rewards }) {
  const hasLevel = Boolean(levelInfo?.title);
  const safeAchievements = Array.isArray(achievements) ? achievements.filter(Boolean) : [];
  const safeRewards = Array.isArray(rewards) ? rewards.filter(Boolean) : [];
  if (!hasLevel && !safeAchievements.length) return;
  const title = hasLevel
    ? `升级达成：Lv.${levelInfo.level} ${levelInfo.title}`
    : `成就达成：${safeAchievements.map((it) => it.title).join("、")}`;
  const subtitleParts = [];
  if (safeAchievements.length) subtitleParts.push(`解锁成就：${safeAchievements.map((it) => `「${it.title}」`).join("、")}`);
  if (safeRewards.length) subtitleParts.push(safeRewards.join("；"));
  setMilestoneCue({
    title,
    subtitle: subtitleParts.join(" ｜ "),
    badges: [
      hasLevel ? `Lv.${levelInfo.level}` : "",
      ...safeAchievements.slice(0, 3).map((it) => it.title)
    ]
  });
}

function getLevelFromXp(xp) {
  const safeXp = Math.max(0, Number(xp ?? 0));
  let index = 0;
  for (let i = 0; i < LEVEL_TIERS.length; i += 1) {
    if (safeXp >= LEVEL_TIERS[i].minXp) index = i;
  }
  const tier = LEVEL_TIERS[index] ?? LEVEL_TIERS[0];
  return { ...tier, index, level: index + 1 };
}

function getLevelProgress(xp) {
  const safeXp = Math.max(0, Number(xp ?? 0));
  const current = getLevelFromXp(safeXp);
  const nextTier = LEVEL_TIERS[current.index + 1] ?? null;
  if (!nextTier) {
    return { current, next: null, pct: 100, remaining: 0 };
  }
  const span = Math.max(1, nextTier.minXp - current.minXp);
  const gained = Math.max(0, safeXp - current.minXp);
  return {
    current,
    next: { ...nextTier, index: current.index + 1, level: current.level + 1 },
    pct: Math.min(100, Math.round((gained / span) * 100)),
    remaining: Math.max(0, nextTier.minXp - safeXp)
  };
}

function grantXp(amount) {
  const state = store.get();
  const prevXp = Math.max(0, Number(state.xp ?? 0));
  const gained = Math.max(0, Number(amount || 0));
  const nextXp = prevXp + gained;
  const prevLevel = getLevelFromXp(prevXp);
  const nextLevel = getLevelFromXp(nextXp);
  const leveledUp = nextLevel.level > prevLevel.level;
  store.set({
    xp: nextXp,
    ui: {
      ...(state.ui ?? {}),
      levelPulse: leveledUp ? { at: Date.now(), from: prevLevel.level, to: nextLevel.level } : state.ui?.levelPulse ?? null
    }
  });
  return { prevXp, nextXp, gained, prevLevel, nextLevel, leveledUp };
}

function unlockAchievement(id) {
  const meta = ACHIEVEMENT_META[id];
  if (!meta) return null;
  const state = store.get();
  const list = Array.isArray(state.achievements) ? state.achievements.slice() : [];
  if (list.some((a) => a.id === id)) return null;
  const unlocked = { id, title: meta.title, desc: meta.desc, at: Date.now() };
  list.push(unlocked);
  store.set({ achievements: list });
  return unlocked;
}

function decisionScore(delta) {
  const safe = delta ?? {};
  let score = 0;
  for (const [key, weight] of Object.entries(DECISION_WEIGHTS)) {
    score += Number(safe[key] ?? 0) * weight;
  }
  return score;
}

function summarizeDeltaFocus(delta) {
  const entries = Object.entries(delta ?? {}).filter(([, value]) => typeof value === "number" && Math.abs(value) > 0.0001);
  if (!entries.length) return "未形成可观测指标变化";
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const [key, value] = entries[0];
  if (value >= 0) return `${metricLabel(key)}提升明显`;
  return `${metricLabel(key)}下滑明显`;
}

function isWrongDecision(delta) {
  return decisionScore(delta) < -0.01;
}

function pushMistake(entry) {
  const state = store.get();
  const list = Array.isArray(state.mistakes) ? state.mistakes.slice() : [];
  const key = `${entry.kind}:${entry.sceneId}:${entry.refId ?? ""}`;
  const idx = list.findIndex((it) => it.key === key);
  if (idx >= 0) {
    list[idx] = { ...list[idx], count: Number(list[idx].count ?? 1) + 1, lastAt: Date.now(), reason: entry.reason };
  } else {
    list.unshift({ key, count: 1, lastAt: Date.now(), ...entry });
  }
  if (list.length > 60) list.length = 60;
  store.set({ mistakes: list });
}

function maybeRecordWrongChoice(scene, option) {
  if (!isWrongDecision(option?.delta)) return false;
  pushMistake({
    kind: "choice",
    sceneId: scene?.id ?? "",
    refId: option?.id ?? "",
    title: option?.label ?? "剧情决策",
    reason: `${summarizeDeltaFocus(option?.delta)}；建议优先压低风险/成本再追求提效。`
  });
  return true;
}

function maybeRecordWrongTask(scene, result) {
  if (!isWrongDecision(result?.delta)) return false;
  pushMistake({
    kind: "task",
    sceneId: scene?.id ?? "",
    refId: scene?.task?.type ?? "",
    title: result?.deliverable?.title ?? scene?.title ?? "任务交付",
    reason: `${summarizeDeltaFocus(result?.delta)}；下次先检查主指标与护栏是否同时满足。`
  });
  return true;
}

function maybeRecordWrongEvent(sceneId, eventTitle, eventOption) {
  if (!isWrongDecision(eventOption?.delta)) return false;
  pushMistake({
    kind: "event",
    sceneId,
    refId: eventOption?.id ?? "",
    title: `${eventTitle} - ${eventOption?.label ?? "事件决策"}`,
    reason: `${summarizeDeltaFocus(eventOption?.delta)}；突发情境优先保验证与回滚能力。`
  });
  return true;
}

function getMistakeReplayScenes() {
  const mistakes = Array.isArray(store.get().mistakes) ? store.get().mistakes : [];
  const validSceneIds = new Set((content?.scenes ?? []).map((s) => s.id));
  const ids = [];
  const seen = new Set();
  for (const item of mistakes) {
    if (!item?.sceneId || seen.has(item.sceneId) || !validSceneIds.has(item.sceneId)) continue;
    seen.add(item.sceneId);
    ids.push(item.sceneId);
  }
  return ids;
}

function startMistakeReplay() {
  const sceneIds = getMistakeReplayScenes();
  if (!sceneIds.length) {
    flashToast("错题本为空，继续保持");
    return;
  }
  store.set({ replay: { active: true, sceneIds, index: 0 } });
  goToScene(sceneIds[0]);
  flashToast(`已进入错题重打：1/${sceneIds.length}`);
}

function goNextReplayScene() {
  const replay = normalizeReplay(store.get().replay);
  if (!replay.active || !replay.sceneIds.length) {
    flashToast("当前不在错题重打模式");
    return;
  }
  const nextIndex = replay.index + 1;
  if (nextIndex >= replay.sceneIds.length) {
    store.set({ replay: defaultReplayState() });
    flashToast("错题重打已完成");
    return;
  }
  const nextSceneId = replay.sceneIds[nextIndex];
  store.set({ replay: { ...replay, index: nextIndex } });
  goToScene(nextSceneId);
  flashToast(`已切换到下一题：${nextIndex + 1}/${replay.sceneIds.length}`);
}

function getChapterEventState(chapter) {
  return store.get().flags?.chapterEvents?.[chapter] ?? null;
}

function getChapterEventById(chapter, eventId) {
  return (CHAPTER_RANDOM_EVENTS[chapter] ?? []).find((it) => it.id === eventId) ?? null;
}

function ensureChapterEvent(chapter) {
  if (typeof chapter !== "number") return;
  const candidates = CHAPTER_RANDOM_EVENTS[chapter] ?? [];
  if (!candidates.length) return;
  const state = store.get();
  const chapterEvents = { ...(state.flags?.chapterEvents ?? {}) };
  if (chapterEvents[chapter]?.eventId) return;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  chapterEvents[chapter] = { eventId: pick.id, resolved: false, chosenId: null };
  store.set({ flags: { ...(state.flags ?? {}), chapterEvents } });
}

function renderChapterEvent(scene) {
  if (typeof scene?.chapter !== "number") return "";
  const chapterEventState = getChapterEventState(scene.chapter);
  if (!chapterEventState?.eventId || chapterEventState?.resolved) return "";
  const event = getChapterEventById(scene.chapter, chapterEventState.eventId);
  if (!event) return "";
  return `
    <div class="event-panel">
      <div class="event-title">突发事件：${escapeHtml(event.title)}</div>
      <div class="event-body">${formatBody(event.body ?? "")}</div>
      <div class="event-choices">
        ${(event.options ?? [])
          .map(
            (option) => `
              <button class="choice" data-event-choice="${option.id}" data-event-id="${event.id}" data-event-chapter="${scene.chapter}">
                <div class="t">${escapeHtml(option.label)}</div>
                <div class="s">${escapeHtml(option.note ?? "")}</div>
              </button>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function applyAchievementRewards(unlockedList) {
  const rewards = [];
  if (!Array.isArray(unlockedList) || !unlockedList.length) return rewards;
  const state = store.get();
  const powerups = normalizePowerups(state.powerups);
  let changed = false;
  for (const achievement of unlockedList) {
    const reward = ACHIEVEMENT_REWARDS[achievement?.id];
    if (!reward) continue;
    if (typeof reward.skipTaskCharges === "number") {
      powerups.skipTaskCharges += reward.skipTaskCharges;
      changed = true;
    }
    if (typeof reward.duelHintCharges === "number") {
      powerups.duelHintCharges += reward.duelHintCharges;
      changed = true;
    }
    if (reward.insightLens && !powerups.insightLens) {
      powerups.insightLens = true;
      changed = true;
    }
    rewards.push(reward.label);
  }
  if (changed) store.set({ powerups });
  return rewards;
}

function canSkipCurrentTask(scene) {
  if (!scene?.task) return false;
  const powerups = normalizePowerups(store.get().powerups);
  const taskStatus = store.get().flags?.taskStatus?.[scene.id] ?? "idle";
  return powerups.skipTaskCharges > 0 && taskStatus !== "completed" && SKIPPABLE_TASK_TYPES.has(scene.task.type);
}

function consumeSkipTaskCharge() {
  const state = store.get();
  const powerups = normalizePowerups(state.powerups);
  if (powerups.skipTaskCharges <= 0) return false;
  powerups.skipTaskCharges -= 1;
  store.set({ powerups });
  return true;
}

function buildSkippedTaskResult(scene) {
  return {
    deliverable: {
      type: scene?.task?.type ?? "task",
      title: `${scene?.title ?? "任务"}（${SKIP_CARD_NAME}提交）`,
      brief: `使用${SKIP_CARD_NAME}提交了保守版本，建议后续补齐完整论证。`,
      data: { skippedByPowerup: true }
    },
    delta: { efficiency: 0.03, accuracy: 0.02, risk: 0.01, cost: -0.01, ux: 0 },
    xpAward: XP_PER_SKIPPED_TASK,
    feedbackTag: SKIP_CARD_NAME
  };
}

function getTaskSceneIds() {
  return (content?.scenes ?? []).filter((s) => s.task).map((s) => s.id);
}

function getTaskProgressFromState(state) {
  const ids = getTaskSceneIds();
  const taskStatus = state.flags?.taskStatus ?? {};
  const completed = ids.filter((id) => taskStatus[id] === "completed").length;
  return { total: ids.length, completed };
}

function getChapterTaskProgress(state, chapter) {
  const chapterIds = (content?.scenes ?? []).filter((s) => s.task && s.chapter === chapter).map((s) => s.id);
  const taskStatus = state.flags?.taskStatus ?? {};
  const completed = chapterIds.filter((id) => taskStatus[id] === "completed").length;
  return { total: chapterIds.length, completed };
}

function unlockChapterAchievementIfComplete(chapter) {
  if (typeof chapter !== "number") return null;
  const progress = getChapterTaskProgress(store.get(), chapter);
  if (progress.total > 0 && progress.completed >= progress.total) {
    return unlockAchievement(`chapter_${chapter}`);
  }
  return null;
}

function snapshotStateForBack(state) {
  const { navStack, ...rest } = state;
  const snapshot = {
    ...rest,
    ui: {
      cardsOpen: false,
      mistakesOpen: false,
      actionFeedback: null,
      metricPulse: null,
      levelPulse: null,
      milestoneCue: null
    },
    roleplay: {
      ...(state.roleplay ?? {}),
      loading: false,
      error: null,
      healthChecking: false
    },
    duel: {
      ...(state.duel ?? defaultDuelState()),
      loading: false,
      error: null
    }
  };
  return JSON.parse(JSON.stringify(snapshot));
}

function pushNavSnapshot() {
  const state = store.get();
  const stack = Array.isArray(state.navStack) ? state.navStack.slice() : [];
  stack.push(snapshotStateForBack(state));
  if (stack.length > 50) stack.shift();
  store.set({ navStack: stack });
}

function canGoBack() {
  return (store.get().navStack?.length ?? 0) > 0;
}

function persistStateSilently() {
  const state = store.get();
  const payload = JSON.stringify({
    savedAt: Date.now(),
    appVersion: APP_VERSION,
    state
  });
  storage.setItem(SAVE_KEY, payload);
}

function goBackOneStep() {
  const state = store.get();
  const stack = Array.isArray(state.navStack) ? state.navStack.slice() : [];
  if (!stack.length) {
    flashToast("当前没有可返回的上一步");
    return;
  }
  const previous = stack.pop();
  store.set({
    ...previous,
    mode: "playing",
    navStack: stack,
    ui: {
      cardsOpen: false,
      mistakesOpen: false,
      actionFeedback: null,
      metricPulse: null,
      levelPulse: null,
      milestoneCue: null
    },
    roleplay: {
      ...(previous.roleplay ?? {}),
      loading: false,
      error: null,
      healthChecking: false
    },
    duel: {
      ...(previous.duel ?? defaultDuelState()),
      loading: false,
      error: null
    }
  });
  persistStateSilently();
  flashToast("已返回上一步");
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
  if (typeof nextScene?.chapter === "number") ensureChapterEvent(nextScene.chapter);
  store.set({ sceneId, chapterIndex: nextChapterIndex, mode: "playing" });
}

function completeTask(scene, result) {
  pushNavSnapshot();
  setTaskStatus(scene.id, "completed");
  const state = store.get();
  const deliverables = { ...state.deliverables };
  deliverables[scene.id] = result.deliverable;
  store.set({ deliverables });
  if (result?.delta) applyDelta(result.delta);
  const xpAward = Math.max(0, Number(result?.xpAward ?? XP_PER_TASK));
  const xpResult = grantXp(xpAward);
  const unlocked = [];
  const firstTaskAchievement = unlockAchievement("first_task");
  if (firstTaskAchievement) unlocked.push(firstTaskAchievement);
  const chapterAchievement = unlockChapterAchievementIfComplete(scene.chapter);
  if (chapterAchievement) unlocked.push(chapterAchievement);
  const abAchievement = scene.id === "c4_task_abreadout" ? unlockAchievement("ab_analyst") : null;
  if (abAchievement) unlocked.push(abAchievement);
  const totalProgress = getTaskProgressFromState(store.get());
  const finalAchievement = totalProgress.total > 0 && totalProgress.completed >= totalProgress.total ? unlockAchievement("all_tasks_done") : null;
  if (finalAchievement) unlocked.push(finalAchievement);
  const rewardLabels = applyAchievementRewards(unlocked);
  const levelUpTitle = xpResult.leveledUp ? `｜升阶 Lv.${xpResult.nextLevel.level} ${xpResult.nextLevel.title}` : "";
  const wrongRecorded = maybeRecordWrongTask(scene, result);
  const achievementText = unlocked.length ? ` 已解锁成就：${unlocked.map((it) => `「${it.title}」`).join("、")}。` : "";
  const rewardText = rewardLabels.length ? ` ${rewardLabels.join("；")}。` : "";
  const levelUpNote = xpResult.leveledUp ? ` 你已进入 Lv.${xpResult.nextLevel.level} ${xpResult.nextLevel.title}。` : "";
  const wrongText = wrongRecorded ? " 本次已记录到错题本，建议复盘后重打。" : "";
  const actionPrefix = result?.feedbackTag ? `${result.feedbackTag}生效：` : "";
  setActionFeedback({
    title: `${actionPrefix}面试进度更新：完成交付「${result?.deliverable?.title ?? "任务交付"}」（+${xpAward} XP）${levelUpTitle}`,
    note: `${result?.deliverable?.brief ?? "本次交付已写入你的作品集摘要。"}${achievementText}${rewardText}${levelUpNote}${wrongText}`,
    delta: result?.delta
  });
  triggerMilestoneCue({
    levelInfo: xpResult.leveledUp ? xpResult.nextLevel : null,
    achievements: unlocked,
    rewards: rewardLabels
  });
  recordHistory({ kind: "task", sceneId: scene.id, deliverable: result.deliverable, delta: result.delta });
  if (scene.task?.onCompleteNext) goToScene(scene.task.onCompleteNext);
  doSave();
}

function onChoose(scene, option) {
  pushNavSnapshot();
  applyDelta(option.delta);
  const xpResult = grantXp(XP_PER_CHOICE);
  const unlocked = [];
  const firstChoiceAchievement = unlockAchievement("first_choice");
  if (firstChoiceAchievement) unlocked.push(firstChoiceAchievement);
  const rewardLabels = applyAchievementRewards(unlocked);
  const levelUpTitle = xpResult.leveledUp ? `｜升阶 Lv.${xpResult.nextLevel.level} ${xpResult.nextLevel.title}` : "";
  const levelUpNote = xpResult.leveledUp ? ` 你已进入 Lv.${xpResult.nextLevel.level} ${xpResult.nextLevel.title}。` : "";
  const wrongRecorded = maybeRecordWrongChoice(scene, option);
  const achievementText = unlocked.length ? ` 已解锁成就：${unlocked.map((it) => `「${it.title}」`).join("、")}。` : "";
  const rewardText = rewardLabels.length ? ` ${rewardLabels.join("；")}。` : "";
  const wrongText = wrongRecorded ? " 这次选择已加入错题本，可在顶栏进入复盘重打。" : "";
  setActionFeedback({
    title: `面试进度更新：你给出决策「${option.label}」（+${XP_PER_CHOICE} XP）${levelUpTitle}`,
    note: `${option.subtitle ?? option.note ?? "该决策已对训练指标产生影响。"}${achievementText}${rewardText}${levelUpNote}${wrongText}`,
    delta: option.delta
  });
  triggerMilestoneCue({
    levelInfo: xpResult.leveledUp ? xpResult.nextLevel : null,
    achievements: unlocked,
    rewards: rewardLabels
  });
  recordHistory({ kind: "choice", sceneId: scene.id, optionId: option.id, delta: option.delta, note: option.note ?? "" });
  if (option.next) goToScene(option.next);
  doSave();
}

function getScene() {
  const state = store.get();
  return content?.scenes?.find((s) => s.id === state.sceneId) ?? null;
}

function renderMetricsPanel() {
  const state = store.get();
  const keys = Object.keys(state.metrics);
  const pulse = state.ui?.metricPulse ?? null;
  const pulseActive = pulse?.at && Date.now() - pulse.at < 2800;
  const feedback = state.ui?.actionFeedback;
  const showFeedbackHint = Boolean(feedback);
  const outcome = getFeedbackOutcome(feedback?.delta ?? {});
  return `
    <div class="panel metrics-panel">
      <div class="hd">
        <h2>指标面板</h2>
        <span class="pill">范围: -2.00 ~ +2.00</span>
      </div>
      <div class="bd">
        ${
          showFeedbackHint
            ? `<div class="impact-mini ${outcome.tone}">${escapeHtml(feedback.title ?? "决策反馈")}：${escapeHtml(outcome.summary)}</div>`
            : ""
        }
        <div class="metrics">
          ${keys
            .map((k) => {
              const v = state.metrics[k];
              const p = Math.round(percentFromMetricValue(v) * 100);
              const d = pulseActive ? pulse?.delta?.[k] : undefined;
              const hasDelta = typeof d === "number" && Math.abs(d) > 0.0001;
              const isPositive = hasDelta ? isPositiveMetricDelta(k, d) : false;
              const deltaClass = hasDelta ? (isPositive ? "metric-up" : "metric-down") : "";
              return `
                <div class="metric ${deltaClass}">
                  <div class="row">
                    <div class="name">${metricLabel(k)}</div>
                    <div class="val">
                      ${fmtMetric(v)} (${p}%)
                      ${hasDelta ? `<span class="metric-delta ${isPositive ? "up" : "down"}">${fmtMetric(d)}</span>` : ""}
                    </div>
                  </div>
                  <div class="bar"><i style="width:${p}%"></i></div>
                </div>
              `;
            })
            .join("")}
        </div>
        <div class="inline-note" style="margin-top:12px">
          指标不是“真实业务数据”，而是把取舍结果映射成可解释的训练反馈（其中 Cost/Risk 下降属于正向变化）。
        </div>
      </div>
    </div>
  `;
}

function renderStart(scene) {
  const state = store.get();
  const level = getLevelFromXp(state.xp ?? 0);
  const achievements = Array.isArray(state.achievements) ? state.achievements.length : 0;
  const showGuideOverlay = !state.flags?.guideDismissed;
  return `
    <div class="panel">
      <div class="hd"><h2>开始</h2><span class="pill">MVP</span></div>
      <div class="bd">
        ${
          showGuideOverlay
            ? `
              <div class="guide-overlay">
                <div class="guide-card">
                  <div class="guide-title">开局任务卡</div>
                  <div class="guide-row"><span>你的身份</span><b>AI 产品经理（模拟训练）</b></div>
                  <div class="guide-row"><span>核心目标</span><b>完成 4 章 13 任务，建立 PM 闭环能力</b></div>
                  <div class="guide-row"><span>操作方式</span><b>每个场景做选择或提交任务，观察指标与反馈</b></div>
                  <div class="guide-row"><span>收益产出</span><b>结算页得到可复制作品集摘要</b></div>
                  <div class="guide-actions">
                    <button id="guide-start-btn" class="btn-primary">我知道了，开始训练</button>
                  </div>
                </div>
              </div>
            `
            : ""
        }
        <div class="scene">
          <h3>${scene.title}</h3>
          <div class="body">${formatBody(scene.body)}</div>
          <div class="mission-panel" style="margin-top:12px">
            <div class="mission-title">新手引导：先看这 4 条</div>
            <div class="mission-row"><span>你要做什么</span><b>完成 4 章训练，走完 PM 全流程闭环</b></div>
            <div class="mission-row"><span>怎么玩</span><b>读场景 -> 做选择 -> 完成任务交付 -> 看反馈</b></div>
            <div class="mission-row"><span>通关目标</span><b>完成全部任务并生成可复制作品集摘要</b></div>
            <div class="mission-row"><span>激励</span><b>Lv.${level.level} ${level.title}（${state.xp ?? 0} XP / ${achievements} 成就）</b></div>
          </div>
          <div class="choices">
            <button id="start-btn" class="btn-primary" style="padding:12px 14px">开始一局（30–45 分钟）</button>
            <button id="load-btn">读取本地存档</button>
            <button id="reset-btn" class="btn-danger">清空进度并重开</button>
          </div>
          <div class="inline-note">
            推荐玩法: 先按提示完成每章 1 个任务，再看结算页生成的“作品集摘要”。
          </div>
        </div>
        <div class="task" style="margin-top:16px">
          <div class="grid-2">
            <div class="card">
              <div class="k">玩法提醒</div>
              <div class="v">
                <div class="inline-note" style="margin-top:8px">建议按顺序完成任务，观察每次决策带来的指标变化与反馈。</div>
              </div>
            </div>
            <div class="card">
              <div class="k">说明</div>
              <div class="v">
                这是“AI 产品经理实习”教育模拟游戏。你会通过决策、任务交付和复盘来训练产品经理核心能力。
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
          </div>
          <div class="choices">
            <button id="back-btn">返回</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderMistakeSummaryCard() {
  const mistakes = Array.isArray(store.get().mistakes) ? store.get().mistakes : [];
  const top = mistakes.slice(0, 3);
  return `
    <div class="card" style="margin-top:10px">
      <div class="k">错题本与复盘重打</div>
      <div class="v">
        <div>当前记录：${mistakes.length} 条</div>
        ${
          top.length
            ? `<ul style="margin:8px 0 0; padding-left:18px">${top.map((it) => `<li>${escapeHtml(it.title ?? "决策")}（${escapeHtml(it.reason ?? "建议复盘")}）</li>`).join("")}</ul>`
            : `<div class="inline-note" style="margin-top:8px">暂时没有错题记录，继续保持。</div>`
        }
        <div class="row" style="margin-top:10px">
          <button id="mistake-replay-btn" ${mistakes.length ? "class='btn-primary'" : "disabled"}>重打错题</button>
          <button id="mistake-open-end-btn">查看错题本</button>
        </div>
      </div>
    </div>
  `;
}

function renderDuelPanel() {
  const state = store.get();
  const duel = normalizeDuel(state.duel);
  const aiAvailable = Boolean(state.roleplay?.health?.ok);
  const hints = normalizePowerups(state.powerups).duelHintCharges;
  const progress = duel.maxRounds ? Math.round((duel.round / duel.maxRounds) * 100) : 0;
  if (!duel.active) {
    return `
      <div class="card" style="margin-top:10px">
        <div class="k">面试官对打模式（5 轮）</div>
        <div class="v">
          <div>模拟真实 PM 面试追问。AI 可用时由模型动态出题与打分，离线时使用脚本题库。</div>
          <div class="inline-note" style="margin-top:8px">${aiAvailable ? "当前 AI 在线：将使用实时追问。" : "当前 AI 离线：将使用本地追问脚本。"}</div>
          <div class="row" style="margin-top:10px">
            <button id="duel-start-btn" class="btn-primary">开始对打</button>
          </div>
        </div>
      </div>
    `;
  }
  const current = duel.currentQuestion;
  const feedback = duel.currentFeedback;
  const isReviewStep = Boolean(feedback);
  return `
    <div class="card duel-card" style="margin-top:10px">
      <div class="k">面试官对打模式（第 ${duel.round}/${duel.maxRounds} 轮）</div>
      <div class="v">
        <div class="mission-progress level" style="margin-top:8px"><i style="width:${progress}%"></i></div>
        <div style="margin-top:8px">累计得分：<b>${duel.totalScore}</b> / ${duel.maxRounds * 5}</div>
        ${
          current
            ? `
              <div class="event-panel" style="margin-top:10px">
                <div class="event-title">题目</div>
                <div class="event-body">${escapeHtml(current.question ?? "")}</div>
                <div class="inline-note" style="margin-top:8px">考察点：${escapeHtml(current.focus ?? "结构化表达")}</div>
                ${
                  Array.isArray(current.rubric) && current.rubric.length
                    ? `<div class="inline-note" style="margin-top:8px">评分要点：${current.rubric.map(escapeHtml).join("；")}</div>`
                    : ""
                }
              </div>
            `
            : `<div class="inline-note" style="margin-top:8px">正在准备题目...</div>`
        }
        ${isReviewStep ? `<div class="duel-score">本轮评分：${feedback.score}/5｜${escapeHtml(feedback.verdict ?? "")}</div>` : ""}
        ${isReviewStep ? `<div class="inline-note" style="margin-top:8px">亮点：${escapeHtml(feedback.strength ?? "暂无")}；缺口：${escapeHtml(feedback.miss ?? "暂无")}</div>` : ""}
        ${isReviewStep ? `<div class="inline-note" style="margin-top:8px">建议：${escapeHtml(feedback.next ?? "继续保持结构化表达。")}</div>` : ""}
        ${duel.hintText ? `<div class="inline-note" style="margin-top:8px">${escapeHtml(duel.hintText)}</div>` : ""}
        <textarea id="duel-answer-input" ${isReviewStep ? "disabled" : ""} placeholder="用结构化方式回答：背景/取舍/验证/风险与下一步"></textarea>
        ${duel.error ? `<div class="error" style="margin-top:8px">${escapeHtml(duel.error)}</div>` : ""}
        <div class="row" style="margin-top:10px">
          ${
            !isReviewStep
              ? `<button id="duel-submit-btn" class="btn-primary" ${duel.loading ? "disabled" : ""}>提交回答</button>`
              : duel.round < duel.maxRounds
                ? `<button id="duel-next-btn" class="btn-primary" ${duel.loading ? "disabled" : ""}>下一问</button>`
                : `<button id="duel-finish-btn" class="btn-primary" ${duel.loading ? "disabled" : ""}>生成面试总结</button>`
          }
          <button id="duel-hint-btn" ${hints > 0 && !isReviewStep ? "" : "disabled"}>使用${DUEL_HINT_NAME}（剩余 ${hints}）</button>
          <button id="duel-stop-btn" ${duel.loading ? "disabled" : ""}>退出对打</button>
        </div>
        ${
          duel.summary
            ? `<div class="card" style="margin-top:10px"><div class="k">对打总结</div><div class="v">${formatBody(duel.summary)}</div></div>`
            : ""
        }
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
            ${renderMistakeSummaryCard()}
            ${renderDuelPanel()}
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
  const eventHtml = renderChapterEvent(scene);
  const insightText = scene?.chapter ? HIDDEN_INSIGHTS_BY_CHAPTER[scene.chapter] : "";
  const insightHtml =
    insightText && normalizePowerups(state.powerups).insightLens
      ? `<div class="insight-panel">洞察透镜：${escapeHtml(insightText)}</div>`
      : "";

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
          <div style="display:flex; gap:8px; align-items:center; justify-content:flex-end">
            <div class="pill" id="task-status">状态: ${taskStatus}</div>
            ${canSkipCurrentTask(scene) ? `<button id="skip-task-btn">使用${SKIP_CARD_NAME}</button>` : ""}
          </div>
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
          ${renderMissionPanel(scene)}
          ${eventHtml}
          ${insightHtml}
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
  const actionFeedbackPanel = renderActionFeedback();
  return `
    <div style="display:grid; gap:14px">
      ${actionFeedbackPanel}
      ${renderScene(scene)}
      ${roleplayPanel}
    </div>
  `;
}

function renderActionFeedback() {
  const feedback = store.get().ui?.actionFeedback;
  if (!feedback) return "";
  const levelUp = /升阶/.test(String(feedback.title ?? ""));
  const outcome = getFeedbackOutcome(feedback.delta ?? {});
  const deltaEntries = Object.entries(feedback.delta ?? {}).filter(([, value]) => typeof value === "number" && Math.abs(value) > 0.0001);
  const deltaText = deltaEntries.length
    ? deltaEntries.map(([key, value]) => `${metricLabel(key)} ${fmtMetric(value)}`).join(" ｜ ")
    : "本次操作不改变指标";
  return `
    <div class="impact-banner ${levelUp ? "level-up" : ""} ${outcome.tone}">
      <div class="title">${escapeHtml(feedback.title ?? "决策已生效")}</div>
      <div class="delta">${escapeHtml(deltaText)}</div>
      <div class="impact-summary">${escapeHtml(outcome.summary)}</div>
      <div class="impact-chips">
        ${outcome.chips.map((chip) => `<span class="impact-chip ${chip.positive ? "good" : "bad"}">${escapeHtml(chip.text)}</span>`).join("")}
      </div>
      <div class="impact-suggestion">${escapeHtml(outcome.suggestion)}</div>
      ${feedback.note ? `<div class="note">${escapeHtml(feedback.note)}</div>` : ""}
    </div>
  `;
}

function renderMilestoneCue() {
  const cue = store.get().ui?.milestoneCue;
  if (!cue?.title) return "";
  const isActive = cue?.at ? Date.now() - cue.at < MILESTONE_CUE_VISIBLE_MS + 500 : true;
  if (!isActive) return "";
  return `
    <div class="milestone-cue-wrap">
      <div class="milestone-cue">
        <div class="title">${escapeHtml(cue.title)}</div>
        ${cue.subtitle ? `<div class="subtitle">${escapeHtml(cue.subtitle)}</div>` : ""}
        ${
          Array.isArray(cue.badges) && cue.badges.length
            ? `<div class="badges">${cue.badges.map((it) => `<span class="pill">${escapeHtml(it)}</span>`).join("")}</div>`
            : ""
        }
      </div>
    </div>
  `;
}

function chapterGoalText(chapter) {
  const map = {
    1: "定义目标边界与埋点口径，避免一开始就跑偏。",
    2: "找到真实瓶颈并产出可执行的竞品差异结论。",
    3: "平衡体验与 AI 方案取舍，补齐 bad case 兜底。",
    4: "完成 A/B 全流程、灰度闭环和迭代决策。"
  };
  return map[chapter] ?? "完成当前场景，持续推进项目闭环。";
}

function renderMissionPanel(scene) {
  const state = store.get();
  const levelProgress = getLevelProgress(state.xp ?? 0);
  const powerups = normalizePowerups(state.powerups);
  const replay = normalizeReplay(state.replay);
  const taskProgress = getTaskProgressFromState(state);
  const chapterProgress = getChapterTaskProgress(state, scene.chapter);
  const allPct = taskProgress.total ? Math.round((taskProgress.completed / taskProgress.total) * 100) : 0;
  const chapterPct = chapterProgress.total ? Math.round((chapterProgress.completed / chapterProgress.total) * 100) : 0;
  const currentAction = scene.task
    ? `完成当前任务交付（奖励 +${XP_PER_TASK} XP）`
    : scene.options?.length
      ? `做出关键决策推进剧情（奖励 +${XP_PER_CHOICE} XP）`
      : "阅读反馈并进入下一步";
  const levelLabel = levelProgress.next
    ? `Lv.${levelProgress.current.level} ${levelProgress.current.title}（距 Lv.${levelProgress.next.level} 还差 ${levelProgress.remaining} XP）`
    : `Lv.${levelProgress.current.level} ${levelProgress.current.title}（已满级）`;
  const powerupLabel = `${SKIP_CARD_NAME} ${powerups.skipTaskCharges}｜${DUEL_HINT_NAME} ${powerups.duelHintCharges}${powerups.insightLens ? "｜洞察透镜已启用" : ""}`;
  const replayLabel = replay.active ? `错题重打中 ${Math.min(replay.index + 1, replay.sceneIds.length)}/${replay.sceneIds.length}` : "未开启";
  return `
    <div class="mission-panel">
      <div class="mission-title">当前目标与玩法指引</div>
      <div class="mission-row"><span>本章目标</span><b>${chapterGoalText(scene.chapter)}</b></div>
      <div class="mission-row"><span>当前动作</span><b>${currentAction}</b></div>
      <div class="mission-row"><span>当前段位</span><b>${levelLabel}</b></div>
      <div class="mission-row"><span>能力道具</span><b>${powerupLabel}</b></div>
      <div class="mission-row"><span>复盘模式</span><b>${replayLabel}</b></div>
      <div class="mission-row"><span>章节完成度</span><b>${chapterProgress.completed}/${chapterProgress.total} (${chapterPct}%)</b></div>
      <div class="mission-row"><span>全局通关进度</span><b>${taskProgress.completed}/${taskProgress.total} (${allPct}%)</b></div>
      <div class="mission-progress level"><i style="width:${levelProgress.pct}%"></i></div>
      <div class="mission-progress"><i style="width:${allPct}%"></i></div>
    </div>
  `;
}

function renderTopbar() {
  const state = store.get();
  const levelProgress = getLevelProgress(state.xp ?? 0);
  const levelPulse = state.ui?.levelPulse ?? null;
  const levelPulseActive = Boolean(levelPulse?.at && Date.now() - levelPulse.at < LEVEL_PULSE_VISIBLE_MS);
  const achievementCount = Array.isArray(state.achievements) ? state.achievements.length : 0;
  const powerups = normalizePowerups(state.powerups);
  const replay = normalizeReplay(state.replay);
  const mistakeCount = Array.isArray(state.mistakes) ? state.mistakes.length : 0;
  return `
    <div class="topbar">
      <div class="brand">
        <h1>AI 产品经理·宠物鉴别实习模拟器</h1>
        <span class="pill">v${APP_VERSION}</span>
      </div>
      <div class="top-stats ${levelPulseActive ? "level-up" : ""}">
        <div class="top-stats-row">
          <span class="pill xp-pill">XP ${state.xp ?? 0}</span>
          <span class="pill level-pill">Lv.${levelProgress.current.level} ${levelProgress.current.title}</span>
          <span class="pill">成就 ${achievementCount}</span>
          <span class="pill">${SKIP_CARD_NAME} ${powerups.skipTaskCharges}</span>
          <span class="pill">${DUEL_HINT_NAME} ${powerups.duelHintCharges}</span>
        </div>
        <div class="top-stats-note">
          ${
            levelProgress.next
              ? `距离 Lv.${levelProgress.next.level} 还差 ${levelProgress.remaining} XP｜${DUEL_HINT_NAME}仅用于结算页对打`
              : "段位已满，继续打磨你的项目方法论"
          }
        </div>
        <div class="top-stats-bar"><i style="width:${levelProgress.pct}%"></i></div>
      </div>
      <div class="top-actions">
        <button id="guide-open-btn">查看引导</button>
        <button id="mistakes-btn">错题本 (${mistakeCount})</button>
        <button id="replay-next-btn" ${replay.active ? "" : "disabled"}>下一错题</button>
        <button id="back-scene-btn" ${canGoBack() ? "" : "disabled"}>上一步</button>
        <button id="restart-top-btn" class="btn-danger">重新开始</button>
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
  const healthChecking = Boolean(state.roleplay?.healthChecking);
  const statusLabel = health.checked ? (health.ok ? "AI 在线" : "AI 离线") : "AI 未检测";
  const statusNote = resolveHealthNote(health);

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
          <div class="row" style="margin-top:8px">
            <button id="roleplay-health-check" ${healthChecking ? "disabled" : ""}>
              ${healthChecking ? "正在检测..." : "重试 AI 连接"}
            </button>
          </div>
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

function resolveHealthNote(health) {
  if (!health?.checked) return "尚未检测 AI 服务，默认使用离线脚本模式。";
  if (health.ok) return "可用：将角色扮演对话延展到更真实的沟通场景。";
  if (health.message === "missing_api_key") {
    return "已检测到 AI 服务，但未配置 API Key，已切换为离线脚本模式。";
  }
  return "未检测到 AI 服务，已切换为离线脚本模式。";
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

function renderMistakesModal() {
  const state = store.get();
  if (!state.ui?.mistakesOpen) return "";
  const mistakes = Array.isArray(state.mistakes) ? state.mistakes : [];
  return `
    <div id="mistakes-modal" style="position:fixed; inset:0; background: rgba(0,0,0,0.6); z-index:62; display:flex; align-items:center; justify-content:center; padding:18px">
      <div class="panel" style="max-width: 920px; width: 100%; max-height: 84vh; overflow:hidden">
        <div class="hd">
          <h2>错题本</h2>
          <button id="mistakes-close">关闭</button>
        </div>
        <div class="bd" style="max-height: 74vh; overflow:auto">
          ${
            mistakes.length
              ? `
                <div class="row" style="margin-bottom:10px">
                  <button id="mistake-replay-start-modal" class="btn-primary">顺序重打</button>
                </div>
                ${mistakes
                  .map(
                    (item, index) => `
                      <div class="card" style="margin-bottom:10px">
                        <div class="k">#${index + 1} ${escapeHtml(item.title ?? "错误决策")}</div>
                        <div class="v">
                          <div>${escapeHtml(item.reason ?? "建议复盘。")}</div>
                          <div class="inline-note" style="margin-top:8px">出现次数: ${Number(item.count ?? 1)} ｜ 场景: ${escapeHtml(item.sceneId ?? "-")}</div>
                          <div class="row" style="margin-top:8px">
                            <button data-replay-scene="${escapeHtml(item.sceneId ?? "")}">跳转重打</button>
                          </div>
                        </div>
                      </div>
                    `
                  )
                  .join("")}
              `
              : `<div class="inline-note">当前没有错题记录。你每次“高风险低收益”决策都会自动记录在这里。</div>`
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
      ${renderMilestoneCue()}
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
      ${renderMistakesModal()}
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

  const backSceneBtn = document.getElementById("back-scene-btn");
  if (backSceneBtn) backSceneBtn.onclick = () => goBackOneStep();

  const restartTopBtn = document.getElementById("restart-top-btn");
  if (restartTopBtn) {
    restartTopBtn.onclick = () => {
      storage.removeItem(SAVE_KEY);
      resetGame({ keepContentMode: true });
      flashToast("已重新开始");
    };
  }

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
        const next = parsed.state;
        store.set({
          ...next,
          contentMode: "public",
          mode: "playing",
          powerups: normalizePowerups(next?.powerups),
          mistakes: Array.isArray(next?.mistakes) ? next.mistakes : [],
          replay: normalizeReplay(next?.replay),
          duel: normalizeDuel(next?.duel),
          flags: {
            ...(next?.flags ?? {}),
            guideDismissed: Boolean(next?.flags?.guideDismissed),
            taskStatus: { ...(next?.flags?.taskStatus ?? {}) },
            chapterEvents: { ...(next?.flags?.chapterEvents ?? {}) }
          },
          navStack: Array.isArray(next?.navStack) ? next.navStack : [],
          ui: {
            cardsOpen: Boolean(next?.ui?.cardsOpen),
            mistakesOpen: false,
            actionFeedback: null,
            metricPulse: null,
            levelPulse: null,
            milestoneCue: null
          },
          roleplay: {
            ...(next?.roleplay ?? {}),
            loading: false,
            error: null,
            healthChecking: false
          }
        });
        const loadedScene = content?.scenes?.find((s) => s.id === next.sceneId) ?? null;
        if (typeof loadedScene?.chapter === "number") ensureChapterEvent(loadedScene.chapter);
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
  if (aboutBtn) {
    aboutBtn.onclick = () => {
      if (scene?.id && scene.id !== "about") pushNavSnapshot();
      goToScene("about");
    };
  }

  const guideStartBtn = document.getElementById("guide-start-btn");
  if (guideStartBtn) {
    guideStartBtn.onclick = () => {
      const now = store.get();
      store.set({ flags: { ...(now.flags ?? {}), guideDismissed: true } });
    };
  }
  const guideOpenBtn = document.getElementById("guide-open-btn");
  if (guideOpenBtn) {
    guideOpenBtn.onclick = () => {
      const now = store.get();
      store.set({ flags: { ...(now.flags ?? {}), guideDismissed: false } });
      if (scene?.id !== "start") goToScene("start");
    };
  }

  const mistakesBtn = document.getElementById("mistakes-btn");
  if (mistakesBtn) {
    mistakesBtn.onclick = () => store.set({ ui: { ...(store.get().ui ?? {}), mistakesOpen: true } });
  }
  const replayNextBtn = document.getElementById("replay-next-btn");
  if (replayNextBtn) replayNextBtn.onclick = () => goNextReplayScene();

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

  const mistakesClose = document.getElementById("mistakes-close");
  if (mistakesClose) mistakesClose.onclick = () => store.set({ ui: { ...(store.get().ui ?? {}), mistakesOpen: false } });
  const mistakesModal = document.getElementById("mistakes-modal");
  if (mistakesModal) {
    mistakesModal.onclick = (e) => {
      if (e.target?.id === "mistakes-modal") store.set({ ui: { ...(store.get().ui ?? {}), mistakesOpen: false } });
    };
  }
  const replayStartFromModal = document.getElementById("mistake-replay-start-modal");
  if (replayStartFromModal) replayStartFromModal.onclick = () => startMistakeReplay();
  for (const el of document.querySelectorAll("[data-replay-scene]")) {
    el.addEventListener("click", () => {
      const sceneId = el.getAttribute("data-replay-scene");
      if (!sceneId) return;
      goToScene(sceneId);
      store.set({ ui: { ...(store.get().ui ?? {}), mistakesOpen: false } });
      flashToast("已跳转到错题场景");
    });
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

  const mistakeReplayBtn = document.getElementById("mistake-replay-btn");
  if (mistakeReplayBtn) mistakeReplayBtn.onclick = () => startMistakeReplay();
  const mistakeOpenEndBtn = document.getElementById("mistake-open-end-btn");
  if (mistakeOpenEndBtn) mistakeOpenEndBtn.onclick = () => store.set({ ui: { ...(store.get().ui ?? {}), mistakesOpen: true } });

  const duelStartBtn = document.getElementById("duel-start-btn");
  if (duelStartBtn) duelStartBtn.onclick = () => void startInterviewDuel();
  const duelSubmitBtn = document.getElementById("duel-submit-btn");
  if (duelSubmitBtn) duelSubmitBtn.onclick = () => void submitInterviewDuelAnswer();
  const duelNextBtn = document.getElementById("duel-next-btn");
  if (duelNextBtn) duelNextBtn.onclick = () => void nextInterviewDuelQuestion();
  const duelFinishBtn = document.getElementById("duel-finish-btn");
  if (duelFinishBtn) duelFinishBtn.onclick = () => finishInterviewDuel();
  const duelStopBtn = document.getElementById("duel-stop-btn");
  if (duelStopBtn) duelStopBtn.onclick = () => stopInterviewDuel();
  const duelHintBtn = document.getElementById("duel-hint-btn");
  if (duelHintBtn) duelHintBtn.onclick = () => useDuelHint();

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
        el.classList.add("choice-picked");
        for (const btn of document.querySelectorAll("[data-choice]")) btn.setAttribute("disabled", "disabled");
        setTimeout(() => onChoose(scene, opt), 160);
      });
    }
  }

  for (const el of document.querySelectorAll("[data-event-choice]")) {
    el.addEventListener("click", () => {
      const chapter = Number(el.getAttribute("data-event-chapter"));
      const eventId = el.getAttribute("data-event-id");
      const optionId = el.getAttribute("data-event-choice");
      if (!chapter || !eventId || !optionId) return;
      handleChapterEventChoice(scene, chapter, eventId, optionId);
    });
  }

  const skipTaskBtn = document.getElementById("skip-task-btn");
  if (skipTaskBtn && scene?.task) {
    skipTaskBtn.onclick = () => {
      if (!consumeSkipTaskCharge()) {
        flashToast(`${SKIP_CARD_NAME}不足`);
        return;
      }
      const result = buildSkippedTaskResult(scene);
      completeTask(scene, result);
    };
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
  const healthCheckBtn = document.getElementById("roleplay-health-check");
  if (healthCheckBtn) {
    healthCheckBtn.onclick = () => {
      void checkAiHealth();
    };
  }

  document.onkeydown = (e) => {
    if (store.get().ui?.cardsOpen && e.key === "Escape") store.set({ ui: { ...(store.get().ui ?? {}), cardsOpen: false } });
    if (store.get().ui?.mistakesOpen && e.key === "Escape") store.set({ ui: { ...(store.get().ui ?? {}), mistakesOpen: false } });
    if (e.key.toLowerCase() === "s" && (e.metaKey || e.ctrlKey)) return;
    if (e.key.toLowerCase() === "s") doSave();
    if (e.key.toLowerCase() === "r") resetGame({ keepContentMode: true });
    if (e.key.toLowerCase() === "m") store.set({ ui: { ...(store.get().ui ?? {}), mistakesOpen: true } });
    if (e.key.toLowerCase() === "n") goNextReplayScene();
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
  let health = store.get().roleplay?.health;
  if (!health?.ok) {
    await checkAiHealth({ silent: true });
    health = store.get().roleplay?.health;
  }
  if (health?.ok) {
    await requestRoleplay(scene, text);
  } else {
    const reply = localRoleplayReply(scene, text);
    appendRoleplayMessage(roleplayId, { role: "AI", text: reply });
  }
}

function handleChapterEventChoice(scene, chapter, eventId, optionId) {
  const event = getChapterEventById(chapter, eventId);
  const option = event?.options?.find((it) => it.id === optionId);
  if (!event || !option) return;
  pushNavSnapshot();
  applyDelta(option.delta);
  const xpResult = grantXp(XP_PER_EVENT);
  const state = store.get();
  const chapterEvents = { ...(state.flags?.chapterEvents ?? {}) };
  chapterEvents[chapter] = { ...(chapterEvents[chapter] ?? {}), eventId, resolved: true, chosenId: optionId };
  store.set({ flags: { ...(state.flags ?? {}), chapterEvents } });
  const wrongRecorded = maybeRecordWrongEvent(scene?.id ?? "", event.title, option);
  const levelUpTitle = xpResult.leveledUp ? `｜升阶 Lv.${xpResult.nextLevel.level} ${xpResult.nextLevel.title}` : "";
  setActionFeedback({
    title: `面试突发题：${event.title}（+${XP_PER_EVENT} XP）${levelUpTitle}`,
    note: `${option.note ?? "你完成了一次突发取舍训练。"}${wrongRecorded ? " 这次应对已记录到错题本。" : ""}`,
    delta: option.delta
  });
  triggerMilestoneCue({
    levelInfo: xpResult.leveledUp ? xpResult.nextLevel : null,
    achievements: [],
    rewards: []
  });
  recordHistory({ kind: "chapter_event", sceneId: scene?.id ?? "", chapter, eventId, optionId, delta: option.delta });
  doSave();
}

function getCurrentDuel() {
  return { ...defaultDuelState(), ...(store.get().duel ?? {}) };
}

function setDuel(patch) {
  const duel = getCurrentDuel();
  store.set({ duel: { ...duel, ...patch } });
}

async function requestAiJson(action, payload) {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload })
  });
  const text = await res.text();
  const json = safeJsonParse(text);
  if (!res.ok) {
    throw new Error(json?.error || text || "AI 服务不可用");
  }
  return json?.result?.json ?? json?.result ?? {};
}

function localDuelQuestion(round) {
  const idx = Math.max(0, (round - 1) % LOCAL_DUEL_QUESTIONS.length);
  const item = LOCAL_DUEL_QUESTIONS[idx];
  return {
    question: item.question,
    focus: item.focus,
    rubric: item.rubric,
    followup: "请给出可执行的下一步，不要只说原则。"
  };
}

function localDuelReview(question, answer) {
  const keywords = Array.isArray(question?.keywords) ? question.keywords : [];
  const normalized = String(answer ?? "").toLowerCase();
  const hit = keywords.filter((kw) => normalized.includes(String(kw).toLowerCase())).length;
  const score = Math.max(1, Math.min(5, Math.round((hit / Math.max(1, keywords.length)) * 5)));
  return {
    score,
    verdict: score >= 4 ? "结构化较完整，具备可落地性。" : score >= 3 ? "思路可用，但证据和风险控制不足。" : "回答偏泛，需要补充可验证动作。",
    strength: score >= 3 ? "表达有取舍意识。" : "有基本方向感。",
    miss: score >= 4 ? "可进一步量化目标与护栏。" : "缺少指标口径、验证路径或回滚策略。",
    next: "建议按“目标-方案-验证-风险-下一步”五段式回答。"
  };
}

async function generateDuelQuestion(round) {
  const health = store.get().roleplay?.health;
  if (health?.ok) {
    try {
      const result = await requestAiJson("interview_duel_question", {
        ...buildAiPayload(),
        round,
        duelHistory: getCurrentDuel().history
      });
      if (typeof result?.question === "string" && result.question.trim()) {
        return {
          question: result.question.trim(),
          focus: String(result.focus ?? "结构化表达"),
          rubric: Array.isArray(result.rubric) ? result.rubric.slice(0, 4) : [],
          followup: String(result.followup ?? ""),
          keywords: []
        };
      }
    } catch (err) {
      console.warn("duel question fallback:", err);
    }
  }
  return localDuelQuestion(round);
}

async function evaluateDuelAnswer(question, answer) {
  const health = store.get().roleplay?.health;
  if (health?.ok) {
    try {
      const result = await requestAiJson("interview_duel_review", {
        ...buildAiPayload(),
        question,
        answer
      });
      const score = Math.max(1, Math.min(5, Number(result?.score ?? 3)));
      return {
        score,
        verdict: String(result?.verdict ?? "回答已评估。"),
        strength: String(result?.strength ?? "有基本框架。"),
        miss: String(result?.miss ?? "建议补充验证与风险控制。"),
        next: String(result?.next ?? "下一轮尝试更明确地给出指标与动作。")
      };
    } catch (err) {
      console.warn("duel review fallback:", err);
    }
  }
  return localDuelReview(question, answer);
}

async function startInterviewDuel() {
  setDuel({ ...defaultDuelState(), active: true, loading: true });
  await nextInterviewDuelQuestion({ fromStart: true });
}

async function nextInterviewDuelQuestion({ fromStart = false } = {}) {
  const duel = getCurrentDuel();
  const nextRound = fromStart ? 1 : duel.round + 1;
  if (nextRound > duel.maxRounds) {
    finishInterviewDuel();
    return;
  }
  setDuel({ loading: true, error: null, currentFeedback: null, hintText: "" });
  try {
    const question = await generateDuelQuestion(nextRound);
    setDuel({
      active: true,
      loading: false,
      round: nextRound,
      currentQuestion: question,
      currentFeedback: null,
      hintText: ""
    });
  } catch (err) {
    setDuel({ loading: false, error: String(err?.message || err) });
  }
}

async function submitInterviewDuelAnswer() {
  const input = document.getElementById("duel-answer-input");
  const answer = (input?.value ?? "").trim();
  if (!answer) {
    flashToast("请先输入回答");
    return;
  }
  const duel = getCurrentDuel();
  if (!duel.currentQuestion) return;
  setDuel({ loading: true, error: null });
  try {
    const feedback = await evaluateDuelAnswer(duel.currentQuestion, answer);
    const history = duel.history.concat([
      {
        round: duel.round,
        question: duel.currentQuestion.question,
        answer,
        feedback
      }
    ]);
    setDuel({
      loading: false,
      history,
      currentFeedback: feedback,
      totalScore: duel.totalScore + Number(feedback.score ?? 0),
      hintText: ""
    });
    recordHistory({ kind: "duel_round", round: duel.round, score: feedback.score, verdict: feedback.verdict });
    if (Number(feedback.score ?? 0) <= 2) {
      pushMistake({
        kind: "duel",
        sceneId: "c4_task_abreadout",
        refId: `duel_round_${duel.round}`,
        title: `面试对打第 ${duel.round} 轮`,
        reason: `评分 ${feedback.score}/5。${feedback.miss || "建议补齐结构化回答。"}`
      });
    }
  } catch (err) {
    setDuel({ loading: false, error: String(err?.message || err) });
  }
}

function useDuelHint() {
  const state = store.get();
  const powerups = normalizePowerups(state.powerups);
  if (powerups.duelHintCharges <= 0) {
    flashToast(`${DUEL_HINT_NAME}已用完`);
    return;
  }
  const duel = getCurrentDuel();
  if (!duel.currentQuestion) return;
  powerups.duelHintCharges -= 1;
  const hints = Array.isArray(duel.currentQuestion.rubric) ? duel.currentQuestion.rubric.slice(0, 3) : [];
  const hintText = hints.length ? `提示：优先覆盖 ${hints.join("、")}` : "提示：先说目标，再说验证与风险。";
  store.set({ powerups, duel: { ...duel, hintText } });
}

function buildDuelSummary(duel) {
  const avg = duel.round ? (duel.totalScore / duel.round).toFixed(1) : "0.0";
  const weakRounds = duel.history.filter((it) => Number(it.feedback?.score ?? 0) <= 2);
  const strengths = duel.history
    .map((it) => it.feedback?.strength)
    .filter(Boolean)
    .slice(0, 2)
    .join("；");
  const misses = weakRounds
    .map((it) => it.feedback?.miss)
    .filter(Boolean)
    .slice(0, 2)
    .join("；");
  return [
    `总分：${duel.totalScore}/${duel.maxRounds * 5}（平均 ${avg}/5）`,
    strengths ? `亮点：${strengths}` : "亮点：具备基本产品思维。",
    misses ? `待改进：${misses}` : "待改进：继续提升数据验证与风险表达。",
    "建议：面试回答优先使用“目标-方案-验证-风险-下一步”结构。"
  ].join("\n");
}

function finishInterviewDuel() {
  const duel = getCurrentDuel();
  if (!duel.active) return;
  const summary = buildDuelSummary(duel);
  setDuel({ ...duel, summary, loading: false, error: null });
  flashToast("面试对打总结已生成");
}

function stopInterviewDuel() {
  setDuel(defaultDuelState());
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
  const level = getLevelFromXp(state.xp ?? 0);
  const mistakes = Array.isArray(state.mistakes) ? state.mistakes.length : 0;
  const duel = normalizeDuel(state.duel);
  const lines = [];
  lines.push("项目: 宠物鉴别教育模拟");
  lines.push(`角色: AI 产品经理（模拟）`);
  lines.push(`段位: Lv.${level.level} ${level.title}（XP ${state.xp ?? 0}）`);
  lines.push(`错题复盘: ${mistakes} 条`);
  if (duel.history.length) {
    lines.push(`面试对打: ${duel.totalScore}/${duel.maxRounds * 5}`);
  }
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
  content = await loadContentBundle();
  await checkAiHealth({ silent: true });
  startHealthPolling();
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

function startHealthPolling() {
  if (healthPollTimer) return;
  healthPollTimer = window.setInterval(() => {
    void checkAiHealth({ silent: true });
  }, 30000);
}

async function checkAiHealth({ silent = false } = {}) {
  const previous = store.get().roleplay ?? {};
  store.set({
    roleplay: {
      ...previous,
      healthChecking: true
    }
  });
  try {
    const res = await fetch("/api/health");
    const text = await res.text();
    const json = safeJsonParse(text);
    const ok = Boolean(res.ok && json?.ok);
    const message = typeof json?.message === "string" && json.message ? json.message : ok ? "ready" : `http_${res.status}`;
    store.set({
      roleplay: {
        ...(store.get().roleplay ?? {}),
        healthChecking: false,
        health: { ok, checked: true, message }
      }
    });
    if (!silent) {
      if (ok) flashToast("AI 服务已连接");
      else if (message === "missing_api_key") flashToast("AI 服务已启动，但未配置 API Key");
      else flashToast("未检测到 AI 服务，已使用离线模式");
    }
  } catch {
    store.set({
      roleplay: {
        ...(store.get().roleplay ?? {}),
        healthChecking: false,
        health: { ok: false, checked: true, message: "unreachable" }
      }
    });
    if (!silent) flashToast("未检测到 AI 服务，已使用离线模式");
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
    history: state.history,
    mistakes: state.mistakes,
    powerups: state.powerups
  };
}
