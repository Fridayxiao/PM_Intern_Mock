const EXPOSURE = [
  { id: "entry_view", label: "入口曝光（entry_view）" },
  { id: "module_open", label: "进入模块（module_open）" },
  { id: "submit_order", label: "提交鉴别（submit_order）" }
];

const WINDOWS = [
  { id: "24h", label: "24 小时内" },
  { id: "72h", label: "72 小时内" },
  { id: "7d", label: "7 天内" }
];

const DENOMINATORS = [
  { id: "exposed_users", label: "曝光用户" },
  { id: "submit_users", label: "提交用户" },
  { id: "valid_submit_users", label: "有效提交用户" }
];

const GAPS = [
  { id: "missing_exposure", label: "曝光事件缺失或采集不稳定" },
  { id: "no_device", label: "缺少设备/版本字段" },
  { id: "no_latency", label: "缺少时延/排队字段" },
  { id: "no_quality", label: "缺少图片质量字段" }
];

export function renderAbInstrumentationTask({ taskRoot, onComplete }) {
  const state = {
    exposure: "",
    window: "",
    denominator: "",
    gaps: new Set(),
    err: ""
  };

  function render() {
    taskRoot.innerHTML = `
      <div class="card">
        <div class="k">Step 1: 选择曝光事件（Exposure）</div>
        <div class="v">
          <select id="exposure">
            <option value="">选择曝光事件</option>
            ${EXPOSURE.map((m) => `<option value="${m.id}" ${state.exposure === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 2: 指标口径（时间窗 + 分母）</div>
        <div class="v">
          <select id="window" style="margin-bottom:8px">
            <option value="">选择时间窗</option>
            ${WINDOWS.map((m) => `<option value="${m.id}" ${state.window === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
          </select>
          <select id="denom">
            <option value="">选择分母</option>
            ${DENOMINATORS.map((m) => `<option value="${m.id}" ${state.denominator === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 3: 埋点缺口排查（至少 2 项）</div>
        <div class="v" style="margin-top:6px; display:grid; gap:8px">
          ${GAPS.map(
            (g) => `
              <label>
                <input type="checkbox" data-gap="${g.id}" ${state.gaps.has(g.id) ? "checked" : ""} ${state.gaps.size >= 2 && !state.gaps.has(g.id) ? "disabled" : ""}/>
                <span>${g.label}</span>
              </label>
            `
          ).join("")}
          <div class="row" style="margin-top:10px">
            <button id="submit" class="btn-primary">提交埋点与口径</button>
            <button id="auto" title="仅用于快速体验">快速填充</button>
          </div>
          ${state.err ? `<div class="error">${state.err}</div>` : ""}
        </div>
      </div>
    `;

    taskRoot.querySelector("#exposure")?.addEventListener("change", (e) => {
      state.exposure = e.target.value;
      state.err = "";
    });
    taskRoot.querySelector("#window")?.addEventListener("change", (e) => {
      state.window = e.target.value;
      state.err = "";
    });
    taskRoot.querySelector("#denom")?.addEventListener("change", (e) => {
      state.denominator = e.target.value;
      state.err = "";
    });
    for (const el of taskRoot.querySelectorAll("[data-gap]")) {
      el.addEventListener("change", () => {
        const id = el.getAttribute("data-gap");
        if (el.checked) state.gaps.add(id);
        else state.gaps.delete(id);
        state.err = "";
        render();
      });
    }
    taskRoot.querySelector("#auto")?.addEventListener("click", () => {
      state.exposure = "module_open";
      state.window = "72h";
      state.denominator = "exposed_users";
      state.gaps = new Set(["missing_exposure", "no_latency"]);
      render();
    });
    taskRoot.querySelector("#submit")?.addEventListener("click", submitDeliverable);
  }

  function validate() {
    if (!state.exposure) return "请选择曝光事件。";
    if (!state.window) return "请选择时间窗。";
    if (!state.denominator) return "请选择分母。";
    if (state.gaps.size < 2) return "请至少选择 2 项埋点缺口。";
    return "";
  }

  function submitDeliverable() {
    state.err = validate();
    if (state.err) return render();
    onComplete({
      deliverable: {
        type: "ab_instrumentation",
        title: "埋点与口径定义",
        brief: `曝光事件: ${state.exposure}，分母: ${state.denominator}`,
        data: {
          exposure: state.exposure,
          window: state.window,
          denominator: state.denominator,
          gaps: [...state.gaps]
        }
      },
      delta: { risk: -0.03, accuracy: +0.04 }
    });
  }

  render();
}

