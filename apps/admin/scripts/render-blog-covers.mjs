// Renders poster-style blog covers (1200x630) from HTML templates.
// Each cover is written as <slug>/cover.webp (hero) and <slug>/social.png (Open Graph).
//
//   node scripts/render-blog-covers.mjs            # all covers
//   node scripts/render-blog-covers.mjs codexbar   # covers whose slug contains "codexbar"

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const root = new URL("..", import.meta.url).pathname;
const outRoot = join(root, "public", "blog");

const C = {
  paper: "#f3f2ea",
  ink: "#111210",
  teal: "#08758a",
  tealDark: "#075e6d",
  tealPale: "#dceef1",
  yellow: "#e5ec67",
  yellowDark: "#838a20",
  line: "#c9c8bd",
  muted: "#8a8a80",
};

const shell = (title, body, footer) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 1200px; height: 630px; background: ${C.paper}; font-family: "Avenir Next", Helvetica, sans-serif; color: ${C.ink}; overflow: hidden; position: relative; }
  .grid { position: absolute; inset: 0; background-image: linear-gradient(${C.line}33 1px, transparent 1px), linear-gradient(90deg, ${C.line}33 1px, transparent 1px); background-size: 40px 40px; }
  h1 { position: absolute; left: 64px; top: 52px; right: 64px; font-family: "Avenir Next Condensed"; font-weight: 800; font-size: 74px; line-height: 0.95; letter-spacing: -0.5px; text-transform: uppercase; color: ${C.ink}; }
  .stage { position: absolute; left: 64px; right: 64px; top: 230px; bottom: 92px; }
  .foot { position: absolute; left: 64px; right: 64px; bottom: 36px; display: flex; justify-content: space-between; align-items: flex-end; border-top: 2px solid ${C.yellowDark}55; padding-top: 14px; font: 600 17px/1 Menlo, monospace; letter-spacing: 2px; text-transform: uppercase; color: ${C.ink}; }
  .brand { display: flex; gap: 10px; align-items: center; letter-spacing: 1px; text-transform: none; font-family: "Avenir Next"; font-weight: 700; font-size: 19px; }
  .brand i { display: inline-block; width: 16px; height: 16px; background: ${C.yellow}; border: 2px solid ${C.ink}; }
  .mono { font-family: Menlo, monospace; }
</style></head><body><div class="grid"></div><h1>${title}</h1><div class="stage">${body}</div>
<div class="foot"><span>${footer}</span><span class="brand"><i></i>usejunction.dev</span></div></body></html>`;

const gauge = (pct, color, w = 150) => `
  <div style="width:${w}px;height:12px;border:2px solid ${C.ink};background:#fff">
    <div style="width:${pct}%;height:100%;background:${color}"></div>
  </div>`;

const covers = [
  {
    slug: "codexbar-for-teams",
    html: () => {
      const team = [92, 35, 78, 10, 64, 100, 48, 22, 85, 0, 57, 71];
      const cells = team
        .map((pct, i) => {
          const color = pct >= 90 ? C.yellow : pct === 0 ? C.line : C.teal;
          return `<div style="border:2px solid ${pct === 0 ? C.line : C.ink};background:#fff;padding:10px 12px;opacity:${pct === 0 ? 0.6 : 1}">
            <div class="mono" style="font-size:12px;color:${C.muted};margin-bottom:8px">DEV-${String(i + 1).padStart(2, "0")} · ${pct === 0 ? "NO DATA" : pct + "%"}</div>
            ${gauge(pct, color, 128)}
          </div>`;
        })
        .join("");
      return shell(
        "One menu bar.<br>Every developer.",
        `<div style="display:flex;height:100%;gap:40px;align-items:center">
          <div style="width:330px">
            <div style="border:2px solid ${C.ink};background:${C.ink};color:#fff;padding:8px 14px;display:flex;justify-content:space-between;font:600 14px Menlo">
              <span>Codex</span><span>62% · resets 3h</span>
            </div>
            <div style="border:2px solid ${C.ink};border-top:0;background:#fff;padding:16px 14px">
              <div class="mono" style="font-size:12px;color:${C.muted};margin-bottom:8px">YOUR WEEKLY LIMIT</div>
              ${gauge(62, C.teal, 296)}
              <div class="mono" style="font-size:12px;color:${C.muted};margin:16px 0 8px">CLAUDE CODE</div>
              ${gauge(40, C.teal, 296)}
            </div>
          </div>
          <div style="width:2px;align-self:stretch;background:${C.yellowDark}88;position:relative">
            <div style="position:absolute;top:50%;left:-7px;width:16px;height:16px;border-radius:50%;background:${C.yellowDark}"></div>
          </div>
          <div style="flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:10px">${cells}</div>
        </div>`,
        "Personal &nbsp;→&nbsp; Team",
      );
    },
  },
  {
    slug: "ai-coding-observability-vs-jellyfish-dx-linearb",
    html: () => {
      const rows = [
        ["PRs sit for 3 days", "LinearB", false],
        ["Developers are leaving", "DX", false],
        ["Board wants R&D allocation", "Jellyfish", false],
        ["Our Cursor + Claude bill is insane", "UseJunction", true],
      ];
      const lanes = rows
        .map(
          ([pain, tool, hit]) => `<div style="display:grid;grid-template-columns:1fr 90px 260px;align-items:center;gap:0;margin-bottom:12px">
            <div style="border:2px solid ${hit ? C.ink : C.line};background:${hit ? "#fff" : "#ffffff88"};padding:12px 16px;font:600 22px 'Avenir Next';color:${hit ? C.ink : C.muted}">“${pain}”</div>
            <div style="height:2px;background:${hit ? C.ink : C.line};position:relative"><div style="position:absolute;right:-2px;top:-6px;border-left:12px solid ${hit ? C.ink : C.line};border-top:7px solid transparent;border-bottom:7px solid transparent"></div></div>
            <div style="border:2px solid ${hit ? C.ink : C.line};background:${hit ? C.yellow : "transparent"};padding:12px 16px;font:700 22px 'Avenir Next Condensed';text-transform:uppercase;letter-spacing:1px;color:${hit ? C.ink : C.muted}">${tool}</div>
          </div>`,
        )
        .join("");
      return shell("Four searches.<br>Four different tools.", `<div style="padding-top:2px">${lanes}</div>`, "Pain &nbsp;→&nbsp; Tool");
    },
  },
  {
    slug: "what-is-ai-coding-observability",
    html: () => {
      const layers = ["Adoption", "Cost", "Model usage", "Reliability", "Plan utilization"];
      const stack = layers
        .map(
          (name, i) => `<div style="width:${360 + i * 44}px;margin:0 0 8px;border:2px solid ${C.ink};background:${i === 0 ? C.yellow : "#fff"};padding:7px 16px;display:flex;justify-content:space-between;font:600 19px 'Avenir Next'">
            <span>${name}</span><span class="mono" style="font-size:13px;color:${C.muted}">L${i + 1}</span></div>`,
        )
        .join("");
      return shell(
        "Visibility<br>before control.",
        `<div style="display:flex;height:100%;align-items:center;gap:48px">
          <div style="flex:1">${stack}</div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
            <div class="mono" style="font-size:13px;color:${C.muted}">THEN</div>
            <div style="height:60px;width:2px;background:${C.line}"></div>
            <div style="border:2px dashed ${C.line};padding:16px 28px;font:700 26px 'Avenir Next Condensed';letter-spacing:1px;color:${C.muted};text-transform:uppercase">Control</div>
          </div>
        </div>`,
        "Observe &nbsp;→&nbsp; Decide &nbsp;→&nbsp; Control",
      );
    },
  },
  {
    slug: "see-my-teams-ai-spend",
    html: () => {
      const tools = [
        ["Cursor", 38, C.teal],
        ["Claude Code", 31, C.tealDark],
        ["Codex", 17, C.teal],
        ["Copilot", 9, C.tealDark],
        ["Idle seats", 5, C.yellow],
      ];
      const bars = tools
        .map(
          ([name, pct, color]) => `<div style="display:grid;grid-template-columns:130px 1fr 56px;align-items:center;gap:14px;margin-bottom:12px">
            <span style="font:600 20px 'Avenir Next'">${name}</span>
            <div style="height:26px;border:2px solid ${C.ink};background:#fff"><div style="width:${pct * 2.4}%;height:100%;background:${color}"></div></div>
            <span class="mono" style="font-size:16px;text-align:right">${pct}%</span>
          </div>`,
        )
        .join("");
      const split = [["By tool", true], ["By developer", false], ["By team", false], ["By model", false]]
        .map(
          ([label, on]) => `<div style="border:2px solid ${on ? C.ink : C.line};background:${on ? C.yellow : "transparent"};padding:10px 16px;font:700 18px 'Avenir Next Condensed';letter-spacing:1px;text-transform:uppercase;color:${on ? C.ink : C.muted};margin-bottom:10px">${label}</div>`,
        )
        .join("");
      return shell(
        "Where did the<br>AI bill go?",
        `<div style="display:flex;gap:48px;height:100%;align-items:center">
          <div style="flex:1"><div class="mono" style="font-size:13px;color:${C.muted};margin-bottom:14px">SHARE OF MONTHLY AI CODING SPEND · EXAMPLE</div>${bars}</div>
          <div style="width:220px">${split}</div>
        </div>`,
        "Tool &nbsp;→&nbsp; Developer &nbsp;→&nbsp; Waste",
      );
    },
  },
];

const filter = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });

for (const cover of covers.filter((item) => !filter || item.slug.includes(filter))) {
  const dir = join(outRoot, cover.slug);
  mkdirSync(dir, { recursive: true });
  await page.setContent(cover.html(), { waitUntil: "load" });
  const png = join(dir, "social.png");
  await page.screenshot({ path: png });
  execFileSync("cwebp", ["-quiet", "-q", "86", png, "-o", join(dir, "cover.webp")]);
  console.log(`rendered ${cover.slug}`);
}

await browser.close();
