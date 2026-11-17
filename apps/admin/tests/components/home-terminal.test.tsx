// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HomeTerminal } from "../../components/public/home-terminal";
import { compareCcusage } from "../../content/compare";
import { HOME_TERMINAL_COMMAND } from "../../lib/public/home-cta";

const HEADING = "See your own number in the terminal";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Stands in for the browser's observer, so a test decides when the strip scrolls into view. */
function stubScrollIntoView() {
  let enter: (() => void) | undefined;
  class Observer {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      enter = () => callback([{ isIntersecting: true }]);
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", Observer);
  return () => act(() => enter?.());
}

/** The one readout on screen, as a reader would hear it. */
function shown(section: HTMLElement) {
  const readouts = section.querySelectorAll("[data-readout=shown]");
  expect(readouts).toHaveLength(1);
  return readouts[0]!.textContent;
}

test("the homepage strip offers the terminal table: one command with a copy button, no account, nothing uploaded", async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  render(<HomeTerminal />);
  const section = screen.getByRole("region", { name: HEADING });

  expect(within(section).getByText("No account. Nothing leaves your machine.")).toBeTruthy();
  // The command is plain text from the first paint: it is not typed out or animated.
  expect(within(section).getByText(HOME_TERMINAL_COMMAND)).toBeTruthy();
  expect(HOME_TERMINAL_COMMAND).toBe("npx usejunction");

  fireEvent.click(within(section).getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("npx usejunction"));
  expect(await within(section).findByRole("button", { name: "Copied" })).toBeTruthy();
});

test("the strip stays one line: no table, tabs, link, example label or total", () => {
  render(<HomeTerminal />);
  const section = screen.getByRole("region", { name: HEADING });

  for (const role of ["figure", "table", "tablist", "link"]) {
    expect(within(section).queryByRole(role)).toBeNull();
  }
  expect(section.textContent).not.toMatch(/ccusage|Example|Total spent/i);
});

test("once on screen the readouts take turns, each with its own graph: next month, then the plans we recommend", () => {
  vi.useFakeTimers();
  const scrollIntoView = stubScrollIntoView();

  render(<HomeTerminal />);
  const section = screen.getByRole("region", { name: HEADING });
  const graph = within(section).getByRole("img");

  // Off screen it waits on the first readout, drawn finished.
  act(() => void vi.advanceTimersByTime(10_000));
  expect(shown(section)).toBe("Estimated next month$430");

  scrollIntoView();
  act(() => void vi.advanceTimersByTime(300));
  const counting = Number(shown(section)!.replace("Estimated next month$", ""));
  expect(counting).toBeGreaterThan(0);
  expect(counting).toBeLessThan(430);
  act(() => void vi.advanceTimersByTime(900));
  expect(shown(section)).toBe("Estimated next month$430");
  // Next month gets bars: this month's, then as many paler ones for the month ahead.
  expect(graph.getAttribute("data-graph")).toBe("forecast");
  expect(graph.querySelectorAll("[data-bar=past]")).toHaveLength(15);
  expect(graph.querySelectorAll("[data-bar=ahead]")).toHaveLength(15);

  act(() => void vi.advanceTimersByTime(3600 - 1200));
  expect(shown(section)).toBe("We recommendClaude Max $100+ChatGPT Plus $20");
  // The plans get a comparison, and its two amounts match the readouts: the estimate, and the two plans added up.
  expect(graph.getAttribute("data-graph")).toBe("plans");
  expect(graph.textContent).toBe("$430 at API prices$120 on plans");

  act(() => void vi.advanceTimersByTime(3600));
  act(() => void vi.advanceTimersByTime(1200));
  expect(shown(section)).toBe("Estimated next month$430");
  expect(graph.getAttribute("data-graph")).toBe("forecast");
});

test("pointing at the strip holds the readout, and it carries on afterwards", () => {
  vi.useFakeTimers();
  const scrollIntoView = stubScrollIntoView();

  render(<HomeTerminal />);
  const section = screen.getByRole("region", { name: HEADING });
  scrollIntoView();

  fireEvent.mouseEnter(section);
  act(() => void vi.advanceTimersByTime(10_000));
  expect(shown(section)).toBe("Estimated next month$430");

  fireEvent.mouseLeave(section);
  act(() => void vi.advanceTimersByTime(3600));
  expect(shown(section)).toBe("We recommendClaude Max $100+ChatGPT Plus $20");
});

test("with reduced motion the numbers do not count up", () => {
  vi.useFakeTimers();
  const scrollIntoView = stubScrollIntoView();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));

  render(<HomeTerminal />);
  const section = screen.getByRole("region", { name: HEADING });
  scrollIntoView();
  act(() => void vi.advanceTimersByTime(100));
  expect(shown(section)).toBe("Estimated next month$430");
});

test("the strip sits below the first story section, directly on the yellow band", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const home = readFileSync(path.join(here, "..", "..", "components", "public", "use-junction-home-content.tsx"), "utf8");
  const weeks = home.indexOf("<HomeWeeksChapter />");
  const terminal = home.indexOf("<HomeTerminal />");
  const paidTwice = home.indexOf("<HomePaidTwiceBand />");
  expect(weeks).toBeGreaterThan(0);
  expect(terminal).toBeGreaterThan(weeks);
  expect(terminal).toBeLessThan(paidTwice);

  // The strip sits directly on the yellow band: the band has no gap of its own above it.
  const story = readFileSync(path.join(here, "..", "..", "components", "public", "home-story.tsx"), "utf8");
  const band = story.match(/<section aria-labelledby="home-paid-twice-heading" className="([^"]*)"/);
  expect(band?.[1]).toContain("bg-brand-yellow");
  expect(band?.[1]).not.toMatch(/\bmt-/);

  // The comparison page tells people the same command the homepage does.
  expect(compareCcusage.compareRows?.find((entry) => entry.feature === "How you run it")?.usejunction).toBe(HOME_TERMINAL_COMMAND);
});
