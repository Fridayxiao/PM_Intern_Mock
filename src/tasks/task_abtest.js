const CHANGES = [
  { id: "entry", label: "入口位置：从二级页移到首页首屏" },
  { id: "trust_card", label: "展示鉴别师资质与边界说明" },
  { id: "progress", label: "增加进度节点通知" },
  { id: "quality_gate", label: "增加上传质量门槛" }
];

const METRICS = [
  { id: "completion_rate", label: "完成率（提交→结果）" },
  { id: "time_to_result", label: "中位完成时长" },
  { id: "valid_submit_rate", label: "有效提交率" },
  { id: "trust_score", label: "信任评分/满意度" }
];

const GUARDRAILS = [
  { id: "complaint_rate", label: "投诉率" },
  { id: "false_positive", label: "误判率" },
  { id: "cost_per_order", label: "单笔成本" },
  { id: "latency_p95", label: "P95时延" }
];

const SAMPLE = [
  { id: "small", label: "小样本（5-10% 流量）", delta: { cost: +0.02 } },
  { id: "medium", label: "中样本（20-30% 流量）", delta: { cost: +0.05 } },
  { id: "large", label: "大样本（50%+ 流量）", delta: { cost: +0.08 } }
];

const DURATION = [
  { id: "3d", label: "3 天", delta: { efficiency: +0.03 } },
  { id: "7d", label: "7 天", delta: { risk: -0.03 } },
  { id: "14d", label: "14 天", delta: { risk: -0.05 } }
];

export function renderAbTestTask({ taskRoot, onComplete }) {
  const state = {
    change: "",
    metric: "",
    guardrail: "",
    sample: "",
    duration: "",
    hypothesis: "",
    err: ""
  };

  function render() {
    taskRoot.innerHTML = `
      <div class="card">
        <div class="k">Step 1: 选择实验变量</div>
        <div class="v" style="margin-top:8px; display:grid; gap:8px">
          ${CHANGES.map(
            (c) => `
              <label>
                <input type="radio" name="change" value="${c.id}" ${state.change === c.id ? "checked" : ""}/>
                <span>${c.label}</span>
              </label>
            `
          ).join("")}
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 2: 设定主指标与护栏指标</div>
        <div class="v">
          <select id="metric" style="margin-bottom:8px">
            <option value="">选择主指标</option>
            ${METRICS.map((m) => `<option value="${m.id}" ${state.metric === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
          </select>
          <select id="guardrail" style="margin-bottom:8px">
            <option value="">选择护栏指标</option>
            ${GUARDRAILS.map((m) => `<option value="${m.id}" ${state.guardrail === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
          </select>
          <select id="sample" style="margin-bottom:8px">
            <option value="">选择流量样本</option>
            ${SAMPLE.map((s) => `<option value="${s.id}" ${state.sample === s.id ? "selected" : ""}>${s.label}</option>`).join("")}
          </select>
          <select id="duration">
            <option value="">选择实验周期</option>
            ${DURATION.map((d) => `<option value="${d.id}" ${state.duration === d.id ? "selected" : ""}>${d.label}</option>`).join("")}
          </select>
          <textarea id="hypothesis" style="margin-top:8px" placeholder="一句话假设：如果...那么...因为...">${state.hypothesis}</textarea>
          <div class="row" style="margin-top:10px">
            <button id="submit" class="btn-primary">提交 A/B 设计</button>
            <button id="auto" title="仅用于快速体验">快速填充</button>
          </div>
          ${state.err ? `<div class="error">${state.err}</div>` : ""}
        </div>
      </div>
    `;

    for (const el of taskRoot.querySelectorAll("input[name='change']")) {
      el.addEventListener("change", () => {
        state.change = el.value;
        state.err = "";
      });
    }

    taskRoot.querySelector("#metric")?.addEventListener("change", (e) => {
      state.metric = e.target.value;
      state.err = "";
    });
    taskRoot.querySelector("#guardrail")?.addEventListener("change", (e) => {
      state.guardrail = e.target.value;
      state.err = "";
    });
    taskRoot.querySelector("#sample")?.addEventListener("change", (e) => {
      state.sample = e.target.value;
      state.err = "";
    });
    taskRoot.querySelector("#duration")?.addEventListener("change", (e) => {
      state.duration = e.target.value;
      state.err = "";
    });
    taskRoot.querySelector("#hypothesis")?.addEventListener("input", (e) => {
      state.hypothesis = e.target.value;
      state.err = "";
    });

    taskRoot.querySelector("#auto")?.addEventListener("click", () => {
      state.change = "progress";
      state.metric = "completion_rate";
      state.guardrail = "complaint_rate";
      state.sample = "medium";
      state.duration = "7d";
      state.hypothesis = "如果增加进度节点通知，那么完成率会提升，因为用户等待焦虑降低。";
      render();
    });

    taskRoot.querySelector("#submit")?.addEventListener("click", submitDeliverable);
  }

  function validate() {
    if (!state.change) return "请选择实验变量。";
    if (!state.metric) return "请选择主指标。";
    if (!state.guardrail) return "请选择护栏指标。";
    if (!state.sample) return "请选择样本流量。";
    if (!state.duration) return "请选择实验周期。";
    if ((state.hypothesis ?? "").trim().length < 10) return "请写一句明确的实验假设。";
    return "";
  }

  function submitDeliverable() {
    state.err = validate();
    if (state.err) return render();
    const delta = { efficiency: 0, accuracy: 0, ux: 0, cost: 0, risk: 0 };
    const sample = SAMPLE.find((s) => s.id === state.sample);
    const duration = DURATION.find((d) => d.id === state.duration);
    for (const [k, v] of Object.entries(sample?.delta ?? {})) delta[k] += v;
    for (const [k, v] of Object.entries(duration?.delta ?? {})) delta[k] += v;
    delta.risk -= 0.03;

    onComplete({
      deliverable: {
        type: "ab_test_design",
        title: "A/B 实验设计",
        brief: `变量: ${state.change}，主指标: ${state.metric}，护栏: ${state.guardrail}`,
        data: {
          change: state.change,
          metric: state.metric,
          guardrail: state.guardrail,
          sample: state.sample,
          duration: state.duration,
          hypothesis: state.hypothesis.trim()
        }
      },
      delta
    });
  }

  render();
}
