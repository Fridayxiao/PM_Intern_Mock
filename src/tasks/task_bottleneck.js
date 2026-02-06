const BOTTLENECKS = [
  {
    id: "entry",
    label: "入口难找 / 不知道去哪里开始",
    delta: { ux: +0.08, efficiency: +0.04 }
  },
  {
    id: "upload",
    label: "上传步骤复杂 / 图片质量不达标",
    delta: { accuracy: +0.08, efficiency: +0.05 }
  },
  {
    id: "wait",
    label: "等待时间长 / 缺乏进度反馈",
    delta: { ux: +0.1, risk: -0.02 }
  },
  {
    id: "trust",
    label: "结果不可信 / 解释不清晰",
    delta: { ux: +0.1, risk: -0.05 }
  }
];

const METRICS = [
  { id: "time_to_result", label: "从提交到结果的中位时长" },
  { id: "valid_submit_rate", label: "有效提交率（质量门槛通过）" },
  { id: "completion_rate", label: "提交→结果完成率" },
  { id: "trust_score", label: "结果信任评分/满意度" }
];

export function renderBottleneckTask({ taskRoot, onComplete }) {
  const state = {
    pick: "",
    metric: "",
    hypothesis: "",
    err: ""
  };

  function render() {
    taskRoot.innerHTML = `
      <div class="card">
        <div class="k">Step 1: 选择当前最关键的转化瓶颈</div>
        <div class="v" style="margin-top:8px; display:grid; gap:8px">
          ${BOTTLENECKS.map(
            (b) => `
              <label>
                <input type="radio" name="bottleneck" value="${b.id}" ${state.pick === b.id ? "checked" : ""}/>
                <span>${b.label}</span>
              </label>
            `
          ).join("")}
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 2: 写出验证假设 + 指标</div>
        <div class="v">
          <select id="metric" style="margin-bottom:8px">
            <option value="">选择验证指标</option>
            ${METRICS.map((m) => `<option value="${m.id}" ${state.metric === m.id ? "selected" : ""}>${m.label}</option>`).join("")}
          </select>
          <textarea id="hypo" placeholder="示例：如果把入口放到首页首屏，用户进入鉴别的比例会提升。">${state.hypothesis}</textarea>
          <div class="row" style="margin-top:10px">
            <button id="submit" class="btn-primary">提交瓶颈假设</button>
            <button id="auto" title="仅用于快速体验">快速填充</button>
          </div>
          ${state.err ? `<div class="error">${state.err}</div>` : ""}
        </div>
      </div>
    `;

    for (const el of taskRoot.querySelectorAll("input[name='bottleneck']")) {
      el.addEventListener("change", () => {
        state.pick = el.value;
        state.err = "";
      });
    }

    const metric = taskRoot.querySelector("#metric");
    if (metric) {
      metric.addEventListener("change", () => {
        state.metric = metric.value;
        state.err = "";
      });
    }

    const hypo = taskRoot.querySelector("#hypo");
    if (hypo) {
      hypo.addEventListener("input", () => {
        state.hypothesis = hypo.value;
        state.err = "";
      });
    }

    taskRoot.querySelector("#auto")?.addEventListener("click", () => {
      state.pick = "wait";
      state.metric = "time_to_result";
      state.hypothesis = "如果增加进度节点通知，用户等待感知将下降，完成率会提升。";
      render();
    });

    taskRoot.querySelector("#submit")?.addEventListener("click", submitDeliverable);
  }

  function validate() {
    if (!state.pick) return "请选择一个瓶颈。";
    if (!state.metric) return "请选择一个验证指标。";
    if ((state.hypothesis ?? "").trim().length < 14) return "请写一句更完整的假设。";
    return "";
  }

  function submitDeliverable() {
    state.err = validate();
    if (state.err) return render();
    const b = BOTTLENECKS.find((x) => x.id === state.pick);
    onComplete({
      deliverable: {
        type: "bottleneck_hypothesis",
        title: "转化瓶颈假设与验证指标",
        brief: `瓶颈: ${b?.label ?? state.pick}`,
        data: { bottleneck: state.pick, metric: state.metric, hypothesis: state.hypothesis.trim() }
      },
      delta: b?.delta ?? { ux: 0.04 }
    });
  }

  render();
}

