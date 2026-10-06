import { expect, test } from "vitest";
import { adoptionWeeks, buildTeamAdoption, clampAdoptionWindow } from "@/lib/queries/activity/adoption";

const window = { from: new Date("2026-09-04T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") };
const device = (createdAt = "2026-06-01", lastSeenAt = "2026-10-01") => ({
  createdAt: new Date(`${createdAt}T00:00:00Z`),
  lastSeenAt: new Date(`${lastSeenAt}T12:00:00Z`),
  decommissionedAt: null,
});
const days = (developerId: string, toolName: string, dates: string[]) => dates.map((date) => ({ developerId, toolName, date }));

test("a 28-day window splits into four weeks ending on the last day", () => {
  expect(adoptionWeeks(window.from, window.to)).toEqual([
    { start: "2026-09-04", end: "2026-09-10" },
    { start: "2026-09-11", end: "2026-09-17" },
    { start: "2026-09-18", end: "2026-09-24" },
    { start: "2026-09-25", end: "2026-10-01" },
  ]);
});

test("people are banded by weeks active, with no-data kept apart from not using", () => {
  const result = buildTeamAdoption({
    window,
    developers: [
      { id: "ada", name: "Ada", devices: [device()] },
      { id: "ben", name: "Ben", devices: [device()] },
      { id: "cy", name: "Cy", devices: [device()] },
      { id: "dee", name: "Dee", devices: [device("2026-06-01", "2026-08-01")] },
      { id: "eve", name: "Eve", devices: [] },
    ],
    activity: [
      ...days("ada", "Cursor", ["2026-09-05", "2026-09-12", "2026-09-20", "2026-09-30"]),
      ...days("ada", "Codex", ["2026-09-30"]),
      ...days("ben", "Cursor", ["2026-09-30"]),
      ...days("cy", "Cursor", ["2026-08-10", "2026-08-20", "2026-08-25", "2026-09-01"]),
    ],
    plans: [
      { developerId: "cy", toolName: "Cursor", cycleSeatMicros: 20_000_000n, seatCount: 1 },
      { developerId: "dee", toolName: "Cursor", cycleSeatMicros: 20_000_000n, seatCount: 1 },
      { developerId: "ada", toolName: "cursor", cycleSeatMicros: 20_000_000n, seatCount: 1 },
    ],
  });

  const band = (id: string) => result.people.find((person) => person.id === id)?.band;
  expect(band("ada")).toBe("regular");
  expect(band("ben")).toBe("occasional");
  expect(band("cy")).toBe("not_started");
  expect(result.people.find((person) => person.id === "cy")?.previousBand).toBe("regular");
  expect(band("dee")).toBe("no_data");
  expect(result.notEnrolled.map((person) => person.id)).toEqual(["eve"]);
  expect(result.counts).toMatchObject({ members: 5, enrolled: 4, active: 2, previousActive: 1, regular: 1, occasional: 1, notStarted: 1, noData: 1 });
  // Dee's seat is not counted idle: no data is not the same as no use.
  expect(result.idleSeats).toEqual({ count: 1, cycleMicros: "20000000", tools: [{ toolName: "cursor", count: 1, cycleMicros: "20000000" }] });
  expect(result.tools).toEqual([
    { toolName: "cursor", people: 2, previousPeople: 1 },
    { toolName: "chatgpt-codex", people: 1, previousPeople: 0 },
  ]);
  expect(result.people.find((person) => person.id === "ada")?.weeks).toEqual(["active", "active", "active", "active"]);
  expect(result.people.find((person) => person.id === "dee")?.weeks).toEqual(["no_data", "no_data", "no_data", "no_data"]);
});

test("weeks before enrollment are blank and do not count against someone", () => {
  const result = buildTeamAdoption({
    window,
    developers: [{ id: "new", name: "New", devices: [device("2026-09-22")] }],
    activity: days("new", "Claude Code", ["2026-09-23", "2026-09-29"]),
    plans: [],
  });
  const person = result.people[0]!;
  expect(person.weeks).toEqual(["before", "before", "active", "active"]);
  expect(person.band).toBe("regular");
  expect(person.previousBand).toBeNull();
});

test("free plans are never unused paid seats", () => {
  const result = buildTeamAdoption({
    window,
    developers: [{ id: "ada", name: "Ada", devices: [device()] }],
    activity: days("ada", "cursor", ["2026-09-30"]),
    plans: [
      { developerId: "ada", toolName: "copilot", cycleSeatMicros: 0n, seatCount: 1 },
      { developerId: "ada", toolName: "claude", cycleSeatMicros: 25_000_000n, seatCount: 1 },
      { developerId: "ada", toolName: "cursor", cycleSeatMicros: 20_000_000n, seatCount: 1 },
    ],
  });
  expect(result.idleSeats).toEqual({ count: 1, cycleMicros: "25000000", tools: [{ toolName: "claude", count: 1, cycleMicros: "25000000" }] });
  expect(result.people[0]!.seats.map((seat) => seat.toolName)).toEqual(["claude", "cursor"]);
});

test("a billing-cycle window that runs past today stops at today", () => {
  const clamped = clampAdoptionWindow(
    { from: new Date("2026-09-21T00:00:00Z"), to: new Date("2026-10-20T23:59:59Z") },
    new Date("2026-10-03T15:00:00Z"),
  );
  expect(clamped).toEqual({ from: new Date("2026-09-21T00:00:00Z"), to: new Date("2026-10-03T00:00:00Z") });
  expect(adoptionWeeks(clamped.from, clamped.to)).toHaveLength(2);
});

test("tool aliases count as one tool and match the seat", () => {
  const result = buildTeamAdoption({
    window,
    developers: [{ id: "ada", name: "Ada", devices: [device()] }],
    activity: [...days("ada", "codex-work", ["2026-09-30"]), ...days("ada", "codex", ["2026-09-29"])],
    plans: [{ developerId: "ada", toolName: "codex", cycleSeatMicros: 20_000_000n, seatCount: 1 }],
  });
  expect(result.people[0]!.tools).toEqual(["chatgpt-codex"]);
  expect(result.idleSeats.count).toBe(0);
});
