import { isEuDeployment } from "@/lib/region";

type SlackBlock = {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: Array<{ type: string; text: string }>;
};

type SlackPayload = {
  text: string;
  blocks?: SlackBlock[];
};

function slackWebhookUrl() {
  return process.env.SLACK_WEBHOOK_URL?.trim() || null;
}

export async function sendSlackNotification(payload: SlackPayload) {
  const webhookUrl = slackWebhookUrl();
  if (!webhookUrl) return;

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Slack webhook failed with status ${response.status}`);
  }
}

export function notifySlackBestEffort(payload: SlackPayload) {
  void sendSlackNotification(payload).catch((error) => {
    console.error("[slack]", error);
  });
}

function field(label: string, value: string) {
  return { type: "mrkdwn", text: `*${label}*\n${value}` };
}

function section(text: string) {
  return { type: "section", text: { type: "mrkdwn", text } };
}

function header(text: string) {
  return { type: "header", text: { type: "plain_text", text, emoji: true } };
}

const RECENT_SIGNUP_WINDOW_MS = 60_000;

export function isRecentSignup(createdAt: Date, now = Date.now()) {
  return now - createdAt.getTime() < RECENT_SIGNUP_WINDOW_MS;
}

export function notifyUserSignedUp(input: { email: string; name?: string | null; method: string }) {
  if (isEuDeployment()) {
    notifySlackBestEffort({
      text: `New signup via ${input.method}`,
      blocks: [
        header("New signup"),
        section(`A user signed up via *${input.method}* on the EU deployment.`),
      ],
    });
    return;
  }
  const name = input.name?.trim() || "—";
  notifySlackBestEffort({
    text: `New signup: ${input.email}`,
    blocks: [
      header("New signup"),
      section(`*${input.email}* signed up via *${input.method}*.`),
      { type: "section", fields: [field("Name", name), field("Method", input.method)] },
    ],
  });
}

export function notifyUserLoggedIn(input: {
  email: string;
  name?: string | null;
  provider: string;
}) {
  if (isEuDeployment()) {
    notifySlackBestEffort({
      text: `User login via ${input.provider}`,
      blocks: [
        header("User login"),
        section(`A user logged in via *${input.provider}* on the EU deployment.`),
      ],
    });
    return;
  }
  const name = input.name?.trim() || "—";
  notifySlackBestEffort({
    text: `User login: ${input.email}`,
    blocks: [
      header("User login"),
      section(`*${input.email}* logged in via *${input.provider}*.`),
      { type: "section", fields: [field("Name", name), field("Provider", input.provider)] },
    ],
  });
}

export function notifyTeamSeatsAdded(input: {
  organizationName: string;
  orgId: string;
  actorEmail: string;
  emails: string[];
}) {
  const invitees = input.emails.join(", ");
  notifySlackBestEffort({
    text: `Seats added in ${input.organizationName}`,
    blocks: [
      header("Team seats added"),
      section(`*${input.actorEmail}* added people to seats in *${input.organizationName}*.`),
      {
        type: "section",
        fields: [
          field("Workspace", input.organizationName),
          field("Added", String(input.emails.length)),
        ],
      },
      section(`*Invitees*\n${invitees}`),
    ],
  });
}

const DETAIL_LIMIT = 2_800;

function formatIssueDetail(value: unknown): string {
  if (value instanceof Error) {
    return (value.stack || value.message).slice(0, DETAIL_LIMIT);
  }
  if (typeof value === "string") return value.slice(0, DETAIL_LIMIT);
  try {
    return JSON.stringify(value, null, 2).slice(0, DETAIL_LIMIT);
  } catch {
    return String(value).slice(0, DETAIL_LIMIT);
  }
}

/** Ops alert for server errors / warnings. Fire-and-forget; no-op without webhook. */
export function notifyServerIssue(input: {
  severity: "error" | "warning";
  scope: string;
  error: unknown;
  details?: Record<string, unknown>;
}) {
  const emoji = input.severity === "error" ? "🔴" : "🟡";
  const title = input.severity === "error" ? "Server error" : "Server warning";
  const detail = formatIssueDetail(input.error);
  const detailFields = Object.entries(input.details ?? {}).map(([key, value]) =>
    field(key, formatIssueDetail(value)),
  );

  notifySlackBestEffort({
    text: `${title}: [${input.scope}] ${detail.split("\n")[0]}`,
    blocks: [
      header(`${emoji} ${title}`),
      {
        type: "section",
        fields: [
          field("Scope", `\`${input.scope}\``),
          field("Severity", input.severity),
          ...detailFields.slice(0, 8),
        ],
      },
      section(`\`\`\`${detail}\`\`\``),
    ],
  });
}
