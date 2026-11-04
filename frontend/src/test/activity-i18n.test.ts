import { describe, expect, it } from "vitest";

describe("localizeSummary", () => {
  it("translates backend templates in Chinese but never user notes", async () => {
    localStorage.setItem("researchos-lang", "zh");
    const { vi } = await import("vitest");
    vi.resetModules();
    const { localizeSummary } = await import("@/i18n/activity");
    expect(localizeSummary("Stage changed: Implementation → Experimentation", "stage_changed")).toBe("阶段变更：实现 → 实验");
    expect(localizeSummary("Task 'Run seeds': todo → blocked", "task_status_changed")).toBe("任务“Run seeds”：待办 → 受阻");
    expect(localizeSummary("Run wandb-1 recorded for 'No WM' (seed 0): goal_rate=0.52", "run_recorded"))
      .toBe("记录运行 wandb-1（实验“No WM”，种子 0）：goal_rate=0.52");
    expect(localizeSummary("Project updated: next_action, priority", "project_updated")).toBe("项目已更新：下一步行动、优先级");
    expect(localizeSummary("Member left: alice", "member_left")).toBe("成员退出：alice");
    expect(localizeSummary("Task created: anything", "progress_note")).toBe("Task created: anything");
    localStorage.removeItem("researchos-lang");
  });
});
