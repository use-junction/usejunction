import { expect, test } from "@playwright/test";
import { SUPPORTED_TOOLS } from "../lib/public/config";

const teamInviteToken = process.env.E2E_TEAM_INVITE_TOKEN ?? "uj_team_e2e_calculation_invite";
const orgInviteToken = process.env.E2E_ORG_INVITE_TOKEN ?? "uj_invite_e2e_calculation_member";

const publicRoutes = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/contact",
  "/privacy",
  "/terms",
  "/dpa",
  "/subprocessors",
  "/gdpr",
  "/security",
  "/cookies",
  "/i/invalid-token",
  "/join/invalid-token",
  "/join/company/missing-org",
];

for (const route of publicRoutes) {
  test(`${route} renders without server or browser errors`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const response = await page.goto(route);
    expect(response?.status(), `${route} response`).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
    expect(pageErrors, `${route} page errors`).toEqual([]);
  });
}

test("unknown routes redirect unauthenticated visitors to sign in", async ({ page }) => {
  await page.goto("/this-route-does-not-exist");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: /Sign in to UseJunction/i })).toBeVisible();
});

test("landing page shows brand and primary CTA", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("UseJunction — AI Coding Spend & Usage for Claude, Cursor & Codex");
  await expect(page.locator("title")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "UseJunction home" }).first()).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /See where your AI coding spend goes\./i,
      level: 1,
    }),
  ).toBeVisible();

  // The strip names the paid tools; every supported tool is listed next to the FAQ.
  const toolStrip = page.getByRole("region", { name: "Supported AI coding tools" });
  await expect(toolStrip).toBeVisible();
  await expect(toolStrip.getByRole("img")).toHaveCount(0);
  for (const tool of ["Claude Code", "Cursor", "Codex", "GitHub Copilot"]) {
    await expect(toolStrip.getByText(tool, { exact: true })).toBeVisible();
  }
  await expect(toolStrip.getByRole("link", { name: `and ${SUPPORTED_TOOLS.length - 4} more` })).toHaveAttribute("href", "#tools");
  const allTools = page.getByRole("list", { name: "Supported tools" });
  for (const tool of SUPPORTED_TOOLS) {
    await expect(allTools.getByText(tool.name, { exact: true })).toBeVisible();
  }

  // A new visitor can sign up from the header, not only sign in.
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Start free" }).first()).toHaveAttribute("href", /^\/signup/);
  await expect(header.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/login");

  const heroCta = page.getByRole("main").getByRole("link", { name: "Start free" }).first();
  await expect(heroCta).toBeVisible();
  await expect(heroCta).toHaveAttribute("href", /^\/signup\?from=/);
  await expect(
    page.getByText("Free for 5 seats, then $1 per active developer a month. No card.").first(),
  ).toBeVisible();

  const video = page.getByLabel(/UseJunction product video/i);
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("poster", "/video/hero-loop-poster.jpg");
  await expect(video).toHaveJSProperty("muted", true);
  await expect(video).toHaveJSProperty("loop", true);
  // The loop actually loads and plays: the browser picked a source and the clock moves.
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentSrc)).toMatch(/\/video\/hero-loop(-mobile)?\.(mp4|webm)$/);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.5);

  // It does not present as a video player: no chapter strip, and the pause button appears only on hover.
  await expect(page.getByRole("group", { name: "Video chapters" })).toHaveCount(0);
  await video.hover();
  await page.getByRole("button", { name: "Pause video" }).click();
  await expect(video).toHaveJSProperty("paused", true);
  await expect(page.getByRole("button", { name: "Play video" })).toBeVisible();

  const closing = page.getByRole("region", { name: /Connect your own laptop first/i });
  await expect(closing.getByRole("link", { name: "Start free" })).toHaveAttribute("href", /^\/signup/);
});

test("homepage shows one picture per problem for the example team", async ({ page }) => {
  await page.goto("/");

  // Limits: two people, two bars, and what to do about each.
  const weeks = page.getByRole("region", { name: "You’ve probably had one of these weeks." });
  const limits = weeks.getByRole("figure", { name: /Priya at 97% of her weekly limit, Elena at 6%/ });
  await expect(limits.getByText("97%")).toBeVisible();
  await expect(limits.getByText("6%", { exact: true })).toBeVisible();
  await expect(limits.getByText("Move her to Premium").filter({ visible: true })).toBeVisible();
  await expect(limits.getByText("Does Elena still need hers?").filter({ visible: true })).toBeVisible();

  // Paid twice: two tools' seats for one person, one of them unopened.
  const paidTwice = page.getByRole("region", { name: "Paid twice." });
  for (const use of ["No usage", "on Claude models", "on Grok models", "Under 3% each"]) {
    await expect(paidTwice.getByText(use)).toBeVisible();
  }
  await expect(paidTwice.getByText("$360")).toHaveCSS("color", "rgb(200, 50, 30)");
  await expect(paidTwice.getByText("Cancel nine Cursor seats by 14 Dec").filter({ visible: true })).toBeVisible();

  // Work: one bar, split by where the spend landed. The three parts add up to the total.
  const work = page.getByRole("region", { name: "Where the AI spend landed." });
  const landed = work.getByRole("figure", { name: /\$61,480 of AI spend matched to work/ });
  for (const part of ["$35,120", "$17,140", "$9,220"]) {
    await expect(landed.getByText(part, { exact: true })).toBeVisible();
  }
  expect(35120 + 17140 + 9220).toBe(61480);
  await expect(landed.getByText("57% landed on work that merged").filter({ visible: true })).toBeVisible();

  // The sections this replaced are gone.
  await expect(page.getByRole("region", { name: "Who has started, and who needs a nudge." })).toHaveCount(0);
  await expect(page.locator('img[src*="/home/"]')).toHaveCount(0);
});

test("homepage answers each person who asks, with the example team's numbers", async ({ page }) => {
  await page.goto("/");

  const roles = page.getByRole("region", { name: "Someone is going to ask you." });
  for (const who of ["Engineering manager", "Developer", "Project manager", "Leadership", "Finance"]) {
    await expect(roles.getByText(who, { exact: true })).toBeVisible();
  }

  const people = roles.getByRole("figure", { name: /each person’s Claude and Cursor use/ });
  await expect(people.getByText("Near limit")).toBeVisible();
  await expect(people.getByText("$948")).toBeVisible();

  const myData = roles.getByRole("figure", { name: /each login with a sharing switch/ });
  await expect(myData.getByRole("img", { name: "Sharing on" })).toBeVisible();
  await expect(myData.getByRole("list", { name: "Never collected" }).getByRole("listitem")).toHaveCount(4);

  // Spend per Jira ticket, grouped the way the board is.
  const board = roles.getByRole("figure", { name: /Jira board/ });
  const inProgress = board.getByRole("region", { name: "In progress" });
  await expect(inProgress.getByRole("listitem").filter({ hasText: "NW-224" })).toContainText("AI spend $1,819");
  await expect(inProgress.getByText("Not moving")).toBeVisible();
  // The same ticket as the comparison's last row, estimated before anyone starts it.
  await expect(board.getByRole("region", { name: "To do" }).getByRole("listitem").filter({ hasText: "NW-238" })).toContainText("Estimated AI spend est. $2,100");

  await expect(roles.getByRole("heading", { name: "Which teams are using it?" })).toBeVisible();
  await expect(roles.getByRole("figure", { name: /\$42,540 projected at the same daily pace/ })).toBeVisible();
  // Return is a counted share and a cost per merged pull request, not a multiple.
  const returned = roles.getByRole("figure", { name: /Return on the spend/ });
  await expect(returned.getByText("57%")).toBeVisible();
  await expect(returned.getByText("$1,527")).toBeVisible();
  expect(Math.round(35120 / 23)).toBe(1527);
  await expect(roles.getByText(/\dx\b|ROI/)).toHaveCount(0);

  const sheet = roles.getByRole("figure", { name: /cost\.csv/ });
  await expect(sheet.getByRole("cell", { name: "People using it (30d)" })).toBeVisible();
  await expect(sheet.getByRole("cell", { name: "Next renewal" })).toBeVisible();
  await expect(sheet.getByRole("cell", { name: "1750.00" })).toBeVisible();

  // Each row is a label, one sentence and a picture: the lines that described the pictures are gone.
  await expect(roles.getByText(/One row per person|sharing switch for each login|Each Jira ticket|Export one row|Three answers/)).toHaveCount(0);

  // Rows alternate sides, with Leadership full width between them.
  const left = async (locator: import("@playwright/test").Locator) => (await locator.boundingBox())!.x;
  const top = async (locator: import("@playwright/test").Locator) => (await locator.boundingBox())!.y;
  const emText = roles.getByRole("heading", { name: "Priya needs Premium. Elena barely uses hers." });
  const pmText = roles.getByRole("heading", { name: "The billing rewrite has $1,819 in it and isn’t moving." });
  const devText = roles.getByRole("heading", { name: "I can see what it holds about me." });
  expect(await left(emText)).toBeLessThan(await left(people));
  expect(await left(board)).toBeLessThan(await left(pmText));
  expect(await left(sheet)).toBeGreaterThan(await left(roles.getByRole("heading", { name: /Two renewals in December/ })));
  expect(await left(myData)).toBeLessThan(await left(devText));
  const leadership = roles.getByRole("heading", { name: "We’re on pace for $42,540 this month." });
  expect(await top(leadership)).toBeGreaterThan(await top(board));
  expect(await top(leadership)).toBeLessThan(await top(sheet));
  expect(await top(devText)).toBeGreaterThan(await top(sheet));
  // Each role's tag starts level with the top of its picture.
  const tagTop = async (who: string) => (await roles.locator(`[data-role="${who}"] > div`).first().boundingBox())!.y;
  for (const [who, picture] of [["Engineering manager", people], ["Project manager", board], ["Finance", sheet], ["Developer", myData]] as const) {
    expect(Math.abs((await tagTop(who)) - (await top(picture)))).toBeLessThanOrEqual(2);
  }
  // Each leadership question sits above the card that answers it.
  expect(await top(roles.getByRole("heading", { name: "What are we getting for it?" }))).toBeLessThan(await top(returned));
});

test("homepage Start free buttons stand out from the page", async ({ page }) => {
  await page.goto("/");
  // Every link that names GitHub carries the GitHub mark: hero, pricing, privacy, close and the footer.
  const githubLinks = page.locator('main a[href*="github.com"]').filter({ hasText: "GitHub" });
  await expect(githubLinks).toHaveCount(5);
  for (const link of await githubLinks.all()) {
    await expect(link.locator("svg")).toBeVisible();
  }
  const buttons = page.locator("main").getByRole("link", { name: "Start free" });
  await expect(buttons).toHaveCount(5);
  // The four large ones (hero, comparison, pricing, close) are yellow with an ink edge.
  const loud = page.locator("main a.public-btn-cta");
  await expect(loud).toHaveCount(4);
  for (const button of await loud.all()) {
    await expect(button).toHaveCSS("background-color", "rgb(229, 236, 103)");
    await expect(button).toHaveCSS("border-top-width", "2px");
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(52);
  }
  // Notes on the pictures are violet, so none of them can be mistaken for the button.
  for (const note of await page.locator(".home-note").all()) {
    await expect(note).not.toHaveCSS("background-color", "rgb(229, 236, 103)");
  }
});

test("homepage keeps a side margin on laptop widths just above the large breakpoint", async ({ page }) => {
  // Between 1024px and the content width, the sections used to drop their padding and sit on the window edge.
  for (const width of [1024, 1076, 1180]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const checks = [
      page.getByRole("heading", { level: 1 }),
      page.getByText("What each feature costs, where the month will land, and who is near a limit."),
      page.getByText(/^Works with/).first(),
    ];
    for (const locator of checks) {
      const box = (await locator.boundingBox())!;
      expect(box.x, `${width}px: left margin`).toBeGreaterThanOrEqual(16);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${width}px: horizontal scroll`).toBeLessThanOrEqual(0);
  }
});

test("homepage compares each vendor's admin, explains pricing, and shows the rollout and what is collected", async ({ page }) => {
  await page.goto("/");

  const compare = page.getByRole("region", { name: "Four tabs open, and you’re still guessing." });
  for (const vendor of ["Claude", "Cursor", "GitHub Copilot", "Codex"]) {
    await expect(compare.getByRole("columnheader", { name: vendor })).toBeVisible();
  }
  await expect(compare.getByRole("columnheader", { name: "UseJunction" }).getByRole("img", { name: "UseJunction" })).toBeVisible();
  // Four rows. Each is a question; our column holds the answer and the vendors' cells stay honest.
  await expect(compare.getByRole("rowheader")).toHaveText([
    "Who is about to hit a limit?",
    "What did each person spend?",
    "Where will this month’s bill land?",
    "What will the next feature cost?",
  ]);
  const limitRow = compare.getByRole("row", { name: /Who is about to hit a limit\?/ });
  await expect(limitRow.getByRole("cell")).toHaveText([/Priya, 97%/, /Not shown/, /Spend limit/, /Budgets/, /Credit limit/]);
  const billRow = compare.getByRole("row", { name: /Where will this month’s bill land\?/ });
  await expect(billRow.getByRole("cell")).toHaveText([/\$42,540 by month end.*\$14,180 spent in the first ten days/, /Own bill/, /Own bill/, /Own bill/, /Own bill/]);
  expect((14180 / 10) * 30).toBe(42540);

  // The next-feature row reads without clicking: who the spend comes from, and the merged feature it is based on.
  const sprintRow = compare.getByRole("row", { name: /What will the next feature cost\?/ });
  await expect(sprintRow.getByRole("cell").first()).toHaveText(/SSO login, about \$5,400.*not started, 6 tickets/);
  await expect(sprintRow.getByRole("button")).toHaveText([/Marcus.*\$1,900/, /Priya.*\$1,600/, /Tom.*\$1,100/, /Amara.*\$800/]);
  expect(1900 + 1600 + 1100 + 800).toBe(5400);
  await expect(sprintRow.getByText("Based on Team invitations, which merged at $6,930")).toBeVisible();
  await sprintRow.getByRole("button", { name: /Marcus/ }).click();
  await expect(sprintRow.getByRole("cell").first()).toHaveText(/Marcus, about \$1,900.*2 of the 6 tickets/);
  await sprintRow.getByRole("button", { name: /Marcus/ }).click();
  await expect(sprintRow.getByRole("cell").first()).toHaveText(/SSO login, about \$5,400/);
  // Every vendor cell says something; nothing is left blank or unconfirmed.
  await expect(compare.getByText("Unconfirmed")).toHaveCount(0);
  await expect(compare.getByRole("link", { name: "Start free" })).toHaveAttribute("href", /^\/signup/);

  const pricing = page.locator("#pricing");
  await expect(pricing.getByRole("heading", { name: /\$1 per active developer a month\. Your first 5 seats are free\./ })).toBeVisible();
  const plans = pricing.getByRole("list", { name: "Plans" }).getByRole("listitem");
  await expect(plans).toHaveCount(2);
  await expect(plans.nth(0)).toContainText("Hosted");
  await expect(plans.nth(1)).toContainText("Self-hosted");
  await expect(pricing.getByText(/pays for/)).toHaveCount(0);
  await expect(pricing.getByRole("link", { name: "Start free" }).first()).toHaveAttribute("href", /^\/signup/);

  const start = page.getByRole("region", { name: /Try it on your own laptop/ });
  for (const step of ["Connect your laptop", "Look at your own usage", "Invite the team", "Connect GitHub"]) {
    await expect(start.getByRole("heading", { name: step })).toBeVisible();
  }
  await expect(start.getByText("--token")).toHaveCount(0);

  const privacy = page.getByRole("region", { name: "Your developers will ask what it collects." });
  await expect(privacy.getByRole("list", { name: "Collected", exact: true }).getByRole("listitem")).toHaveCount(5);
  await expect(privacy.getByRole("list", { name: "Never collected" })).toContainText("Keystrokes or screenshots");

  const faq = page.getByRole("region", { name: "Before you install." });
  await expect(faq.getByText("Do developers have to change how they work?")).toBeVisible();
  await expect(faq.getByText("More questions")).toBeVisible();
});

test("login form rejects bad credentials and links to recovery", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Sign in to UseJunction/i })).toBeVisible();
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/We could not sign you in/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Forgot password?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
});

test("signup form validates password confirmation", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByLabel("Full name")).toBeVisible();
  await page.getByLabel("Full name").fill("E2E Signup");
  await page.getByLabel("Work email").fill("signup-e2e@example.com");
  await page.getByLabel("Password", { exact: true }).fill("long-enough-password");
  await page.getByLabel("Confirm password").fill("different-password");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByText(/matching password of at least 12 characters/i),
  ).toBeVisible();
});

test("forgot password shows confirmation after submit", async ({ page }) => {
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: /Reset your password/i })).toBeVisible();
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/Check your email for next steps/i)).toBeVisible();
});

test("reset password form is available", async ({ page }) => {
  await page.goto("/reset-password?token=invalid");
  await expect(page.getByRole("heading", { name: /Choose a new password/i })).toBeVisible();
  await expect(page.getByLabel("New password")).toBeVisible();
  await expect(page.getByLabel("Confirm password")).toBeVisible();
});

test("contact form submits a note", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByRole("heading", { name: /Tell us what your team needs/i })).toBeVisible();
  await page.getByLabel("Name").fill("E2E Contact");
  await page.getByLabel("Work email").fill("contact-e2e@example.com");
  await page.getByLabel("Company").fill("Calculation E2E");
  await page.getByLabel("What are you evaluating?").fill("Browser e2e coverage");
  await page.getByRole("button", { name: "Send note" }).click();
  await expect(page.getByText(/Thanks—your note has been received/i)).toBeVisible();
});

test("invalid invite routes show unavailable messaging", async ({ page }) => {
  await page.goto("/i/invalid-token");
  await expect(page.getByRole("heading", { name: /This invite is unavailable/i })).toBeVisible();

  await page.goto("/join/invalid-token");
  await expect(page.getByRole("heading", { name: /This invitation is unavailable/i })).toBeVisible();

  await page.goto("/join/company/missing-org");
  await expect(page.getByRole("heading", { name: /Company join is unavailable/i })).toBeVisible();
});

test("seeded invite links render join flows", async ({ page }) => {
  await page.goto(`/i/${teamInviteToken}`);
  await expect(page.getByRole("heading", { name: /Join Calculation E2E/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create account" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText(/You're already signed in/i)).toHaveCount(0);

  await page.goto(`/join/${orgInviteToken}`);
  await expect(page.getByRole("heading", { name: /Join Calculation E2E/i })).toBeVisible();
});
