// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HomeTerminal } from "../../components/public/home-terminal";
import { compareCcusage } from "../../content/compare";
import { HOME_TERMINAL_COMMAND, HOME_TERMINAL_COMPARE_HREF } from "../../lib/public/home-cta";

afterEach(cleanup);

test("the homepage offers the terminal table: one command to copy, no account, nothing uploaded", async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  render(<HomeTerminal />);
  const section = screen.getByRole("region", { name: "Or see your own number first, in the terminal." });

  expect(within(section).getByText(/No account\. Nothing leaves your machine\./)).toBeTruthy();
  // The command is shown twice: once to copy, once at the top of the example.
  expect(within(section).getAllByText(HOME_TERMINAL_COMMAND)).toHaveLength(2);
  expect(HOME_TERMINAL_COMMAND).toBe("npx usejunction");

  fireEvent.click(within(section).getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("npx usejunction"));
  expect(await within(section).findByRole("button", { name: "Copied" })).toBeTruthy();

  const compare = within(section).getByRole("link", { name: /How it compares with ccusage/ });
  expect(compare.getAttribute("href")).toBe("/compare/ccusage");
});

test("the terminal block is marked as an example and says the numbers are estimates", () => {
  render(<HomeTerminal />);
  const figure = screen.getByRole("figure");

  expect(within(figure).getByText(/^Example output\./)).toBeTruthy();
  expect(within(figure).getByText("Estimated at API list prices from local logs, not your bill.")).toBeTruthy();

  // The example adds up, so nobody checking the math finds it wrong.
  const lines = within(figure).getAllByRole("row");
  const costOf = (line: HTMLElement) => Number(within(line).getAllByRole("cell").at(-1)!.textContent!.replace("$", ""));
  const days = lines.slice(1, -1).map(costOf);
  const sum = days.reduce((total, cost) => total + cost, 0);
  expect(costOf(lines.at(-1)!)).toBeCloseTo(sum, 2);
});

test("the section sits right after the tool logos, and its link has a page behind it", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const home = readFileSync(path.join(here, "..", "..", "components", "public", "use-junction-home-content.tsx"), "utf8");
  const logos = home.indexOf("<ToolLogosStrip />");
  const terminal = home.indexOf("<HomeTerminal />");
  const nextSection = home.indexOf("<HomeWeeksChapter />");
  expect(logos).toBeGreaterThan(0);
  expect(terminal).toBeGreaterThan(logos);
  expect(terminal).toBeLessThan(nextSection);

  expect(compareCcusage.path).toBe(HOME_TERMINAL_COMPARE_HREF);
  // The page tells people the same command the homepage does.
  expect(compareCcusage.compareRows?.find((entry) => entry.feature === "How you run it")?.usejunction).toBe(HOME_TERMINAL_COMMAND);
});
