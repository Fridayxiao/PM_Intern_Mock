const NORTH_STARS = [
  {
    id: "complete_rate",
    label: "鉴别完成率（提交→拿到结果）",
    why: "对 0-1 新功能更直接，能暴露流程断点"
  },
  {
    id: "valid_submit",
    label: "有效提交数（通过质量门槛的提交）",
    why: "当误判主要来自垃圾输入时，先把输入质量控住"
  },
  {
    id: "retention_7d",
    label: "7 日留存（使用过鉴别的人）",
    why: "当产品目标是长期价值/粘性时更合适"
  },
  {
    id: "share_rate",
    label: "分享转化（分享→新用户进入）",
    why: "当你明确要做裂变与增长，且链路闭环可测"
  }
];

const EVENT_TEMPLATES = [
  { id: "browse_entry", label: "浏览入口", requiredProps: ["entry_source"] },
  { id: "open_module", label: "进入鉴别模块", requiredProps: ["entry_source"] },
  { id: "select_pet", label: "选择宠物类目", requiredProps: ["pet_category"] },
  { id: "upload_image", label: "上传图片", requiredProps: ["image_quality", "num_images"] },
  { id: "submit_order", label: "提交鉴别", requiredProps: ["pet_category", "image_quality"] },
  { id: "match_expert", label: "匹配鉴别师", requiredProps: ["queue_wait_ms", "expert_level"] },
  { id: "ai_pre_report", label: "生成初步报告", requiredProps: ["model_confidence"] },
  { id: "final_report", label: "查看最终报告", requiredProps: ["model_confidence", "has_explain"] },
  { id: "rate_report", label: "评价报告", requiredProps: ["rating", "reason"] },
  { id: "share_out", label: "分享", requiredProps: ["channel"] }
];

const STAGE_ORDER = ["browse_entry", "open_module", "select_pet", "upload_image", "submit_order", "final_report"];

function templateById(id) {
  return EVENT_TEMPLATES.find((t) => t.id === id) ?? null;
}

function isOrdered(selectedIds) {
  const positions = STAGE_ORDER.map((id) => selectedIds.indexOf(id)).filter((x) => x >= 0);
  for (let i = 1; i < positions.length; i++) if (positions[i] < positions[i - 1]) return false;
  return true;
}

export function renderFunnelTask({ taskRoot, scene, onComplete }) {
  const state = {
    ns: "",
    events: Array.from({ length: 6 }, () => ({ eventId: "", props: {} })),
    err: ""
  };

  function render() {
    taskRoot.innerHTML = `
      <div class="card">
        <div class="k">Step 1: 选一个北极星指标</div>
        <div class="v" style="margin-top:8px; display:grid; gap:8px">
          ${NORTH_STARS.map(
            (ns) => `
              <label style="align-items:flex-start">
                <input type="radio" name="ns" value="${ns.id}" ${state.ns === ns.id ? "checked" : ""} />
                <span><b>${ns.label}</b><div style="color: rgba(255,255,255,0.65); font-size:12px; margin-top:4px">${ns.why}</div></span>
              </label>
            `
          ).join("")}
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 2: 设计 6 个关键事件（含属性）</div>
        <div class="v">
          <div style="color: rgba(255,255,255,0.7); font-size:12px; line-height:1.6">
            目标: 让“内容浏览 → 点击/进入 → 上传 → 提交 → 出结果 → 分享/复访”这条链路可量化、可定位断点。
          </div>
          <div style="margin-top:10px; display:grid; gap:10px">
            ${state.events
              .map((row, idx) => {
                const tpl = templateById(row.eventId);
                const required = tpl?.requiredProps ?? [];
                return `
                  <div class="card">
                    <div class="row">
                      <div style="flex: 1.2">
                        <div class="pill">事件 ${idx + 1}</div>
                        <select data-ev="${idx}" style="margin-top:8px">
                          <option value="">选择事件</option>
                          ${EVENT_TEMPLATES.map((t) => `<option value="${t.id}" ${t.id === row.eventId ? "selected" : ""}>${t.label}</option>`).join("")}
                        </select>
                      </div>
                      <div style="flex: 2">
                        <div class="pill">属性（用逗号分隔: key=value）</div>
                        <input class="input" data-props="${idx}" placeholder="${required.length ? required.map((x) => `${x}=?`).join(", ") : "例如: entry_source=feed"}" value="${propsToText(row.props)}" style="margin-top:8px" />
                        ${
                          required.length
                            ? `<div style="color: rgba(255,255,255,0.65); font-size:12px; margin-top:6px">必填: ${required.join(", ")}</div>`
                            : `<div style="color: rgba(255,255,255,0.5); font-size:12px; margin-top:6px">必填: 无</div>`
                        }
                      </div>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
          <div class="row" style="margin-top:10px">
            <button id="submit" class="btn-primary">提交埋点方案</button>
            <button id="auto" title="仅用于快速体验">快速填充</button>
          </div>
          ${state.err ? `<div class="error">${state.err}</div>` : ""}
        </div>
      </div>
    `;

    for (const el of taskRoot.querySelectorAll("input[name='ns']")) {
      el.addEventListener("change", () => {
        state.ns = el.value;
        state.err = "";
      });
    }

    for (const el of taskRoot.querySelectorAll("select[data-ev]")) {
      el.addEventListener("change", () => {
        const idx = Number(el.getAttribute("data-ev"));
        state.events[idx].eventId = el.value;
        state.err = "";
      });
    }
    for (const el of taskRoot.querySelectorAll("input[data-props]")) {
      el.addEventListener("input", () => {
        const idx = Number(el.getAttribute("data-props"));
        state.events[idx].props = textToProps(el.value);
        state.err = "";
      });
    }

    taskRoot.querySelector("#auto")?.addEventListener("click", () => {
      state.ns = "complete_rate";
      state.events = [
        { eventId: "browse_entry", props: { entry_source: "feed" } },
        { eventId: "open_module", props: { entry_source: "feed" } },
        { eventId: "select_pet", props: { pet_category: "cat" } },
        { eventId: "upload_image", props: { image_quality: "ok", num_images: 3 } },
        { eventId: "submit_order", props: { pet_category: "cat", image_quality: "ok" } },
        { eventId: "final_report", props: { model_confidence: 0.82, has_explain: true } }
      ];
      render();
    });

    taskRoot.querySelector("#submit")?.addEventListener("click", submitDeliverable);
  }

  function propsToText(props) {
    if (!props || typeof props !== "object") return "";
    return Object.entries(props)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
  }

  function textToProps(text) {
    const out = {};
    const parts = String(text)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    for (const p of parts) {
      const [k, ...rest] = p.split("=");
      const key = k?.trim();
      const value = rest.join("=").trim();
      if (!key) continue;
      out[key] = coerce(value);
    }
    return out;
  }

  function coerce(v) {
    if (v === "true") return true;
    if (v === "false") return false;
    const n = Number(v);
    if (!Number.isNaN(n) && String(n) === v) return n;
    return v;
  }

  function validate() {
    if (!state.ns) return "请选择一个北极星指标。";
    const ids = state.events.map((r) => r.eventId).filter(Boolean);
    if (ids.length !== 6) return "请为 6 行都选择事件。";
    const dup = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dup) return `事件重复: ${templateById(dup)?.label ?? dup}。建议每个关键节点一个事件。`;
    if (!isOrdered(ids)) return "关键链路事件顺序不合理（建议按: 浏览→进入→选择→上传→提交→出结果）。";
    if (!ids.includes("submit_order")) return "缺少“提交鉴别”事件（submit_order）。";
    if (!ids.includes("final_report")) return "缺少“查看最终报告”事件（final_report）。";

    for (const row of state.events) {
      const tpl = templateById(row.eventId);
      const required = tpl?.requiredProps ?? [];
      for (const key of required) {
        if (!(key in (row.props ?? {}))) return `事件“${tpl?.label}”缺少必填属性: ${key}`;
      }
    }
    return "";
  }

  function submitDeliverable() {
    state.err = validate();
    if (state.err) return render();

    const coverage = state.events.reduce((acc, r) => {
      const tpl = templateById(r.eventId);
      acc.push({ id: r.eventId, name: tpl?.label ?? r.eventId, props: r.props });
      return acc;
    }, []);

    onComplete({
      deliverable: {
        type: "funnel_tracking",
        title: "北极星指标 + 埋点事件设计",
        brief: `北极星: ${NORTH_STARS.find((x) => x.id === state.ns)?.label ?? state.ns}；事件数: 6`,
        data: {
          northStar: state.ns,
          events: coverage
        }
      },
      delta: {
        efficiency: +0.05,
        risk: -0.05,
        accuracy: +0.05,
        ux: +0.05,
        cost: +0.02
      }
    });
  }

  render();
}

