import { clamp01 } from "../util.js";

const DIMENSIONS = [
  { id: "entry", name: "入口可达性", tip: "是否好找、触发路径是否直观" },
  { id: "vertical_fit", name: "垂类适配", tip: "是否对宠物场景做了专门设计" },
  { id: "trust", name: "信任机制", tip: "资质展示、解释性、免责声明等" },
  { id: "explain", name: "结果解释", tip: "结论是否可理解、是否提供下一步动作" },
  { id: "friction", name: "流程摩擦", tip: "强制跳转、广告侵扰、步骤冗余等" }
];

const RATINGS = [
  { id: "better", label: "更强" },
  { id: "same", label: "相当" },
  { id: "worse", label: "更弱" }
];

const IMPROVEMENTS = [
  { id: "deep_link", label: "把入口做深（减少找不到）", delta: { efficiency: +0.1, ux: +0.2 } },
  { id: "trust_cards", label: "增强信任（资质+解释+边界）", delta: { ux: +0.25, risk: -0.05 } },
  { id: "avoid_hard_jump", label: "减少强制跳转/广告干扰", delta: { ux: +0.25, risk: +0.05 } },
  { id: "breed_analysis", label: "输出更可理解的品种关联分析", delta: { ux: +0.2, accuracy: +0.1 } },
  { id: "upload_quality_gate", label: "上传质量门槛+示例引导", delta: { accuracy: +0.2, efficiency: +0.1 } }
];

function scoreMatrix(matrix) {
  let score = 0;
  for (const dim of DIMENSIONS) {
    for (const compId of Object.keys(matrix)) {
      const rating = matrix?.[compId]?.[dim.id];
      if (rating === "worse") score += 1;
      if (rating === "same") score += 0.5;
    }
  }
  return clamp01(score / (DIMENSIONS.length * 2));
}

export function renderCompetitorTask({ taskRoot, scene, onComplete }) {
  const competitors = scene.task.config?.competitors ?? [];
  const state = {
    picked: new Set(),
    matrix: {},
    top3: [...IMPROVEMENTS.map((x) => x.id)],
    conclusion: "",
    err: ""
  };

  function render() {
    const picked = [...state.picked];
    taskRoot.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <div class="k">Step 1: 选 2 个竞品深挖</div>
          <div class="v" style="margin-top:8px; display:grid; gap:8px">
            ${competitors
              .map(
                (c) => `
                  <label>
                    <input type="checkbox" data-pick="${c.id}" ${state.picked.has(c.id) ? "checked" : ""} ${state.picked.size >= 2 && !state.picked.has(c.id) ? "disabled" : ""}/>
                    <span><b>${c.name}</b> <span style="color: rgba(255,255,255,0.65)">- ${c.oneLiner}</span></span>
                  </label>
                `
              )
              .join("")}
          </div>
          <div class="inline-note">提示: Public 版只保留“同构逻辑”，不使用真实公司名或内部数据。</div>
        </div>
        <div class="card">
          <div class="k">Step 2: 输出功能差异矩阵</div>
          <div class="v">
            ${picked.length === 2 ? renderMatrix(picked) : `<div style="color: rgba(255,255,255,0.65)">先选择 2 个竞品。</div>`}
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 3: 排序优先级（拖拽可选）</div>
        <div class="v">
          <div style="color: rgba(255,255,255,0.7); font-size: 12px; line-height: 1.6">
            把 5 个候选优化点按优先级排序。系统会用前 3 个作为你本章的“可复用优化点”产出。
          </div>
          <div id="rank-list" style="margin-top:10px; display:grid; gap:8px">
            ${state.top3
              .map((id, idx) => {
                const item = IMPROVEMENTS.find((x) => x.id === id);
                return `
                  <div class="choice" draggable="true" data-rank="${id}" style="display:flex; gap:10px; align-items:center">
                    <span class="pill">#${idx + 1}</span>
                    <div style="flex:1">${item?.label ?? id}</div>
                    <div style="display:flex; gap:8px">
                      <button data-up="${id}" ${idx === 0 ? "disabled" : ""}>上移</button>
                      <button data-down="${id}" ${idx === state.top3.length - 1 ? "disabled" : ""}>下移</button>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 4: 一句话结论</div>
        <div class="v">
          <textarea id="conclusion" placeholder="用 1 句话写出: 竞品差异 → 你要优先做的 1 个方向 → 为什么。">${state.conclusion}</textarea>
          <div class="row" style="margin-top:10px">
            <button id="submit" class="btn-primary">提交本章交付物</button>
            <button id="auto" title="仅用于快速体验（不会出现在结算摘要里）">快速填充</button>
          </div>
          ${state.err ? `<div class="error">${state.err}</div>` : ""}
        </div>
      </div>
    `;

    for (const el of taskRoot.querySelectorAll("[data-pick]")) {
      el.addEventListener("change", () => {
        const id = el.getAttribute("data-pick");
        if (!id) return;
        if (el.checked) state.picked.add(id);
        else state.picked.delete(id);
        render();
      });
    }

    for (const el of taskRoot.querySelectorAll("select[data-mx]")) {
      el.addEventListener("change", () => {
        const [compId, dimId] = el.getAttribute("data-mx").split(":");
        state.matrix[compId] = state.matrix[compId] ?? {};
        state.matrix[compId][dimId] = el.value;
        state.err = "";
      });
    }

    for (const el of taskRoot.querySelectorAll("[data-up]")) {
      el.addEventListener("click", () => move(el.getAttribute("data-up"), -1));
    }
    for (const el of taskRoot.querySelectorAll("[data-down]")) {
      el.addEventListener("click", () => move(el.getAttribute("data-down"), +1));
    }

    const list = taskRoot.querySelector("#rank-list");
    if (list) wireDragRank(list);

    const conclusion = taskRoot.querySelector("#conclusion");
    if (conclusion) {
      conclusion.addEventListener("input", () => {
        state.conclusion = conclusion.value;
        state.err = "";
      });
    }

    const auto = taskRoot.querySelector("#auto");
    if (auto) {
      auto.addEventListener("click", () => {
        const picked = competitors.slice(0, 2).map((c) => c.id);
        state.picked = new Set(picked);
        for (const compId of picked) {
          state.matrix[compId] = {};
          for (const dim of DIMENSIONS) state.matrix[compId][dim.id] = "worse";
        }
        state.conclusion =
          "竞品在入口与信任上存在明显短板，我会优先用“清晰入口 + 可信解释 + 质量门槛”解决选择困难与误判风险，再用实验验证对转化与留存的影响。";
        render();
      });
    }

    const submit = taskRoot.querySelector("#submit");
    if (submit) submit.addEventListener("click", submitDeliverable);
  }

  function renderMatrix(picked) {
    return `
      <div style="display:grid; gap:10px">
        ${DIMENSIONS.map((dim) => {
          return `
            <div class="card">
              <div class="k">${dim.name}</div>
              <div class="v" style="margin-top:8px">
                <div style="color: rgba(255,255,255,0.65); font-size:12px">${dim.tip}</div>
                <div class="grid-2" style="margin-top:8px">
                  ${picked
                    .map((compId) => {
                      const comp = competitors.find((c) => c.id === compId);
                      const v = state.matrix?.[compId]?.[dim.id] ?? "";
                      return `
                        <div>
                          <div class="pill" style="margin-bottom:6px">${comp?.name ?? compId}</div>
                          <select data-mx="${compId}:${dim.id}">
                            <option value="" ${v === "" ? "selected" : ""}>请选择</option>
                            ${RATINGS.map((r) => `<option value="${r.id}" ${v === r.id ? "selected" : ""}>${r.label}</option>`).join("")}
                          </select>
                        </div>
                      `;
                    })
                    .join("")}
                </div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function wireDragRank(listEl) {
    let dragId = null;
    listEl.querySelectorAll("[data-rank]").forEach((item) => {
      item.addEventListener("dragstart", (e) => {
        dragId = item.getAttribute("data-rank");
        e.dataTransfer?.setData("text/plain", dragId ?? "");
      });
      item.addEventListener("dragover", (e) => {
        e.preventDefault();
      });
      item.addEventListener("drop", (e) => {
        e.preventDefault();
        const targetId = item.getAttribute("data-rank");
        if (!dragId || !targetId || dragId === targetId) return;
        const from = state.top3.indexOf(dragId);
        const to = state.top3.indexOf(targetId);
        if (from < 0 || to < 0) return;
        state.top3.splice(from, 1);
        state.top3.splice(to, 0, dragId);
        render();
      });
    });
  }

  function move(id, dir) {
    if (!id) return;
    const idx = state.top3.indexOf(id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= state.top3.length) return;
    const copy = state.top3.slice();
    copy.splice(idx, 1);
    copy.splice(next, 0, id);
    state.top3 = copy;
    render();
  }

  function validate() {
    const picked = [...state.picked];
    if (picked.length !== 2) return "请选择 2 个竞品。";
    for (const compId of picked) {
      for (const dim of DIMENSIONS) {
        const v = state.matrix?.[compId]?.[dim.id];
        if (!v) return `请完成差异矩阵（${dim.name} - ${compId}）。`;
      }
    }
    if ((state.conclusion ?? "").trim().length < 18) return "请写一句更完整的结论（至少 18 个字）。";
    return "";
  }

  function submitDeliverable() {
    state.err = validate();
    if (state.err) return render();

    const picked = [...state.picked];
    const matrixScore = scoreMatrix(state.matrix);
    const top3 = state.top3.slice(0, 3).map((id) => IMPROVEMENTS.find((x) => x.id === id));
    const delta = top3.reduce(
      (acc, item) => {
        for (const [k, v] of Object.entries(item?.delta ?? {})) acc[k] = (acc[k] ?? 0) + v;
        return acc;
      },
      { ux: 0, risk: 0, efficiency: 0, accuracy: 0, cost: 0 }
    );
    delta.ux += matrixScore * 0.15;
    delta.risk += (1 - matrixScore) * 0.08;

    onComplete({
      deliverable: {
        type: "competitor_matrix",
        title: "竞品差异矩阵与可复用优化点",
        brief: "对 2 个竞品做差异矩阵，并排序出 3 个优先优化点",
        data: {
          picked,
          matrix: state.matrix,
          top3: state.top3.slice(0, 3),
          conclusion: state.conclusion.trim()
        }
      },
      delta
    });
  }

  render();
}

