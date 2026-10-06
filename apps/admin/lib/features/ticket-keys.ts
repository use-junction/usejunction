const JIRA_KEY = /(^|[^A-Z\d])([A-Z][A-Z\d]{1,9}-[1-9]\d{0,6})(?=$|[^A-Z\d])/giu;

const JIRA_KEY_BLOCKLIST = new Set([
  "UTF", "SHA", "MD", "AES", "RSA", "HMAC", "CRC", "BASE", "UUID", "ISO", "RFC", "CVE", "ES", "HTTP", "TLS", "SSL", "IPV", "OAUTH", "SOC", "WCAG", "COVID",
  "GPT", "X86", "AMD", "ARM", "IE", "WIN", "MAC", "GH", "PR", "ISSUE", "BUG", "FIX", "HOTFIX", "FEATURE", "FEAT", "RELEASE", "REL", "TASK", "TICKET", "SPRINT",
  "WEEK", "DAY", "PHASE", "PART", "STEP", "WIP", "TEMP", "TMP", "DEMO", "TEST", "V", "V1", "V2", "V3", "Q1", "Q2", "Q3", "Q4", "H1", "H2", "FY", "PORT", "ERROR", "ERR",
  "NODE", "NPM", "PNPM", "YARN", "NEXT", "REACT", "VUE", "ANGULAR", "PRISMA", "ZOD", "ESLINT", "VITEST", "JEST", "TYPESCRIPT", "TS", "JS", "PY", "PYTHON", "GO", "JAVA", "PHP", "RUBY", "RUST",
  "LODASH",
]);

const NOREPLY = /^(?:(\d+)\+)?([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?)@users\.noreply\.github\.com$/i;

export function isIgnoredBranch(name: string | null | undefined): boolean {
  if (!name) return false;
  return /^(dependabot|renovate)\//i.test(name);
}

export function isBotLogin(login: string | null | undefined): boolean {
  if (!login) return false;
  const value = login.toLowerCase();
  return value.endsWith("[bot]") || value.endsWith("-bot") || value === "web-flow" || value === "dependabot" || value === "renovate" || value === "github-actions";
}

export function parseNoreply(email: string | null | undefined): { githubId: number | null; login: string; isBot: boolean } | null {
  if (!email) return null;
  const match = email.trim().match(NOREPLY);
  if (!match) return null;
  const login = match[2] ?? "";
  return {
    githubId: match[1] ? Number(match[1]) : null,
    login: login.replace(/\[bot\]$/i, ""),
    isBot: /\[bot\]$/i.test(login),
  };
}

function extractKeys(str: string, caseInsensitive: boolean): string[] {
  if (!str) return [];
  const regex = caseInsensitive ? new RegExp(JIRA_KEY.source, "giu") : new RegExp(JIRA_KEY.source, "gu");
  const found = Array.from(str.matchAll(regex), (match) => match[2]?.toUpperCase()).filter((value): value is string => Boolean(value));
  const unique = [...new Set(found)];
  return unique.filter((key) => {
    const prefix = key.split("-")[0] ?? "";
    return !JIRA_KEY_BLOCKLIST.has(prefix);
  });
}

export function parseTicketKeys(input: {
  title?: string | null;
  branch?: string | null;
  messages?: Array<string | null | undefined>;
}): string[] {
  if (isIgnoredBranch(input.branch)) {
    return extractKeys(input.title ?? "", false);
  }
  const keys = [
    ...extractKeys(input.title ?? "", false),
    ...extractKeys(input.branch ?? "", true),
    ...(input.messages ?? []).flatMap((message) => extractKeys(message ?? "", false)),
  ];
  return [...new Set(keys)];
}

export function firstTicketKey(keys: string[] | null | undefined): string | null {
  return keys && keys.length > 0 ? keys[0] ?? null : null;
}

const GITHUB_NUMBER = /(^|[^A-Za-z0-9])#(\d{1,9})(?=$|[^0-9])/g;

export function parseGitHubIssueNumbers(input: {
  title?: string | null;
  messages?: Array<string | null | undefined>;
}): number[] {
  const texts = [input.title, ...(input.messages ?? [])];
  const found = texts.flatMap((value) => {
    if (!value) return [];
    return Array.from(value.matchAll(GITHUB_NUMBER), (match) => Number(match[2]));
  }).filter((value) => Number.isInteger(value) && value > 0);
  return [...new Set(found)];
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}
