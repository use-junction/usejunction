import { expect, test } from "vitest";
import { calendarRangeLabel, calendarRangePeriod, parseRollingPeriodFromSearch, rollingPeriodLabel } from "@/lib/dashboard/period-prefs";

const today = new Date("2026-10-08T15:00:00Z");

test("calendar ranges resolve to fixed UTC dates", () => {
  expect(calendarRangePeriod("this_month", today)).toMatchObject({ from: "2026-10-01", to: "2026-10-08" });
  expect(calendarRangePeriod("last_month", today)).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
  expect(calendarRangePeriod("this_quarter", today)).toMatchObject({ from: "2026-10-01", to: "2026-10-08" });
  expect(calendarRangePeriod("last_quarter", today)).toMatchObject({ from: "2026-07-01", to: "2026-09-30" });
  expect(calendarRangePeriod("year_to_date", today)).toMatchObject({ from: "2026-01-01", to: "2026-10-08" });
  expect(calendarRangePeriod("last_quarter", new Date("2026-02-10T00:00:00Z"))).toMatchObject({ from: "2025-10-01", to: "2025-12-31" });
});

test("a URL range that matches a calendar range is labelled by name", () => {
  const period = parseRollingPeriodFromSearch({ from: "2026-07-01", to: "2026-09-30" });
  expect(calendarRangeLabel(period, today)).toBe("Last quarter");
  expect(calendarRangeLabel(parseRollingPeriodFromSearch({ from: "2026-07-02", to: "2026-09-30" }), today)).toBeNull();
});

test("90 days is a rolling preset", () => {
  const period = parseRollingPeriodFromSearch({ days: "90" });
  expect(period).toEqual({ kind: "preset", days: 90 });
  expect(rollingPeriodLabel(period)).toBe("Last 90 days");
});
