// Renders the homepage hero loop (video/hero-loop/hero-loop.html) to the files the hero plays.
//
//   node video/hero-loop/render.mjs            render frames, encode videos and the poster
//   node video/hero-loop/render.mjs --preview  only write the self-contained preview page
//
// Needs ffmpeg with libx264 and libvpx-vp9, and network access for the DM Sans and JetBrains Mono web fonts.
// Writes apps/admin/public/video/hero-loop{,-mobile}.{mp4,webm} and hero-loop-poster.jpg.
// The hero lists the H.264 MP4s first (smaller here); the VP9 WebMs are for browsers without H.264, such as
// Playwright's Chromium and some Linux Chromium builds.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const here = path.join(root, "video/hero-loop");
const publicDir = path.join(root, "apps/admin/public");
const outDir = path.join(publicDir, "video");

const FPS = 30;
/** Must match S.END in hero-loop.html. */
const DURATION = 18.7;
/** The hook frame: "One feature. $6,930 in AI." on the merged ticket. */
const POSTER_AT = 1.5;

const ASSETS = {
  calsans: [path.join(here, "assets/cal-sans.ttf"), "font/ttf"],
  claude: [path.join(publicDir, "tool-logos/claude.svg"), "image/svg+xml"],
  cursor: [path.join(publicDir, "tool-logos/cursor.svg"), "image/svg+xml"],
  codex: [path.join(publicDir, "tool-logos/chatgpt.svg"), "image/svg+xml"],
  copilot: [path.join(publicDir, "tool-logos/copilot.svg"), "image/svg+xml"],
  wordmark: [path.join(publicDir, "usejunction.png"), "image/png"],
  f0: [path.join(here, "assets/people/marcus.jpg"), "image/jpeg"],
  f1: [path.join(here, "assets/people/priya.jpg"), "image/jpeg"],
  f2: [path.join(here, "assets/people/tom.jpg"), "image/jpeg"],
  f3: [path.join(here, "assets/people/amara.jpg"), "image/jpeg"],
};

async function buildPage(file) {
  let html = await fs.readFile(path.join(here, "hero-loop.html"), "utf8");
  for (const [key, [src, mime]] of Object.entries(ASSETS)) {
    const data = (await fs.readFile(src)).toString("base64");
    html = html.replaceAll(`{{${key}}}`, `data:${mime};base64,${data}`);
  }
  const left = html.match(/\{\{[a-z0-9_]+\}\}/);
  if (left) throw new Error(`Unfilled placeholder ${left[0]}`);
  await fs.writeFile(file, html);
}

async function captureFrames(page, framesDir) {
  const require = createRequire(path.join(root, "apps/admin/package.json"));
  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch();
  const tab = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 2 });
  await tab.goto(`file://${page}`);
  await tab.addStyleTag({ content: ".wrap{max-width:none;width:800px;margin:0}.frame{border:0;width:800px}.ctl{display:none}" });
  await tab.evaluate(() => document.fonts.ready);
  const fontsOk = await tab.evaluate(() => ["30px 'Cal Sans'", "600 20px 'DM Sans'", "500 12px 'JetBrains Mono'"].every((f) => document.fonts.check(f)));
  if (!fontsOk) throw new Error("Web fonts did not load; frames would render in a fallback font");
  const stage = tab.locator("#stage");
  const total = Math.round(DURATION * FPS);
  for (let i = 0; i < total; i++) {
    await tab.evaluate((t) => window.__setT(t), i / FPS);
    await stage.screenshot({ path: path.join(framesDir, `${String(i).padStart(4, "0")}.png`) });
    if (i % 60 === 0) process.stdout.write(`frame ${i}/${total}\n`);
  }
  await tab.evaluate((t) => window.__setT(t), POSTER_AT);
  await stage.screenshot({ path: path.join(framesDir, "poster.png") });
  await browser.close();
}

async function encode(framesDir) {
  const input = ["-y", "-hide_banner", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(framesDir, "%04d.png")];
  // Tag the colour space so browsers decode the white background as the page's white, not a grey box.
  const BT709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
  const h264 = (w, crf) => [...input, "-vf", `scale=${w}:-2:flags=lanczos:out_color_matrix=bt709`, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p", ...BT709, "-movflags", "+faststart", "-an"];
  const vp9 = (w, crf) => [...input, "-vf", `scale=${w}:-2:flags=lanczos:out_color_matrix=bt709`, "-c:v", "libvpx-vp9", "-crf", String(crf), "-b:v", "0", "-row-mt", "1", "-pix_fmt", "yuv420p", ...BT709, "-an"];
  const jobs = [
    [h264(1280, 22), "hero-loop.mp4"],
    [h264(960, 25), "hero-loop-mobile.mp4"],
    [vp9(1280, 38), "hero-loop.webm"],
    [vp9(960, 42), "hero-loop-mobile.webm"],
  ];
  for (const [args, name] of jobs) {
    await exec("ffmpeg", [...args, path.join(outDir, name)], { maxBuffer: 1 << 26 });
    process.stdout.write(`wrote ${name}\n`);
  }
  await exec("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", path.join(framesDir, "poster.png"), "-vf", "scale=1280:-2:flags=lanczos", "-q:v", "4", path.join(outDir, "hero-loop-poster.jpg")]);
  process.stdout.write("wrote hero-loop-poster.jpg\n");
}

const work = await fs.mkdtemp(path.join(os.tmpdir(), "hero-loop-"));
const page = path.join(work, "hero-loop.html");
await buildPage(page);
if (process.argv.includes("--preview")) {
  process.stdout.write(`preview: ${page}\n`);
} else {
  const framesDir = path.join(work, "frames");
  await fs.mkdir(framesDir);
  await captureFrames(page, framesDir);
  await encode(framesDir);
  await fs.rm(work, { recursive: true, force: true });
}
