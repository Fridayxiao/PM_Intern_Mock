import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "node:path";
import fs from "node:fs";

dotenv.config();

const PORT = Number(process.env.AI_SERVER_PORT || 8787);
const API_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
function normalizeBaseUrl(url) {
  const trimmed = url.replace(/\/$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

const BASE_URL = normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com");
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"], credentials: false }));

const distPath = path.join(process.cwd(), "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/health", (_req, res) => {
  const keyConfigured = Boolean(API_KEY);
  res.json({
    ok: keyConfigured,
    keyConfigured,
    model: MODEL,
    message: keyConfigured ? "ready" : "missing_api_key"
  });
});

function buildContext(payload) {
  const history = Array.isArray(payload?.history) ? payload.history.slice(-6) : [];
  return {
    contentMode: payload?.contentMode ?? "public",
    sceneTitle: payload?.sceneTitle ?? "",
    chapterIndex: payload?.chapterIndex ?? 0,
    metrics: payload?.metrics ?? {},
    deliverables: payload?.deliverables ?? {},
    recentActions: history,
    roleplay: payload?.roleplay ?? {},
    thread: payload?.thread ?? [],
    userText: payload?.userText ?? ""
  };
}

function systemPrompt(action) {
  const base = [
    "你是 AI 产品经理的互动素材生成器。",
    "输出必须是 JSON。",
    "不要提真实公司名，不要编造具体业务数据。",
    "尽量简短（<=220 字）。"
  ];
  const map = {
    roleplay_step: [
      "生成一条角色扮演对话回复。",
      "输出要帮助用户推进真实工作对话：澄清口径、收敛目标、确认下一步。",
      '格式：{"reply":"...","next_actions":["...","..."],"risks":["..."]}'
    ],
    stakeholder_duel: [
      "生成 2 个相互冲突的 stakeholder 诉求。",
      '格式：{"stakeholders":[{"role":"业务","ask":"..."},{"role":"技术","ask":"..."}],"conflict":"...","your_task":"..."}'
    ],
    mvp_risks: [
      "生成 3-5 条 MVP 风险清单。",
      '格式：{"items":["...","...","..."]}'
    ],
    user_interview: [
      "生成 3 条用户访谈洞察 + 1-2 句原话。",
      '格式：{"summary":"...","items":["..."],"quotes":["..."]}'
    ],
    competitor_risks: [
      "生成 3 条竞品启示或风险提示。",
      '格式：{"items":["...","...","..."]}'
    ],
    bad_case_batch: [
      "生成 3 个 bad case 样例（症状+可能原因）。",
      '格式：{"items":["症状…原因…","...","..."]}'
    ],
    tech_review: [
      "生成 3 条技术评审质疑 + 2 条可行回答方向。",
      '格式：{"items":["质疑: ...","质疑: ...","质疑: ..."],"actions":["回答方向...","回答方向..."]}'
    ],
    ab_result_sample: [
      "生成 1 组 A/B 结果样本。",
      '格式：{"ab_result":{"primary_metric":"...","lift":"+x%","p_value":"0.xx","guardrail":"..."}, "result":"一句话解读"}'
    ],
    launch_checklist: [
      "生成 4 条上线检查清单。",
      '格式：{"items":["...","...","...","..."]}'
    ]
  };
  return [...base, ...(map[action] ?? ["生成 3 条要点。", '{"items":["...","...","..."]}'])].join("\n");
}

function userPrompt(context) {
  return [
    "当前场景与状态如下：",
    JSON.stringify(context, null, 2)
  ].join("\n");
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function callModel(action, payload) {
  if (!API_KEY) {
    throw new Error("Missing API key. Set DEEPSEEK_API_KEY or OPENAI_API_KEY.");
  }
  const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });
  const context = buildContext(payload);
  const messages = [
    { role: "system", content: systemPrompt(action) },
    { role: "user", content: userPrompt(context) }
  ];
  let text = "";
  let json = null;

  for (let i = 0; i < 2; i += 1) {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.4,
      max_tokens: 500
    });
    text = completion.choices?.[0]?.message?.content ?? "";
    json = safeJson(text);
    if (text.trim()) break;
  }

  return { text, json };
}

app.post("/api/ai", async (req, res) => {
  const { action, payload } = req.body ?? {};
  const allowed = [
    "roleplay_step",
    "stakeholder_duel",
    "mvp_risks",
    "user_interview",
    "competitor_risks",
    "bad_case_batch",
    "tech_review",
    "ab_result_sample",
    "launch_checklist"
  ];
  if (!allowed.includes(action)) {
    return res.status(400).json({ ok: false, error: "invalid_action" });
  }
  try {
    const result = await callModel(action, payload);
    res.json({ ok: true, action, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.get("*", (req, res) => {
  if (fs.existsSync(path.join(distPath, "index.html"))) {
    res.sendFile(path.join(distPath, "index.html"));
  } else {
    res.status(404).send("Not Found");
  }
});

app.listen(PORT, () => {
  console.log(`[ai-server] listening on http://localhost:${PORT}`);
});
