const ACTIONS = [
  { id: "progress", label: "进度节点通知（开始/处理中/完成）", delta: { ux: +0.12, risk: -0.03 } },
  { id: "trust", label: "鉴别师资质/模型边界展示", delta: { ux: +0.08, risk: -0.05 } },
  { id: "quality", label: "上传质量检测与示例引导", delta: { accuracy: +0.12, efficiency: +0.05 } },
  { id: "preview", label: "初步报告 + 关键特征解释", delta: { ux: +0.1, accuracy: +0.06 } },
  { id: "appeal", label: "申诉/纠错入口（数据闭环）", delta: { accuracy: +0.08, cost: +0.06 } }
];

const TONES = [
  { id: "authoritative", label: "权威 + 边界明确" },
  { id: "caring", label: "关怀 + 解释清晰" },
  { id: "neutral", label: "中性 + 结构化" }
];

export function renderExperienceTask({ taskRoot, onComplete }) {
  const state = {
    picks: new Set(),
    tone: "",
    copy: "",
    err: ""
  };

  function render() {
    taskRoot.innerHTML = `
      <div class="card">
        <div class="k">Step 1: 选择 2 个体验动作</div>
        <div class="v" style="margin-top:8px; display:grid; gap:8px">
          ${ACTIONS.map(
            (a) => `
              <label>
                <input type="checkbox" data-act="${a.id}" ${state.picks.has(a.id) ? "checked" : ""} ${state.picks.size >= 2 && !state.picks.has(a.id) ? "disabled" : ""}/>
                <span>${a.label}</span>
              </label>
            `
          ).join("")}
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 2: 选择报告语气 + 写一句等待文案</div>
        <div class="v">
          <select id="tone" style="margin-bottom:8px">
            <option value="">选择语气</option>
            ${TONES.map((t) => `<option value="${t.id}" ${state.tone === t.id ? "selected" : ""}>${t.label}</option>`).join("")}
          </select>
          <textarea id="copy" placeholder="示例：鉴别正在进行中，预计 3-5 分钟完成。如结果不确定，我们将给出下一步建议。">${state.copy}</textarea>
          <div class="row" style="margin-top:10px">
            <button id="submit" class="btn-primary">提交体验流设计</button>
            <button id="auto" title="仅用于快速体验">快速填充</button>
          </div>
          ${state.err ? `<div class="error">${state.err}</div>` : ""}
        </div>
      </div>
    `;

    for (const el of taskRoot.querySelectorAll("input[type='checkbox'][data-act]")) {
      el.addEventListener("change", () => {
        const id = el.getAttribute("data-act");
        if (el.checked) state.picks.add(id);
        else state.picks.delete(id);
        state.err = "";
        render();
      });
    }

    const tone = taskRoot.querySelector("#tone");
    if (tone) {
      tone.addEventListener("change", () => {
        state.tone = tone.value;
        state.err = "";
      });
    }

    const copy = taskRoot.querySelector("#copy");
    if (copy) {
      copy.addEventListener("input", () => {
        state.copy = copy.value;
        state.err = "";
      });
    }

    taskRoot.querySelector("#auto")?.addEventListener("click", () => {
      state.picks = new Set(["progress", "quality"]);
      state.tone = "authoritative";
      state.copy = "鉴别处理中，预计 3-5 分钟完成。如结果不确定，将提供下一步建议。";
      render();
    });

    taskRoot.querySelector("#submit")?.addEventListener("click", submitDeliverable);
  }

  function validate() {
    if (state.picks.size !== 2) return "请只选择 2 个体验动作。";
    if (!state.tone) return "请选择报告语气。";
    if ((state.copy ?? "").trim().length < 12) return "请写一句更完整的等待文案。";
    return "";
  }

  function submitDeliverable() {
    state.err = validate();
    if (state.err) return render();

    const delta = { efficiency: 0, accuracy: 0, ux: 0, cost: 0, risk: 0 };
    for (const id of state.picks) {
      const act = ACTIONS.find((x) => x.id === id);
      for (const [k, v] of Object.entries(act?.delta ?? {})) delta[k] += v;
    }
    if (state.tone === "authoritative") delta.risk -= 0.04;
    if (state.tone === "caring") delta.ux += 0.04;

    onComplete({
      deliverable: {
        type: "experience_flow",
        title: "体验流设计（等待+信任）",
        brief: "选择 2 个体验动作并设计等待文案",
        data: { actions: [...state.picks], tone: state.tone, copy: state.copy.trim() }
      },
      delta
    });
  }

  render();
}

