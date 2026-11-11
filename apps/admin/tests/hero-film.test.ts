import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const film = readFileSync(path.resolve(__dirname, "../../../video/hero-loop/hero-loop.html"), "utf8");

// The hero film opens on its hook: what one finished feature cost, then the question the product answers.
test("hero film opens on the hook: one feature's cost, then what the next one will cost", () => {
  expect(film).toContain('id="hk1">One feature. $6,930 in AI.</span>');
  expect(film).toMatch(/id="hk2">What will the <span class="hlw"><i id="hk2hl"><\/i><b>next one<\/b><\/span> cost\?/);
});

// It sits on the white page with no frame, so no scene may be drawn on black.
test("every hero film scene is drawn on white, the Forecast included", () => {
  const scenes = [...film.matchAll(/<section class="sc (\w+)" id="(\w)"/g)].map(([, tone, id]) => [id, tone]);
  expect(scenes).toEqual([
    ["D", "light"],
    ["C", "light"],
    ["B", "light"],
    ["E", "light"],
    ["F", "light"],
  ]);
  expect(film).not.toContain(".dark{");
  expect(film).toMatch(/#stage\{[^}]*background:#fff\}/);
});
