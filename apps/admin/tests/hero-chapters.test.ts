import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { HERO_CHAPTERS, HERO_VIDEO } from "@/lib/public/home-cta";

// The chapter strip under the hero film is timed by hand against the film's source. If a scene is re-timed and the
// film re-rendered, the strip would light up the wrong chapter; this keeps the two in step.
test("hero chapter strip starts each chapter where the film's scene starts", () => {
  const film = readFileSync(path.resolve(__dirname, "../../../video/hero-loop/hero-loop.html"), "utf8");
  const scenes = film.match(/const S=\{W:([\d.]+),C:([\d.]+),B:([\d.]+),E:([\d.]+),F:([\d.]+),END:([\d.]+)\}/);
  expect(scenes, "scene timings `S` in video/hero-loop/hero-loop.html").not.toBeNull();
  const [work, forecast, see, privacy, endCard, end] = scenes!.slice(1).map(Number);

  expect(HERO_CHAPTERS.map((chapter) => chapter.start)).toEqual([work, forecast, see, privacy]);
  expect(HERO_VIDEO.duration).toBe(end);
  // Each still frame falls inside its own chapter; the last one before the end card takes over.
  const ends = [forecast, see, privacy, endCard];
  HERO_CHAPTERS.forEach((chapter, index) => {
    expect(chapter.still).toBeGreaterThan(chapter.start);
    expect(chapter.still).toBeLessThan(ends[index]!);
  });
});
