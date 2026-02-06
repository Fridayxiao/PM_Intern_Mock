const PRIMARY = [
  { id: "completion_rate", label: "完成率（提交→结果）" },
  { id: "time_to_result", label: "中位完成时长" },
  { id: "trust_score", label: "信任评分/满意度" }
];

const GUARDRAIL = [
  { id: "complaint_rate", label: "投诉率" },
  { id: "false_positive", label: "误判率" },
  { id: "cost_per_order", label: "单笔成本" },
  { id: "latency_p95", label: "P95 时延" }
];

const INVARIANTS = [
  { id: "exposure_count", label: "曝光数" },
  { id: "entry_click_rate", label: "入口点击率" },
  { id: "upload_rate", label: "上传触达率" },
  { id: "report_view_rate", label: "报告查看率" }
];

const SEGMENTS = [
  { id: "new_user", label: "新用户" },
  { id: "high_quality", label: "高质量上传用户" },
  { id: "pet_cat", label: "猫类目" },
  { id: "pet_dog", label: "狗类目" }
];

export function renderAbBriefTask({ taskRoot, onComplete }) {
  const state = {
    primary: "",
    guardrail: "",
    invariants: new Set(),
    segments: new Set(),
    hypothesis: "",
    stopCondition: "",
    err: ""
  };

  function render() {
    taskRoot.innerHTML = `
      <div class="card">
        <div class="k">Step 1: 选择主指标 + 护栏指标</div>
        <div class="v">
          <select id="primary" style="margin-bottom:8px">
            <option value="">选择主指标</option>
            ${PRIMARY.map((m) => `<option value="${m.id}" ${state.primary === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
          </select>
          <select id="guardrail" style="margin-bottom:8px">
            <option value="">选择护栏指标</option>
            ${GUARDRAIL.map((m) => `<option value="${m.id}" ${state.guardrail === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 2: 选择 2 个 Invariant（口径一致性）</div>
        <div class="v" style="margin-top:6px; display:grid; gap:8px">
          ${INVARIANTS.map(
            (m) => `
              <label>
                <input type="checkbox" data-inv="${m.id}" ${state.invariants.has(m.id) ? "checked" : ""} ${state.invariants.size >= 2 && !state.invariants.has(m.id) ? "disabled" : ""}/>
                <span>${m.label}</span>
              </label>
            `
          ).join("")}
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 3: 选择 1-2 个分群</div>
        <div class="v" style="margin-top:6px; display:grid; gap:8px">
          ${SEGMENTS.map(
            (m) => `
              <label>
                <input type="checkbox" data-seg="${m.id}" ${state.segments.has(m.id) ? "checked" : ""} ${state.segments.size >= 2 && !state.segments.has(m.id) ? "disabled" : ""}/>
                <span>${m.label}</span>
              </label>
            `
          ).join("")}
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 4: 假设 + Stop 条件</div>
        <div class="v">
          <textarea id="hypothesis" placeholder="一句话假设：如果…那么…因为…">${state.hypothesis}</textarea>
          <input id="stop" class="input" style="margin-top:8px" placeholder="Stop 条件示例：护栏指标上升 > 2% 或 SRM 异常" value="${state.stopCondition}" />
          <div class="row" style="margin-top:10px">
            <button id="submit" class="btn-primary">提交实验 Brief</button>
            <button id="auto" title="仅用于快速体验">快速填充</button>
          </div>
          ${state.err ? `<div class="error">${state.err}</div>` : ""}
        </div>
      </div>
    `;

    taskRoot.querySelector("#primary")?.addEventListener("change", (e) => {
      state.primary = e.target.value;
      state.err = "";
    });
    taskRoot.querySelector("#guardrail")?.addEventListener("change", (e) => {
      state.guardrail = e.target.value;
      state.err = "";
    });
    for (const el of taskRoot.querySelectorAll("[data-inv]")) {
      el.addEventListener("change", () => {
        const id = el.getAttribute("data-inv");
        if (el.checked) state.invariants.add(id);
        else state.invariants.delete(id);
        state.err = "";
        render();
      });
    }
    for (const el of taskRoot.querySelectorAll("[data-seg]")) {
      el.addEventListener("change", () => {
        const id = el.getAttribute("data-seg");
        if (el.checked) state.segments.add(id);
        else state.segments.delete(id);
        state.err = "";
        render();
      });
    }
    taskRoot.querySelector("#hypothesis")?.addEventListener("input", (e) => {
      state.hypothesis = e.target.value;
      state.err = "";
    });
    taskRoot.querySelector("#stop")?.addEventListener("input", (e) => {
      state.stopCondition = e.target.value;
      state.err = "";
    });
    taskRoot.querySelector("#auto")?.addEventListener("click", () => {
      state.primary = "completion_rate";
      state.guardrail = "complaint_rate";
      state.invariants = new Set(["exposure_count", "entry_click_rate"]);
      state.segments = new Set(["new_user"]);
      state.hypothesis = "如果增加进度节点通知，那么完成率提升，因为等待焦虑降低。";
      state.stopCondition = "护栏指标上升 > 2% 或 SRM 异常即暂停。";
      render();
    });
    taskRoot.querySelector("#submit")?.addEventListener("click", submitDeliverable);
  }

  function validate() {
    if (!state.primary) return "请选择主指标。";
    if (!state.guardrail) return "请选择护栏指标。";
    if (state.invariants.size !== 2) return "请选择 2 个 Invariant。";
    if (!state.hypothesis || state.hypothesis.trim().length < 10) return "请写一句明确假设。";
    if (!state.stopCondition || state.stopCondition.trim().length < 8) return "请写 Stop 条件。";
    return "";
  }

  function submitDeliverable() {
    state.err = validate();
    if (state.err) return render();
    onComplete({
      deliverable: {
        type: "ab_brief",
        title: "实验 Brief（指标/假设/Stop 条件）",
        brief: `主指标: ${state.primary}，护栏: ${state.guardrail}`,
        data: {
          primary: state.primary,
          guardrail: state.guardrail,
          invariants: [...state.invariants],
          segments: [...state.segments],
          hypothesis: state.hypothesis.trim(),
          stopCondition: state.stopCondition.trim()
        }
      },
      delta: { risk: -0.04, efficiency: +0.02 }
    });
  }

  render();
}

