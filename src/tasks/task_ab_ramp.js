const STAGES = [
  {
    id: "5",
    label: "5% 灰度",
    primary: "+2.1%",
    guardrail: "+0.2%",
    p95: "420ms"
  },
  {
    id: "20",
    label: "20% 灰度",
    primary: "+4.8%",
    guardrail: "+1.6%",
    p95: "610ms"
  },
  {
    id: "50",
    label: "50% 灰度",
    primary: "+5.2%",
    guardrail: "+2.4%",
    p95: "880ms"
  }
];

const DECISIONS = [
  { id: "go", label: "继续放量", delta: { efficiency: +0.04, risk: +0.01 } },
  { id: "hold", label: "停留观察", delta: { risk: -0.02 } },
  { id: "rollback", label: "回滚", delta: { risk: -0.05, ux: +0.02 } }
];

export function renderAbRampTask({ taskRoot, onComplete }) {
  const state = {
    stageIndex: 0,
    decisions: [],
    err: ""
  };

  function render() {
    const stage = STAGES[state.stageIndex];
    taskRoot.innerHTML = `
      <div class="card">
        <div class="k">Step 1: 查看放量阶段数据</div>
        <div class="v">
          <div class="pill">${stage.label}</div>
          <div style="margin-top:6px; font-family: var(--mono); font-size:12px">
            主指标: ${stage.primary}<br/>
            护栏变化: ${stage.guardrail}<br/>
            P95 时延: ${stage.p95}
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 2: 选择决策</div>
        <div class="v">
          <div style="display:grid; gap:8px">
            ${DECISIONS.map(
              (d) => `
                <label>
                  <input type="radio" name="decision" value="${d.id}"/>
                  <span>${d.label}</span>
                </label>
              `
            ).join("")}
          </div>
          <div class="row" style="margin-top:10px">
            <button id="submit" class="btn-primary">确认决策</button>
            <button id="auto" title="仅用于快速体验">快速填充</button>
          </div>
          ${state.err ? `<div class="error">${state.err}</div>` : ""}
        </div>
      </div>

      <div class="inline-note" style="margin-top:10px">
        提示：护栏持续恶化时，继续放量可能扩大风险；可以选择“停留观察”或“回滚”。
      </div>
    `;

    taskRoot.querySelector("#auto")?.addEventListener("click", () => {
      const defaultDecision = stage.id === "5" ? "go" : stage.id === "20" ? "hold" : "rollback";
      const el = taskRoot.querySelector(`input[value='${defaultDecision}']`);
      if (el) el.checked = true;
    });
    taskRoot.querySelector("#submit")?.addEventListener("click", submitDecision);
  }

  function submitDecision() {
    const picked = taskRoot.querySelector("input[name='decision']:checked")?.value;
    if (!picked) {
      state.err = "请选择一个决策。";
      return render();
    }
    state.decisions.push({ stage: STAGES[state.stageIndex].id, decision: picked });
    state.err = "";

    if (state.stageIndex < STAGES.length - 1) {
      state.stageIndex += 1;
      return render();
    }

    const delta = { efficiency: 0, accuracy: 0, ux: 0, cost: 0, risk: 0 };
    for (const d of state.decisions) {
      const meta = DECISIONS.find((x) => x.id === d.decision);
      for (const [k, v] of Object.entries(meta?.delta ?? {})) delta[k] += v;
    }

    onComplete({
      deliverable: {
        type: "ab_ramp",
        title: "分阶段放量决策",
        brief: `阶段数: ${state.decisions.length}`,
        data: { decisions: state.decisions }
      },
      delta
    });
  }

  render();
}

