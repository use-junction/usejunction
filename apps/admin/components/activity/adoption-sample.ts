import type { AdoptionBand, AdoptionCell, AdoptionPerson, TeamAdoption } from "@/lib/queries/activity/adoption";

const DAY_MS = 86_400_000;

function eachDay(from: string, to: string) {
  const days: string[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += DAY_MS) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}

function isWeekday(day: string) {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

type SamplePerson = {
  name: string;
  band: AdoptionBand;
  previousBand: AdoptionPerson["previousBand"];
  /** Share of weekdays with AI use, 0–1. */
  rate: number;
  /** Enrolled this many days into the period. */
  startOffset?: number;
  tools: string[];
  seats: AdoptionPerson["seats"];
};

const SAMPLE_PEOPLE: SamplePerson[] = [
  { name: "Maya Chen", band: "regular", previousBand: "regular", rate: 0.95, tools: ["claude", "cursor"], seats: [{ toolName: "claude", used: true }, { toolName: "cursor", used: true }] },
  { name: "Jonas Weber", band: "regular", previousBand: "occasional", rate: 0.8, tools: ["cursor"], seats: [{ toolName: "cursor", used: true }] },
  { name: "Asha Kumar", band: "regular", previousBand: "regular", rate: 0.7, tools: ["claude", "chatgpt-codex"], seats: [{ toolName: "claude", used: true }] },
  { name: "Tom Lindqvist", band: "occasional", previousBand: "regular", rate: 0.3, startOffset: 9, tools: ["github-copilot"], seats: [{ toolName: "github-copilot", used: true }] },
  { name: "Priya Nair", band: "not_started", previousBand: null, rate: 0, tools: [], seats: [{ toolName: "github-copilot", used: false }] },
  { name: "Leo Martins", band: "no_data", previousBand: "occasional", rate: 0, tools: [], seats: [] },
];

/** A believable team for the preview, laid over the real period so dates and weeks match the page. */
export function sampleAdoption(real: TeamAdoption): TeamAdoption {
  const days = eachDay(real.from, real.to);
  const people: AdoptionPerson[] = SAMPLE_PEOPLE.map((sample, index) => {
    const enrolledAt = days[Math.min(sample.startOffset ?? 0, days.length - 1)]!;
    // Deterministic spread: a weekday counts when its slot falls under the person's rate.
    const activeDates = sample.rate
      ? days.filter((day, dayIndex) => day >= enrolledAt && isWeekday(day) && ((dayIndex * 7 + index * 3) % 10) / 10 < sample.rate)
      : [];
    const active = new Set(activeDates);
    const weeks: AdoptionCell[] = real.weeks.map((week) => {
      if (week.end < enrolledAt) return "before";
      if (sample.band === "no_data") return "no_data";
      return eachDay(week.start, week.end).some((day) => active.has(day)) ? "active" : "inactive";
    });
    const eligibleDays = days.filter((day) => day >= enrolledAt).length;
    return {
      id: `sample-${index}`,
      name: sample.name,
      band: sample.band,
      previousBand: sample.previousBand,
      weeks,
      activeDays: activeDates.length,
      activeDates,
      enrolledAt,
      daysPerWeek: eligibleDays ? Math.round((activeDates.length / eligibleDays) * 70) / 10 : 0,
      tools: sample.tools,
      seats: sample.seats,
      lastSeenAt: sample.band === "no_data" ? new Date(Date.parse(`${real.to}T00:00:00Z`) - 12 * DAY_MS).toISOString() : `${real.to}T09:00:00Z`,
    };
  });
  return {
    from: real.from,
    to: real.to,
    weeks: real.weeks,
    people,
    notEnrolled: [{ id: "sample-new", name: "Sam Ortiz", seats: [{ toolName: "cursor", used: false }] }],
    counts: { members: 7, enrolled: 6, active: 4, previousActive: 3, regular: 3, occasional: 1, notStarted: 1, noData: 1 },
    tools: [
      { toolName: "claude", people: 2, previousPeople: 2 },
      { toolName: "cursor", people: 2, previousPeople: 1 },
      { toolName: "chatgpt-codex", people: 1, previousPeople: 0 },
      { toolName: "github-copilot", people: 1, previousPeople: 2 },
    ],
    idleSeats: { count: 1, monthlyMicros: "19000000", tools: [{ toolName: "github-copilot", count: 1, monthlyMicros: "19000000" }] },
    unassignedSeats: { count: 1, monthlyMicros: "40000000", tools: [{ toolName: "cursor", count: 1, monthlyMicros: "40000000" }] },
  };
}
