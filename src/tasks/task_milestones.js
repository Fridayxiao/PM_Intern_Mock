const MILESTONES = [
  { id: "scope", label: "MVP 范围与成功指标" },
  { id: "data_audit", label: "数据质量检查与样本策略" },
  { id: "solution", label: "方案评审（规则/模型/人审）" },
  { id: "gray", label: "灰度计划与回滚策略" },
  { id: "metrics", label: "埋点与看板（口径对齐）" },
  { id: "comms", label: "对外说明/FAQ/信任表达" }
];

const RISKS = [
  { id: "low_conf", label: "低置信度允许拒答或转人工", delta: { risk: -0.12, accuracy: +0.06 } },
  { id: "quality_gate", label: "上传质量门槛（示例+检测）", delta: { accuracy: +0.1, efficiency: +0.05 } },
  { id: "gray_limit", label: "灰度人群限制 + 回滚开关", delta: { risk: -0.08, cost: +0.04 } },
  { id: "copy_bound", label: "文案明确边界与不确定性", delta: { ux: +0.08, risk: -0.06 } }
];

export function renderMilestoneTask({ taskRoot, onComplete }) {
  const state = {
    order: MILESTONES.map((m) => m.id),
    risks: new Set(),
    timeline: "",
    err: ""
  };

  function render() {
    taskRoot.innerHTML = `
      <div class="card">
        <div class="k">Step 1: 排序里程碑（1=最优先）</div>
        <div class="v" style="margin-top:8px">
          <div id="milestone-list" style="display:grid; gap:8px">
            ${state.order
              .map((id, idx) => {
                const item = MILESTONES.find((m) => m.id === id);
                return `
                  <div class="choice" draggable="true" data-rank="${id}" style="display:flex; gap:10px; align-items:center">
                    <span class="pill">#${idx + 1}</span>
                    <div style="flex:1">${item?.label ?? id}</div>
                    <div style="display:flex; gap:8px">
                      <button data-up="${id}" ${idx === 0 ? "disabled" : ""}>上移</button>
                      <button data-down="${id}" ${idx === state.order.length - 1 ? "disabled" : ""}>下移</button>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 2: 选择风险边界（至少 2 个）</div>
        <div class="v" style="margin-top:10px; display:grid; gap:8px">
          ${RISKS.map(
            (r) => `
              <label>
                <input type="checkbox" data-risk="${r.id}" ${state.risks.has(r.id) ? "checked" : ""}/>
                <span>${r.label}</span>
              </label>
            `
          ).join("")}
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 3: 两周内里程碑时间线（简要）</div>
        <div class="v">
          <textarea id="timeline" placeholder="示例：第 1 周完成数据审计+MVP范围；第 2 周完成灰度与回滚预案。">${state.timeline}</textarea>
          <div class="row" style="margin-top:10px">
            <button id="submit" class="btn-primary">提交里程碑计划</button>
            <button id="auto" title="仅用于快速体验">快速填充</button>
          </div>
          ${state.err ? `<div class="error">${state.err}</div>` : ""}
        </div>
      </div>
    `;

    for (const el of taskRoot.querySelectorAll("[data-up]")) {
      el.addEventListener("click", () => move(el.getAttribute("data-up"), -1));
    }
    for (const el of taskRoot.querySelectorAll("[data-down]")) {
      el.addEventListener("click", () => move(el.getAttribute("data-down"), +1));
    }
    const list = taskRoot.querySelector("#milestone-list");
    if (list) wireDragRank(list);

    for (const el of taskRoot.querySelectorAll("input[type='checkbox'][data-risk]")) {
      el.addEventListener("change", () => {
        const id = el.getAttribute("data-risk");
        if (el.checked) state.risks.add(id);
        else state.risks.delete(id);
        state.err = "";
      });
    }

    const timeline = taskRoot.querySelector("#timeline");
    if (timeline) {
      timeline.addEventListener("input", () => {
        state.timeline = timeline.value;
        state.err = "";
      });
    }

    taskRoot.querySelector("#auto")?.addEventListener("click", () => {
      state.order = ["scope", "metrics", "data_audit", "solution", "gray", "comms"];
      state.risks = new Set(["low_conf", "quality_gate"]);
      state.timeline = "第 1 周：明确范围与指标、完成数据审计；第 2 周：灰度上线与回滚预案。";
      render();
    });

    taskRoot.querySelector("#submit")?.addEventListener("click", submitDeliverable);
  }

  function move(id, dir) {
    if (!id) return;
    const idx = state.order.indexOf(id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= state.order.length) return;
    const copy = state.order.slice();
    copy.splice(idx, 1);
    copy.splice(next, 0, id);
    state.order = copy;
    render();
  }

  function wireDragRank(listEl) {
    let dragId = null;
    listEl.querySelectorAll("[data-rank]").forEach((item) => {
      item.addEventListener("dragstart", (e) => {
        dragId = item.getAttribute("data-rank");
        e.dataTransfer?.setData("text/plain", dragId ?? "");
      });
      item.addEventListener("dragover", (e) => e.preventDefault());
      item.addEventListener("drop", (e) => {
        e.preventDefault();
        const targetId = item.getAttribute("data-rank");
        if (!dragId || !targetId || dragId === targetId) return;
        const from = state.order.indexOf(dragId);
        const to = state.order.indexOf(targetId);
        if (from < 0 || to < 0) return;
        state.order.splice(from, 1);
        state.order.splice(to, 0, dragId);
        render();
      });
    });
  }

  function validate() {
    if (state.risks.size < 2) return "请至少选择 2 个风险边界。";
    if ((state.timeline ?? "").trim().length < 12) return "请写一句更具体的时间线描述。";
    return "";
  }

  function submitDeliverable() {
    state.err = validate();
    if (state.err) return render();

    const delta = { efficiency: 0, accuracy: 0, ux: 0, cost: 0, risk: 0 };
    if (state.order.indexOf("metrics") <= 1) delta.risk -= 0.05;
    if (state.order.indexOf("gray") <= 2) delta.risk -= 0.05;
    if (state.order.indexOf("data_audit") <= 2) delta.accuracy += 0.06;

    for (const id of state.risks) {
      const item = RISKS.find((r) => r.id === id);
      for (const [k, v] of Object.entries(item?.delta ?? {})) delta[k] += v;
    }

    onComplete({
      deliverable: {
        type: "milestone_plan",
        title: "MVP 里程碑与风险边界",
        brief: "完成里程碑排序与风险边界选择",
        data: {
          order: state.order,
          risks: [...state.risks],
          timeline: state.timeline.trim()
        }
      },
      delta
    });
  }

  render();
}

