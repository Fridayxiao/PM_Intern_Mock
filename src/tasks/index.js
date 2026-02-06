import { renderCompetitorTask } from "./task_competitor.js";
import { renderFunnelTask } from "./task_funnel.js";
import { renderAiTradeoffTask } from "./task_ai_tradeoff.js";
import { renderTriageTask } from "./task_triage.js";
import { renderMilestoneTask } from "./task_milestones.js";
import { renderBottleneckTask } from "./task_bottleneck.js";
import { renderExperienceTask } from "./task_experience.js";
import { renderAbTestTask } from "./task_abtest.js";
import { renderAbReadoutTask } from "./task_abreadout.js";
import { renderAbBriefTask } from "./task_ab_brief.js";
import { renderAbInstrumentationTask } from "./task_ab_instrumentation.js";
import { renderAbQualityTask } from "./task_ab_quality.js";
import { renderAbRampTask } from "./task_ab_ramp.js";

const TASKS = {
  competitor_matrix: renderCompetitorTask,
  funnel_tracking: renderFunnelTask,
  ai_tradeoff: renderAiTradeoffTask,
  triage_loop: renderTriageTask,
  milestone_plan: renderMilestoneTask,
  bottleneck_hypothesis: renderBottleneckTask,
  experience_flow: renderExperienceTask,
  ab_test_design: renderAbTestTask,
  ab_test_readout: renderAbReadoutTask,
  ab_brief: renderAbBriefTask,
  ab_instrumentation: renderAbInstrumentationTask,
  ab_quality: renderAbQualityTask,
  ab_ramp: renderAbRampTask
};

export function renderTask({ taskRoot, scene, store, metrics, onComplete }) {
  const fn = TASKS[scene.task.type];
  if (!fn) {
    taskRoot.innerHTML = `<div class="error">未知任务类型: ${scene.task.type}</div>`;
    return;
  }
  fn({ taskRoot, scene, store, metrics, onComplete });
}
