// Turns raw product screenshots into framed blog images (Larridin-style: real UI on a brand backdrop).
// Raw files live in apps/admin/blog-src/<slug>/<name>.png (gitignored, may contain real emails).
// Output goes to public/blog/<slug>/<name>.webp at 2x.
//
//   node scripts/frame-screenshots.mjs                 # every shot
//   node scripts/frame-screenshots.mjs claude-team     # shots whose slug or name contains "claude-team"
//
// Per shot options (all coordinates are in the raw screenshot's pixels):
//   crop:      [x, y, w, h]            keep only this area
//   blur:      [[x, y, w, h], ...]     blur emails, names, org ids
//   highlight: [{ box: [x, y, w, h], label?: "Export spend report", below?: true, labelAt?: [x, y] }]
//              yellow box + label; label sits above the box, below it with `below`, or at `labelAt` (raw px)
//   frame:     "window" | "bare"       macOS-style window chrome, or just a rounded card
//   backdrop:  "teal" | "yellow" | "paper" | "none"
//   width:     output CSS width in px (rendered at 2x). Default 1200.
//   title:     text in the window title bar

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const root = new URL("..", import.meta.url).pathname;
const srcRoot = join(root, "blog-src");
const outRoot = join(root, "public", "blog");

const C = {
  paper: "#f3f2ea",
  ink: "#111210",
  teal: "#08758a",
  tealDark: "#075e6d",
  tealPale: "#dceef1",
  yellow: "#e5ec67",
  line: "#c9c8bd",
};

const BACKDROPS = {
  teal: `radial-gradient(120% 90% at 15% 10%, #0d8ea6 0%, ${C.teal} 45%, ${C.tealDark} 100%)`,
  yellow: `radial-gradient(120% 90% at 15% 10%, #f4f7a8 0%, ${C.yellow} 55%, #c9d04a 100%)`,
  paper: `linear-gradient(${C.line}33 1px, transparent 1px) 0 0 / 32px 32px, linear-gradient(90deg, ${C.line}33 1px, transparent 1px) 0 0 / 32px 32px, ${C.paper}`,
  none: "transparent",
};

// Fill this in as screenshots arrive. Key = slug folder under blog-src/.
const SHOTS = {
  "check-claude-team-usage": [
    { name: "claude-account-menu", title: "claude.ai", crop: [0, 700, 1500, 1100], backdrop: "yellow", width: 900,
      highlight: [{ box: [20, 1722, 420, 64], label: "1. Click your initials", labelAt: [620, 1716] }, { box: [40, 1132, 490, 64], label: "2. Analytics", labelAt: [760, 1128] }] },
    // claude.ai Analytics, Team plan, Owner view. 2880-wide renders; org and members anonymised at capture time.
    { name: "claude-analytics-overview", title: "claude.ai / analytics", crop: [0, 0, 2880, 2200], backdrop: "paper", width: 1400,
      highlight: [{ box: [728, 528, 578, 242], label: "Active members vs seats" }, { box: [1641, 1705, 885, 363], label: "Members, by chats", below: true }] },
    { name: "claude-code-analytics", title: "claude.ai / analytics / claude-code", crop: [0, 0, 2880, 2450], backdrop: "teal", width: 1400,
      highlight: [{ box: [200, 500, 440, 70], label: "Claude Code page" }, { box: [2300, 1712, 180, 70], label: "Export all users (CSV)" }] },
    // 2880x1800 renders of the live dashboard (team and people already anonymised at capture time).
    { name: "uj-claude-limits", title: "usejunction.dev / cost / claude", crop: [0, 0, 2880, 1900], backdrop: "teal", width: 1400,
      highlight: [{ box: [600, 1148, 330, 50], label: "Seat type", below: true }, { box: [1110, 1110, 820, 70], label: "Weekly limit, right now" }] },
    { name: "uj-people", title: "usejunction.dev / people", crop: [0, 0, 2880, 1800], backdrop: "paper", width: 1400 },
    { name: "uj-tool-accounts", title: "usejunction.dev / tool accounts", crop: [0, 0, 2880, 1800], backdrop: "yellow", width: 1400,
      highlight: [{ box: [1370, 630, 700, 220], label: "Personal logins the company also pays a seat for" }] },
  ],
  // "check-claude-team-usage": [
  //   { name: "claude-analytics-menu", title: "claude.ai", crop: [0, 0, 1440, 900], blur: [[1200, 20, 200, 30]],
  //     highlight: [{ box: [20, 820, 220, 40], label: "Analytics" }], backdrop: "teal" },
  // ],
};

function dataUrl(path) {
  const type = extname(path).toLowerCase() === ".jpg" || extname(path).toLowerCase() === ".jpeg" ? "jpeg" : "png";
  return `data:image/${type};base64,${readFileSync(path).toString("base64")}`;
}

function html(shot, src) {
  const backdrop = BACKDROPS[shot.backdrop ?? "teal"];
  const padded = (shot.backdrop ?? "teal") !== "none";
  const width = shot.width ?? 1200;
  const chrome =
    (shot.frame ?? "window") === "window"
      ? `<div class="bar"><i></i><i></i><i></i><span>${shot.title ?? ""}</span></div>`
      : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: transparent; font-family: "Avenir Next", Helvetica, sans-serif; }
    #stage { width: ${width}px; padding: ${padded ? "56px 64px" : "0"}; background: ${backdrop}; border-radius: ${padded ? 20 : 0}px; display: inline-block; }
    .card { background: #fff; border-radius: 12px; overflow: hidden; border: 1px solid ${C.ink}22;
      box-shadow: 0 30px 60px -20px rgba(17,18,16,.45), 0 12px 24px -12px rgba(17,18,16,.3); }
    .bar { height: 34px; display: flex; align-items: center; gap: 7px; padding: 0 14px; background: #f6f6f3; border-bottom: 1px solid ${C.ink}14; }
    .bar i { width: 11px; height: 11px; border-radius: 50%; background: #d9d8d0; }
    .bar i:nth-child(1) { background: #ec6a5e; } .bar i:nth-child(2) { background: #f4bf4f; } .bar i:nth-child(3) { background: #61c554; }
    .bar span { flex: 1; text-align: center; margin-right: 54px; font: 500 12px Menlo, monospace; color: #77776f; }
    canvas { display: block; width: 100%; height: auto; }
  </style></head><body><div id="stage"><div class="card">${chrome}<canvas id="c"></canvas></div></div>
  <script>
    const shot = ${JSON.stringify(shot)};
    const img = new Image();
    img.onload = () => {
      const [cx, cy, cw, ch] = shot.crop ?? [0, 0, img.naturalWidth, img.naturalHeight];
      const c = document.getElementById("c");
      c.width = cw; c.height = ch;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
      for (const [x, y, w, h] of shot.blur ?? []) {
        ctx.save();
        ctx.beginPath(); ctx.rect(x - cx, y - cy, w, h); ctx.clip();
        ctx.filter = "blur(" + Math.max(8, Math.round(h / 2.5)) + "px)";
        ctx.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
        ctx.restore();
      }
      const scale = cw / 1000;
      for (const { box: [x, y, w, h], label, below, labelAt } of shot.highlight ?? []) {
        ctx.lineWidth = Math.max(3, 4 * scale);
        ctx.strokeStyle = "${C.yellow}";
        ctx.shadowColor = "rgba(17,18,16,.35)"; ctx.shadowBlur = 6 * scale;
        ctx.beginPath(); ctx.roundRect(x - cx - 4, y - cy - 4, w + 8, h + 8, 8 * scale); ctx.stroke();
        ctx.shadowBlur = 0;
        if (label) {
          const size = Math.round(Math.max(14, 17 * scale));
          ctx.font = "700 " + size + "px 'Avenir Next', Helvetica, sans-serif";
          const tw = ctx.measureText(label).width + size * 1.2;
          const th = size * 1.9;
          let lx = x - cx - 4, ly = y - cy - 4 - th - 6;
          if (below || ly < 0) ly = y - cy + h + 10;
          if (labelAt) { lx = labelAt[0] - cx; ly = labelAt[1] - cy; }
          if (lx + tw > cw) lx = cw - tw - 6;
          ctx.fillStyle = "${C.yellow}"; ctx.beginPath(); ctx.roundRect(lx, ly, tw, th, 6 * scale); ctx.fill();
          ctx.strokeStyle = "${C.ink}"; ctx.lineWidth = 2 * scale; ctx.stroke();
          ctx.fillStyle = "${C.ink}"; ctx.textBaseline = "middle"; ctx.fillText(label, lx + size * 0.6, ly + th / 2);
        }
      }
      document.body.dataset.ready = "1";
    };
    img.onerror = () => { document.body.dataset.ready = "error"; };
    img.src = ${JSON.stringify(src)};
  </script></body></html>`;
}

const filter = process.argv[2];
const browser = await chromium.launch();
let count = 0;

for (const [slug, shots] of Object.entries(SHOTS)) {
  for (const shot of shots) {
    if (filter && !slug.includes(filter) && !shot.name.includes(filter)) continue;
    const raw = ["png", "jpg", "jpeg"].map((ext) => join(srcRoot, slug, `${shot.name}.${ext}`)).find(existsSync);
    if (!raw) {
      console.warn(`missing ${slug}/${shot.name}.png in blog-src/`);
      continue;
    }
    // One page per shot: reusing a page across large data-URL images made the ready flag flaky.
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    page.on("pageerror", (err) => console.error("page error:", err.message));
    await page.setContent(html(shot, dataUrl(raw)), { waitUntil: "load" });
    await page.waitForSelector("body[data-ready]", { state: "attached", timeout: 60000 });
    if ((await page.getAttribute("body", "data-ready")) !== "1") { console.error(`image failed to decode: ${raw}`); await page.close(); continue; }
    const dir = join(outRoot, slug);
    mkdirSync(dir, { recursive: true });
    const png = join(dir, `${shot.name}.png`);
    await page.locator("#stage").screenshot({ path: png, omitBackground: true });
    execFileSync("cwebp", ["-quiet", "-q", "88", png, "-o", join(dir, `${shot.name}.webp`)]);
    execFileSync("rm", [png]);
    const size = await page.locator("#stage").boundingBox();
    console.log(`framed ${slug}/${shot.name}.webp  (${Math.round(size.width)}x${Math.round(size.height)} css px)`);
    await page.close();
    count += 1;
  }
}

await browser.close();
if (!count) console.log("nothing framed — add raw files to blog-src/<slug>/ and entries to SHOTS");
