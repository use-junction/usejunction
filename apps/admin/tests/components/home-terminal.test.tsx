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

test("the homepage strip offers the terminal table: one command to copy, no account, nothing uploaded", async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  render(<HomeTerminal />);
  const section = screen.getByRole("region", { name: HEADING });

  expect(within(section).getByText("No account. Nothing leaves your machine.")).toBeTruthy();
  // The command is plain text from the first paint: it is not typed out or animated.
  expect(within(section).getByText(HOME_TERMINAL_COMMAND)).toBeTruthy();
  expect(HOME_TERMINAL_COMMAND).toBe("npx usejunction");

  // The command is the only button: clicking it copies it, with no separate copy button beside it.
  const command = within(section).getByRole("button");
  expect(command.getAttribute("aria-label")).toBe("Copy npx usejunction");
  fireEvent.click(command);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("npx usejunction"));
  expect(await within(command).findByText("Copied")).toBeTruthy();
});

test("the strip stays one line: a small graph and one readout, with no table, tabs, link or example label", () => {
  render(<HomeTerminal />);
  const section = screen.getByRole("region", { name: HEADING });

  for (const role of ["figure", "table", "tablist", "link"]) {
    expect(within(section).queryByRole(role)).toBeNull();
  }
  expect(section.textContent).not.toMatch(/ccusage|Example/i);
  expect(within(section).getByRole("img", { name: /spend rising over the last 30 days/ })).toBeTruthy();
});

test("once on screen the number counts up and the readout takes turns: total spent, next month, the plans we recommend", () => {
  vi.useFakeTimers();
  const scrollIntoView = stubScrollIntoView();

  render(<HomeTerminal />);
  const section = screen.getByRole("region", { name: HEADING });
  const graph = within(section).getByRole("img");

  // Off screen it waits on the first readout, drawn finished.
  act(() => void vi.advanceTimersByTime(10_000));
  expect(shown(section)).toBe("Total spent$412.60");

  scrollIntoView();
  act(() => void vi.advanceTimersByTime(300));
  const counting = Number(shown(section)!.replace("Total spent$", ""));
  expect(counting).toBeGreaterThan(0);
  expect(counting).toBeLessThan(412.6);
  act(() => void vi.advanceTimersByTime(900));
  expect(shown(section)).toBe("Total spent$412.60");
  // The dashed stretch of the graph is next month's, so it is not drawn yet.
  expect(graph.getAttribute("data-ahead")).toBe("false");

  // 1.2s of the first turn are gone; each swap is followed by a second for the number to count up.
  act(() => void vi.advanceTimersByTime(3600 - 1200));
  expect(shown(section)).toMatch(/^Estimated next month/);
  act(() => void vi.advanceTimersByTime(1200));
  expect(shown(section)).toBe("Estimated next month$430");
  expect(graph.getAttribute("data-ahead")).toBe("true");

  act(() => void vi.advanceTimersByTime(3600 - 1200));
  expect(shown(section)).toBe("We recommendClaude Max $100+ChatGPT Plus $20");
  expect(graph.getAttribute("data-ahead")).toBe("true");

  act(() => void vi.advanceTimersByTime(3600));
  act(() => void vi.advanceTimersByTime(1200));
  expect(shown(section)).toBe("Total spent$412.60");
  expect(graph.getAttribute("data-ahead")).toBe("false");
});

test("pointing at the strip holds the readout, and it carries on afterwards", () => {
  vi.useFakeTimers();
  const scrollIntoView = stubScrollIntoView();

  render(<HomeTerminal />);
  const section = screen.getByRole("region", { name: HEADING });
  scrollIntoView();

  fireEvent.mouseEnter(section);
  act(() => void vi.advanceTimersByTime(10_000));
  expect(shown(section)).toBe("Total spent$412.60");

  fireEvent.mouseLeave(section);
  act(() => void vi.advanceTimersByTime(3600));
  act(() => void vi.advanceTimersByTime(1200));
  expect(shown(section)).toBe("Estimated next month$430");
});

test("with reduced motion the numbers do not count up", () => {
  vi.useFakeTimers();
  const scrollIntoView = stubScrollIntoView();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));

  render(<HomeTerminal />);
  const section = screen.getByRole("region", { name: HEADING });
  scrollIntoView();
  act(() => void vi.advanceTimersByTime(100));
  expect(shown(section)).toBe("Total spent$412.60");
});

test("the strip sits below the first story section, not under the hero", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const home = readFileSync(path.join(here, "..", "..", "components", "public", "use-junction-home-content.tsx"), "utf8");
  const weeks = home.indexOf("<HomeWeeksChapter />");
  const terminal = home.indexOf("<HomeTerminal />");
  const paidTwice = home.indexOf("<HomePaidTwiceBand />");
  expect(weeks).toBeGreaterThan(0);
  expect(terminal).toBeGreaterThan(weeks);
  expect(terminal).toBeLessThan(paidTwice);

  // The comparison page tells people the same command the homepage does.
  expect(compareCcusage.compareRows?.find((entry) => entry.feature === "How you run it")?.usejunction).toBe(HOME_TERMINAL_COMMAND);
});
