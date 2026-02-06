const CASES = [
  {
    id: "srm",
    title: "疑似 SRM",
    control: { users: 9800, exposure: 9700 },
    treatment: { users: 11250, exposure: 11110 },
    note: "理论 50/50，但样本比例明显偏移。"
  },
  {
    id: "aa_ok",
    title: "A/A 正常",
    control: { users: 10020, exposure: 9980 },
    treatment: { users: 10010, exposure: 9970 },
    note: "样本比例与曝光一致，差异可忽略。"
  }
];

const CAUSES = [
  { id: "random_bug", label: "随机化/分流逻辑 bug" },
  { id: "entry_gap", label: "入口曝光事件漏记" },
  { id: "bot_traffic", label: "异常流量/爬虫" },
  { id: "segment_shift", label: "分群策略错误" }
];

const ACTIONS = [
  { id: "pause", label: "暂停实验并排查分流" },
  { id: "fix_log", label: "补埋点/修复曝光事件" },
  { id: "restart", label: "修复后重启 A/A" },
  { id: "continue", label: "继续实验并观察" }
];

export function renderAbQualityTask({ taskRoot, onComplete }) {
  const state = {
    caseId: "srm",
    cause: "",
    action: "",
    err: ""
  };

  function render() {
    const item = CASES.find((c) => c.id === state.caseId) ?? CASES[0];
    taskRoot.innerHTML = `
      <div class="card">
        <div class="k">Step 1: 查看 A/A + SRM 质检快照</div>
        <div class="v">
          <div class="pill">${item.title}</div>
          <div style="margin-top:8px; font-family: var(--mono); font-size:12px">
            Control users=${item.control.users}, exposure=${item.control.exposure}<br/>
            Treatment users=${item.treatment.users}, exposure=${item.treatment.exposure}
          </div>
          <div style="margin-top:6px; color: rgba(255,255,255,0.7)">${item.note}</div>
          <div class="row" style="margin-top:8px">
            <button id="case-srm">切换 SRM 案例</button>
            <button id="case-aa">切换 A/A 正常</button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 2: 选择最可能原因 + 动作</div>
        <div class="v">
          <select id="cause" style="margin-bottom:8px">
            <option value="">选择原因</option>
            ${CAUSES.map((c) => `<option value="${c.id}" ${state.cause === c.id ? "selected" : ""}>${c.label}</option>`).join("")}
          </select>
          <select id="action">
            <option value="">选择动作</option>
            ${ACTIONS.map((a) => `<option value="${a.id}" ${state.action === a.id ? "selected" : ""}>${a.label}</option>`).join("")}
          </select>
          <div class="row" style="margin-top:10px">
            <button id="submit" class="btn-primary">提交质检结论</button>
            <button id="auto" title="仅用于快速体验">快速填充</button>
          </div>
          ${state.err ? `<div class="error">${state.err}</div>` : ""}
        </div>
      </div>
    `;

    taskRoot.querySelector("#case-srm")?.addEventListener("click", () => {
      state.caseId = "srm";
      render();
    });
    taskRoot.querySelector("#case-aa")?.addEventListener("click", () => {
      state.caseId = "aa_ok";
      render();
    });
    taskRoot.querySelector("#cause")?.addEventListener("change", (e) => {
      state.cause = e.target.value;
      state.err = "";
    });
    taskRoot.querySelector("#action")?.addEventListener("change", (e) => {
      state.action = e.target.value;
      state.err = "";
    });
    taskRoot.querySelector("#auto")?.addEventListener("click", () => {
      state.caseId = "srm";
      state.cause = "random_bug";
      state.action = "pause";
      render();
    });
    taskRoot.querySelector("#submit")?.addEventListener("click", submitDeliverable);
  }

  function validate() {
    if (!state.cause) return "请选择原因。";
    if (!state.action) return "请选择动作。";
    return "";
  }

  function submitDeliverable() {
    state.err = validate();
    if (state.err) return render();
    const delta = { efficiency: 0, accuracy: 0, ux: 0, cost: 0, risk: 0 };
    if (state.caseId === "srm" && (state.action === "pause" || state.action === "fix_log")) delta.risk -= 0.06;
    if (state.caseId === "aa_ok" && state.action === "continue") delta.efficiency += 0.04;
    onComplete({
      deliverable: {
        type: "ab_quality",
        title: "A/A + SRM 质检结论",
        brief: `${state.caseId} / ${state.cause} / ${state.action}`,
        data: { caseId: state.caseId, cause: state.cause, action: state.action }
      },
      delta
    });
  }

  render();
}

