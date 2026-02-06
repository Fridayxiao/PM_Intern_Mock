const DECISIONS = [
  { id: "ship", label: "上线推广（扩大灰度）", delta: { efficiency: +0.06, risk: -0.02 } },
  { id: "extend", label: "延长实验（继续观察）", delta: { risk: -0.04, efficiency: -0.02 } },
  { id: "rollback", label: "回滚改动（保护体验）", delta: { risk: -0.06, ux: +0.02 } },
  { id: "segment", label: "只在特定人群上线", delta: { risk: -0.03, ux: +0.04 } }
];

const DEFAULT_RESULT = {
  primary_metric: "完成率（提交→结果）",
  lift: "+6.5%",
  p_value: "0.03",
  guardrail: "误判率 +1.8%，投诉率 +0.4%"
};

export function renderAbReadoutTask({ taskRoot, onComplete, store }) {
  const state = {
    result: DEFAULT_RESULT,
    decision: "",
    reason: "",
    err: ""
  };

  function render() {
    const aiAvailable = Boolean(store?.get?.().roleplay?.health?.ok);
    taskRoot.innerHTML = `
      <div class="card">
        <div class="k">Step 1: 查看 A/B 结果摘要</div>
        <div class="v">
          <div class="pill">主指标</div>
          <div style="margin-top:6px">${state.result.primary_metric}：提升 ${state.result.lift}（p=${state.result.p_value}）</div>
          <div class="pill" style="margin-top:10px">护栏指标</div>
          <div style="margin-top:6px">${state.result.guardrail}</div>
          <div class="row" style="margin-top:10px">
            <button id="ai-gen" class="btn-primary" ${aiAvailable ? "" : "disabled"}>AI 生成新结果</button>
            <button id="reset">恢复示例</button>
          </div>
          ${aiAvailable ? "" : `<div class="inline-note" style="margin-top:8px">当前为离线模式，AI 增强不可用，但不影响主流程完成。</div>`}
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 2: 做出决策并写一句理由</div>
        <div class="v">
          <div style="display:grid; gap:8px">
            ${DECISIONS.map(
              (d) => `
                <label>
                  <input type="radio" name="decision" value="${d.id}" ${state.decision === d.id ? "checked" : ""}/>
                  <span>${d.label}</span>
                </label>
              `
            ).join("")}
          </div>
          <textarea id="reason" style="margin-top:8px" placeholder="示例：主指标显著提升，但护栏变差，选择分人群上线并继续优化。">${state.reason}</textarea>
          <div class="row" style="margin-top:10px">
            <button id="submit" class="btn-primary">提交实验结论</button>
            <button id="auto" title="仅用于快速体验">快速填充</button>
          </div>
          ${state.err ? `<div class="error">${state.err}</div>` : ""}
        </div>
      </div>
    `;

    for (const el of taskRoot.querySelectorAll("input[name='decision']")) {
      el.addEventListener("change", () => {
        state.decision = el.value;
        state.err = "";
      });
    }
    taskRoot.querySelector("#reason")?.addEventListener("input", (e) => {
      state.reason = e.target.value;
      state.err = "";
    });
    taskRoot.querySelector("#auto")?.addEventListener("click", () => {
      state.decision = "segment";
      state.reason = "主指标提升显著但护栏恶化，先在高质量用户中上线并继续观察。";
      render();
    });
    taskRoot.querySelector("#reset")?.addEventListener("click", () => {
      state.result = DEFAULT_RESULT;
      render();
    });
    taskRoot.querySelector("#ai-gen")?.addEventListener("click", generateAiResult);
    taskRoot.querySelector("#submit")?.addEventListener("click", submitDeliverable);
  }

  async function generateAiResult() {
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ab_result_sample", payload: {} })
      });
      const text = await res.text();
      const json = safeJson(text);
      if (!res.ok) {
        const msg = json?.error || "AI 服务不可用";
        throw new Error(msg);
      }
      const result = json?.result?.json?.ab_result || json?.result?.json || json?.result?.text;
      if (result?.primary_metric) {
        state.result = result;
        state.err = "";
      } else {
        state.err = "AI 返回为空，已保留示例结果。";
      }
      render();
    } catch (err) {
      state.err = `AI 结果生成失败：${String(err?.message || err)}`;
      render();
    }
  }

  function validate() {
    if (!state.decision) return "请选择一个决策。";
    if ((state.reason ?? "").trim().length < 10) return "请写一句更完整的理由。";
    return "";
  }

  function submitDeliverable() {
    state.err = validate();
    if (state.err) return render();
    const delta = { efficiency: 0, accuracy: 0, ux: 0, cost: 0, risk: 0 };
    const decision = DECISIONS.find((d) => d.id === state.decision);
    for (const [k, v] of Object.entries(decision?.delta ?? {})) delta[k] += v;
    if (state.result.guardrail?.includes("+")) delta.risk += 0.02;

    onComplete({
      deliverable: {
        type: "ab_test_readout",
        title: "A/B 结果解读与决策",
        brief: `决策: ${decision?.label ?? state.decision}`,
        data: {
          result: state.result,
          decision: state.decision,
          reason: state.reason.trim()
        }
      },
      delta
    });
  }

  render();
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
