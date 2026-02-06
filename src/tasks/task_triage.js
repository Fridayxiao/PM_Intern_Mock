const BUCKETS = [
  { id: "data", name: "数据" },
  { id: "model", name: "模型" },
  { id: "ux", name: "交互" },
  { id: "ops", name: "运营" },
  { id: "copy", name: "文案" },
  { id: "system", name: "系统" }
];

const FEEDBACKS = [
  { id: "f1", text: "我拍得很清楚，怎么还是说不确定？", ok: ["model", "copy", "ux"] },
  { id: "f2", text: "上传一步老失败，提示也看不懂。", ok: ["ux", "system", "copy"] },
  { id: "f3", text: "等了很久没消息，以为卡死了。", ok: ["ux", "system"] },
  { id: "f4", text: "报告看不懂，为什么是这个品种？", ok: ["ux", "copy", "model"] },
  { id: "f5", text: "结果错得离谱，我怀疑你们不专业。", ok: ["model", "data", "ux"] },
  { id: "f6", text: "图片太糊也能提交，浪费时间。", ok: ["data", "ux"] },
  { id: "f7", text: "客服说找不到我的订单记录。", ok: ["system"] },
  { id: "f8", text: "评分入口太隐蔽，想反馈找不到。", ok: ["ux", "ops"] },
  { id: "f9", text: "推送太频繁，反而烦。", ok: ["ops", "ux"] },
  { id: "f10", text: "某些冷门品种总是被识别错。", ok: ["data", "model"] },
  { id: "f11", text: "报告里有些话术像营销，不可信。", ok: ["copy", "ux"] },
  { id: "f12", text: "高峰期提交后一直转圈圈。", ok: ["system", "ops"] }
];

const IMPROVEMENTS = [
  { id: "quality_gate", label: "增加图像质量检测与示例引导", delta: { accuracy: +0.12, efficiency: +0.08, ux: +0.06 } },
  { id: "progress_nodes", label: "增加进度节点通知与 SLA 说明", delta: { ux: +0.12, risk: -0.03 } },
  { id: "explain_report", label: "优化报告解释与不确定性表达", delta: { ux: +0.1, risk: -0.05 } },
  { id: "low_conf_review", label: "低置信度触发人工复核", delta: { accuracy: +0.12, cost: +0.12, risk: -0.03 } },
  { id: "feedback_entry", label: "统一反馈入口+标签化收集", delta: { efficiency: +0.06, ux: +0.06 } },
  { id: "peak_scaling", label: "高峰期限流/排队与弹性扩容策略", delta: { efficiency: +0.12, cost: +0.1, ux: +0.06 } }
];

function scoreAssignments(assignments) {
  let okCount = 0;
  for (const f of FEEDBACKS) {
    const pick = assignments[f.id];
    if (!pick) continue;
    if (f.ok.includes(pick)) okCount += 1;
  }
  return okCount / FEEDBACKS.length;
}

export function renderTriageTask({ taskRoot, onComplete }) {
  const state = {
    assign: {},
    improvements: new Set(),
    err: ""
  };

  function render() {
    taskRoot.innerHTML = `
      <div class="card">
        <div class="k">Step 1: triage 反馈（为每条反馈选归因桶）</div>
        <div class="v" style="margin-top:10px; display:grid; gap:10px">
          ${FEEDBACKS.map((f) => renderFeedbackRow(f)).join("")}
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 2: 选 2 个改动进入下一迭代</div>
        <div class="v" style="margin-top:10px; display:grid; gap:8px">
          ${IMPROVEMENTS.map(
            (x) => `
              <label>
                <input type="checkbox" data-imp="${x.id}" ${state.improvements.has(x.id) ? "checked" : ""} ${state.improvements.size >= 2 && !state.improvements.has(x.id) ? "disabled" : ""}/>
                <span>${x.label}</span>
              </label>
            `
          ).join("")}
          <div class="row" style="margin-top:10px">
            <button id="submit" class="btn-primary">提交闭环方案</button>
            <button id="auto" title="仅用于快速体验">快速填充</button>
          </div>
          ${state.err ? `<div class="error">${state.err}</div>` : ""}
        </div>
      </div>
    `;

    for (const el of taskRoot.querySelectorAll("select[data-assign]")) {
      el.addEventListener("change", () => {
        const id = el.getAttribute("data-assign");
        state.assign[id] = el.value;
        state.err = "";
      });
    }

    for (const el of taskRoot.querySelectorAll("input[type='checkbox'][data-imp]")) {
      el.addEventListener("change", () => {
        const id = el.getAttribute("data-imp");
        if (el.checked) state.improvements.add(id);
        else state.improvements.delete(id);
        state.err = "";
        render();
      });
    }

    taskRoot.querySelector("#auto")?.addEventListener("click", () => {
      state.assign = {
        f1: "model",
        f2: "ux",
        f3: "ux",
        f4: "copy",
        f5: "model",
        f6: "data",
        f7: "system",
        f8: "ux",
        f9: "ops",
        f10: "data",
        f11: "copy",
        f12: "system"
      };
      state.improvements = new Set(["progress_nodes", "quality_gate"]);
      render();
    });

    taskRoot.querySelector("#submit")?.addEventListener("click", submitDeliverable);
  }

  function renderFeedbackRow(f) {
    const v = state.assign[f.id] ?? "";
    return `
      <div class="card">
        <div class="row" style="align-items:flex-start">
          <div style="flex: 2.2">
            <div class="pill">${f.id}</div>
            <div style="margin-top:8px; color: rgba(255,255,255,0.9); line-height:1.6">${f.text}</div>
          </div>
          <div style="flex: 1">
            <div class="pill">归因</div>
            <select data-assign="${f.id}" style="margin-top:8px">
              <option value="" ${v === "" ? "selected" : ""}>请选择</option>
              ${BUCKETS.map((b) => `<option value="${b.id}" ${v === b.id ? "selected" : ""}>${b.name}</option>`).join("")}
            </select>
          </div>
        </div>
      </div>
    `;
  }

  function validate() {
    for (const f of FEEDBACKS) {
      if (!state.assign[f.id]) return `请完成 triage：${f.id}`;
    }
    if (state.improvements.size !== 2) return "请选择 2 个改动进入下一迭代。";
    return "";
  }

  function submitDeliverable() {
    state.err = validate();
    if (state.err) return render();

    const triageScore = scoreAssignments(state.assign);
    const delta = { efficiency: 0, accuracy: 0, ux: 0, cost: 0, risk: 0 };
    for (const id of state.improvements) {
      const imp = IMPROVEMENTS.find((x) => x.id === id);
      for (const [k, v] of Object.entries(imp?.delta ?? {})) delta[k] += v;
    }
    delta.efficiency += triageScore * 0.1;
    delta.risk += (1 - triageScore) * 0.08;

    onComplete({
      deliverable: {
        type: "triage_loop",
        title: "灰度反馈 Triage + 迭代闭环方案",
        brief: `triage 完整度: ${(triageScore * 100).toFixed(0)}%，迭代项: 2`,
        data: {
          assignments: state.assign,
          improvements: [...state.improvements]
        }
      },
      delta
    });
  }

  render();
}
