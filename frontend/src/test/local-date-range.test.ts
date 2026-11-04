import { afterEach, describe, expect, it, vi } from "vitest";
import * as dates from "@/lib/utils";

// Changing TZ in the Vitest fork exercises real Date behavior in both zones.
// Expectations are UTC literals, independently calculated from each zone's offsets.
afterEach(() => vi.unstubAllEnvs());
const cases = [
  ["Asia/Shanghai", "2026-03-08", "2026-03-07T16:00:00.000Z", "2026-03-08T15:59:59.999999Z"],
  ["America/New_York", "2026-03-08", "2026-03-08T05:00:00.000Z", "2026-03-09T03:59:59.999999Z"],
  ["America/New_York", "2026-11-01", "2026-11-01T04:00:00.000Z", "2026-11-02T04:59:59.999999Z"],
];
describe("local date filters preserve backend inclusive bounds", () => {
  it.each(cases)("covers the whole day in %s on %s", (tz, day, start, end) => {
    vi.stubEnv("TZ", tz);
    expect(dates.localDayStartISO(day)).toBe(start);
    expect(dates.localDayEndISO(day)).toBe(end);
  });
});
