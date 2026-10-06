import { featureCostWindow } from "@/lib/features/allocate";

export const CHANGE_TYPES = [
  "Features", "Fixes", "Refactoring", "Performance", "Documentation", "Tests",
  "Build & dependencies", "CI", "Maintenance", "Formatting", "Reverts", "No recognized prefix",
] as const;

export function workSpendWindow(rawDays: string | null | undefined) {
  const days = rawDays === "30" ? 30 : 90;
  const window = featureCostWindow(new Date(), days);
  return { ...window, endExclusive: new Date(window.to.getTime() + 86_400_000) };
}
