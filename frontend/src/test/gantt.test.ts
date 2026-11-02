import { describe, expect, it } from "vitest";
import { addDays, computeRange, diffDays, shiftSpan, taskSpan, violatesDependency } from "@/lib/gantt";

describe("gantt helpers", () => {
  it("computes day differences across DST and month ends", () => {
    expect(diffDays("2030-03-09", "2030-03-11")).toBe(2);
    expect(diffDays("2030-10-30", "2030-11-02")).toBe(3);
    expect(addDays("2030-01-31", 1)).toBe("2030-02-01");
    expect(addDays("2030-03-01", -1)).toBe("2030-02-28");
  });
  it("derives a span from start and/or due date", () => {
    expect(taskSpan({ start_date: null, due_date: null })).toBeNull();
    expect(taskSpan({ start_date: null, due_date: "2030-01-05" })).toEqual({ start: "2030-01-05", end: "2030-01-05", complete: false });
    expect(taskSpan({ start_date: "2030-01-02", due_date: "2030-01-05" })).toEqual({ start: "2030-01-02", end: "2030-01-05", complete: true });
  });
  it("moves and resizes without inverting the bar", () => {
    const s = { start: "2030-01-10", end: "2030-01-12", complete: true };
    expect(shiftSpan(s, "move", 3)).toMatchObject({ start: "2030-01-13", end: "2030-01-15" });
    expect(shiftSpan(s, "start", 10)).toMatchObject({ start: "2030-01-12", end: "2030-01-12" });
    expect(shiftSpan(s, "end", -10)).toMatchObject({ start: "2030-01-10", end: "2030-01-10" });
  });
  it("flags finish-to-start violations", () => {
    const pre = { start: "2030-01-01", end: "2030-01-05", complete: true };
    expect(violatesDependency(pre, { start: "2030-01-05", end: "2030-01-08", complete: true })).toBe(false);
    expect(violatesDependency(pre, { start: "2030-01-04", end: "2030-01-08", complete: true })).toBe(true);
  });
  it("builds a bounded window around today", () => {
    const r = computeRange([{ start: "2030-01-10", end: "2030-01-20", complete: true }], "2030-01-12");
    expect(r.start).toBe("2030-01-03");
    expect(r.days).toBeGreaterThanOrEqual(45);
    const far = computeRange([{ start: "2020-01-01", end: "2040-01-01", complete: true }], "2030-01-12");
    expect(diffDays(far.start, "2030-01-12")).toBe(120);
    expect(r.days).toBeLessThan(2000);
  });
});
