const TRACKS = [
  {
    id: "retrieval",
    name: "相似检索（候选样本召回）",
    options: [
      {
        id: "classic_embedding",
        label: "轻量 embedding + ANN 索引",
        desc: "中等数据量下性价比高；上线快；可逐步扩展到更强模型",
        attrs: { data: "中", latency: "低", explain: "中", cost: "低", risk: "中" },
        delta: { efficiency: +0.22, cost: +0.05, accuracy: +0.08 }
      },
      {
        id: "siamese_strict",
        label: "孪生网络对比学习（更强区分）",
        desc: "相似品种区分更强，但训练与维护成本更高",
        attrs: { data: "高", latency: "中", explain: "中", cost: "中", risk: "中" },
        delta: { accuracy: +0.16, cost: +0.12, efficiency: -0.04 }
      },
      {
        id: "multimodal_embed",
        label: "多模态 embedding（图+文）+ 向量检索",
        desc: "可同时利用图像与描述；扩展性强；需要更严格监控漂移",
        attrs: { data: "高", latency: "中", explain: "中", cost: "中", risk: "中高" },
        delta: { accuracy: +0.18, cost: +0.16, risk: +0.06 }
      }
    ]
  },
  {
    id: "denoise",
    name: "图像质量与降噪（输入可用性）",
    options: [
      {
        id: "quality_gate",
        label: "质量门槛 + 轻量增强（先控输入）",
        desc: "把坏输入挡在门外；用少量增强提升可用性；上线风险低",
        attrs: { data: "低", latency: "低", explain: "高", cost: "低", risk: "低" },
        delta: { accuracy: +0.14, efficiency: +0.1, ux: +0.08, risk: -0.02 }
      },
      {
        id: "denoise_model",
        label: "专门降噪模型（覆盖复杂噪声）",
        desc: "低光/模糊/压缩噪声更强，但算力与测试成本更高",
        attrs: { data: "中", latency: "中", explain: "中", cost: "中", risk: "中" },
        delta: { accuracy: +0.18, cost: +0.14, efficiency: -0.06 }
      },
      {
        id: "segment_then_enhance",
        label: "先分割主体再增强（更稳）",
        desc: "减少复杂背景干扰，但链路更长，需监控多模型耦合",
        attrs: { data: "高", latency: "中高", explain: "中", cost: "中高", risk: "中高" },
        delta: { accuracy: +0.22, cost: +0.2, risk: +0.08, efficiency: -0.1 }
      }
    ]
  },
  {
    id: "classify",
    name: "分类（粗类目/品种预测）",
    options: [
      {
        id: "light_cnn",
        label: "轻量 CNN（边端/服务端皆可）",
        desc: "吞吐高、便于灰度；适合先做 0-1 的覆盖",
        attrs: { data: "中", latency: "低", explain: "中", cost: "低", risk: "中" },
        delta: { efficiency: +0.14, accuracy: +0.1, cost: +0.06 }
      },
      {
        id: "transfer_stronger",
        label: "迁移学习（更强 backbone）",
        desc: "对长尾品种更友好，但需要更严格的评估与回归测试",
        attrs: { data: "中高", latency: "中", explain: "中", cost: "中", risk: "中" },
        delta: { accuracy: +0.18, cost: +0.12, efficiency: -0.03 }
      },
      {
        id: "hierarchical",
        label: "分层分类（先大类后细分）",
        desc: "可解释性更好，适合输出“关联分析”，但产品设计更复杂",
        attrs: { data: "高", latency: "中", explain: "高", cost: "中", risk: "中" },
        delta: { accuracy: +0.2, ux: +0.12, cost: +0.12, efficiency: -0.06 }
      }
    ]
  }
];

const MITIGATIONS = [
  { id: "low_conf_human", label: "低置信度自动触发人工复核", delta: { accuracy: +0.12, cost: +0.1, risk: -0.05 } },
  { id: "upload_guidance", label: "多角度上传引导 + 质量检测", delta: { accuracy: +0.12, ux: +0.1, efficiency: +0.05 } },
  { id: "abstain", label: "允许模型拒答/给不确定并提供下一步", delta: { risk: -0.06, ux: +0.06, accuracy: +0.06 } },
  { id: "drift_monitor", label: "上线后漂移监控 + 回归集", delta: { risk: -0.06, cost: +0.06 } },
  { id: "queue_sla", label: "排队 SLA + 进度节点通知", delta: { ux: +0.12, risk: -0.02, efficiency: +0.03 } },
  { id: "appeal_flow", label: "申诉/纠错入口（数据闭环）", delta: { accuracy: +0.1, ux: +0.08, cost: +0.06 } }
];

function optionById(trackId, optionId) {
  const track = TRACKS.find((t) => t.id === trackId);
  return track?.options?.find((o) => o.id === optionId) ?? null;
}

export function renderAiTradeoffTask({ taskRoot, onComplete }) {
  const state = {
    pick: {
      retrieval: "",
      denoise: "",
      classify: ""
    },
    mitigations: new Set(),
    err: ""
  };

  function render() {
    taskRoot.innerHTML = `
      <div class="card">
        <div class="k">Step 1: 为三条 AI 能力各选一个方案</div>
        <div class="v" style="margin-top:10px; display:grid; gap:12px">
          ${TRACKS.map((t) => renderTrack(t)).join("")}
        </div>
      </div>

      <div class="card" style="margin-top:10px">
        <div class="k">Step 2: 为 bad case 配套兜底（至少选 2 个）</div>
        <div class="v" style="margin-top:10px; display:grid; gap:8px">
          ${MITIGATIONS.map(
            (m) => `
              <label>
                <input type="checkbox" data-mit="${m.id}" ${state.mitigations.has(m.id) ? "checked" : ""}/>
                <span>${m.label}</span>
              </label>
            `
          ).join("")}
          <div class="row" style="margin-top:10px">
            <button id="submit" class="btn-primary">提交方案组合</button>
            <button id="auto" title="仅用于快速体验">快速填充</button>
          </div>
          ${state.err ? `<div class="error">${state.err}</div>` : ""}
        </div>
      </div>
    `;

    for (const el of taskRoot.querySelectorAll("input[type='radio'][data-track]")) {
      el.addEventListener("change", () => {
        const trackId = el.getAttribute("data-track");
        state.pick[trackId] = el.value;
        state.err = "";
      });
    }

    for (const el of taskRoot.querySelectorAll("input[type='checkbox'][data-mit]")) {
      el.addEventListener("change", () => {
        const id = el.getAttribute("data-mit");
        if (el.checked) state.mitigations.add(id);
        else state.mitigations.delete(id);
        state.err = "";
      });
    }

    taskRoot.querySelector("#auto")?.addEventListener("click", () => {
      state.pick.retrieval = "multimodal_embed";
      state.pick.denoise = "quality_gate";
      state.pick.classify = "hierarchical";
      state.mitigations = new Set(["low_conf_human", "upload_guidance", "abstain"]);
      render();
    });

    taskRoot.querySelector("#submit")?.addEventListener("click", submitDeliverable);
  }

  function renderTrack(track) {
    return `
      <div class="card">
        <div class="k">${track.name}</div>
        <div class="v" style="margin-top:8px; display:grid; gap:8px">
          ${track.options
            .map((o) => {
              const checked = state.pick[track.id] === o.id;
              return `
                <label style="align-items:flex-start">
                  <input type="radio" name="track_${track.id}" value="${o.id}" data-track="${track.id}" ${checked ? "checked" : ""}/>
                  <span>
                    <b>${o.label}</b>
                    <div style="color: rgba(255,255,255,0.65); font-size:12px; margin-top:4px">${o.desc}</div>
                    <div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:6px">
                      ${Object.entries(o.attrs)
                        .map(([k, v]) => `<span class="pill">${k}:${v}</span>`)
                        .join("")}
                    </div>
                  </span>
                </label>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function validate() {
    for (const t of TRACKS) {
      if (!state.pick[t.id]) return `请为“${t.name}”选择一个方案。`;
    }
    if (state.mitigations.size < 2) return "至少选择 2 个 bad case 兜底策略。";
    return "";
  }

  function submitDeliverable() {
    state.err = validate();
    if (state.err) return render();

    const chosen = {};
    const delta = { efficiency: 0, accuracy: 0, ux: 0, cost: 0, risk: 0 };
    for (const t of TRACKS) {
      const opt = optionById(t.id, state.pick[t.id]);
      chosen[t.id] = opt?.id ?? "";
      for (const [k, v] of Object.entries(opt?.delta ?? {})) delta[k] += v;
    }
    const mitIds = [...state.mitigations];
    for (const id of mitIds) {
      const m = MITIGATIONS.find((x) => x.id === id);
      for (const [k, v] of Object.entries(m?.delta ?? {})) delta[k] += v;
    }

    onComplete({
      deliverable: {
        type: "ai_tradeoff",
        title: "AI 方案组合 + Bad case 兜底",
        brief: `检索/降噪/分类 + 兜底 ${state.mitigations.size} 项`,
        data: {
          picks: state.pick,
          mitigations: mitIds
        }
      },
      delta
    });
  }

  render();
}

