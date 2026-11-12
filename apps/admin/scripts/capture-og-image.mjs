// Captures the homepage hero as the link-preview image (og:image / twitter:image).
// Re-run after the hero changes so shared links don't show an old homepage.
//
//   node scripts/capture-og-image.mjs                          # http://localhost:3001
//   node scripts/capture-og-image.mjs https://usejunction.dev
//
// Writes public/og-home-v2.png at 1200x630, the size chat and social apps expect.
// The hero film is paused on FRAME_SECONDS so every capture shows the same moment.
// If you rename the output, update siteOgImage in lib/public/seo-metadata.ts.

import { join } from "node:path";
import { chromium } from "playwright";

const root = new URL("..", import.meta.url).pathname;
const out = join(root, "public", "og-home-v2.png");
const url = process.argv[2] ?? "http://localhost:3001";
const WIDTH = 1200;
const HEIGHT = 630;
const FRAME_SECONDS = Number(process.env.OG_FRAME_SECONDS ?? 7.5);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(async (seconds) => {
    const video = document.querySelector("video");
    if (!video) throw new Error("No hero video on the page");
    video.pause();
    if (video.readyState < 2) await new Promise((r) => video.addEventListener("loadeddata", r, { once: true }));
    await new Promise((r) => {
      video.addEventListener("seeked", r, { once: true });
      video.currentTime = seconds;
    });
  }, FRAME_SECONDS);
  // The paused film shows a Play button; a link preview shouldn't.
  await page.addStyleTag({ content: 'button[aria-label="Play video"], button[aria-label="Pause video"] { display: none !important; }' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out });
  console.log(`Wrote ${out}`);
} finally {
  await browser.close();
}
