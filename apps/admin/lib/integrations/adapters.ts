import { createHash } from "crypto";
import { fetchJson, fetchNdjson } from "@/lib/integrations/http";
import { sanitizeExtractionPayload } from "@usejunction/usage-schema";
import type { AdapterContext, ProviderAdapter, ProviderApiKey, ProviderMember, ProviderSeat, ProviderUsage } from "@/lib/integrations/types";

type Row = Record<string, any>;

function day(value: unknown, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(typeof value === "number" || typeof value === "string" ? value : fallback);
  if (Number.isNaN(date.getTime())) return new Date(Date.UTC(fallback.getUTCFullYear(), fallback.getUTCMonth(), fallback.getUTCDate()));
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function int(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function bigint(value: unknown): bigint {
  return BigInt(int(value));
}

function microsFromUsd(value: unknown): bigint {
  const amount = Number(value ?? 0);
  return BigInt(Number.isFinite(amount) ? Math.max(0, Math.round(amount * 1_000_000)) : 0);
}

function stableKey(prefix: string, row: Row, index: number) {
  const digest = createHash("sha256").update(JSON.stringify(row)).digest("hex").slice(0, 24);
  return `${prefix}:${index}:${digest}`;
}

function range(context: AdapterContext, maxDays = 90) {
  const end = context.now;
  const days = context.initialSync ? maxDays : 3;
  return { start: new Date(end.getTime() - days * 86400_000), end };
}

function dateChunks(start: Date, end: Date, maxDays: number) {
  const chunks: Array<{ start: Date; end: Date }> = [];
  let cursor = start;
  while (cursor < end) {
    const chunkEnd = new Date(Math.min(end.getTime(), cursor.getTime() + maxDays * 86400_000));
    chunks.push({ start: cursor, end: chunkEnd });
    cursor = chunkEnd;
  }
  return chunks;
}

function basic(key: string) {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

const cursor: ProviderAdapter = {
  provider: "cursor",
  products: ["teams"],
  async validate(context) {
    const data = await fetchJson<Row>("https://api.cursor.com/teams/members", { headers: { Authorization: basic(context.credential) } });
    return { externalOrgId: String(data.teamId ?? context.config.teamId ?? "cursor-team"), permissions: ["members:read", "usage:read", "spend:read"] };
  },
  async sync(context) {
    const headers = { Authorization: basic(context.credential), "content-type": "application/json" };
    const memberResponse = await fetchJson<Row>("https://api.cursor.com/teams/members", { headers });
    const members: ProviderMember[] = (memberResponse.teamMembers ?? []).map((member: Row) => ({
      externalUserId: String(member.id ?? member.email).toLowerCase(), email: member.email?.toLowerCase(), name: member.name, role: member.role, metadata: member,
    }));
    const dates = range(context, 90);
    const dailyResponse = await fetchJson<Row>("https://api.cursor.com/teams/daily-usage-data", {
      method: "POST", headers, body: JSON.stringify({ startDate: dates.start.getTime(), endDate: dates.end.getTime() }),
    });
    const usage: ProviderUsage[] = (dailyResponse.data ?? []).map((row: Row, index: number) => ({
      externalKey: stableKey("cursor-daily", row, index), externalUserId: String(row.userId ?? row.email ?? "").toLowerCase() || null,
      email: row.email?.toLowerCase(), date: day(row.date), provider: "cursor", product: "teams", toolName: "cursor", model: row.mostUsedModel ?? "",
      requests: int(row.composerRequests) + int(row.chatRequests) + int(row.agentRequests),
      suggestedLines: bigint(row.totalLinesAdded), acceptedLines: bigint(row.acceptedLinesAdded),
      addedLines: bigint(row.totalLinesAdded), deletedLines: bigint(row.totalLinesDeleted),
      metadata: { active: Boolean(row.isActive), tabsShown: int(row.totalTabsShown), tabsAccepted: int(row.totalTabsAccepted), clientVersion: row.clientVersion ?? null },
      sourceEndpoint: "/teams/daily-usage-data", sourceCapability: "daily_usage", surface: "cursor_editor",
    }));

    // Event-level usage is optional on Cursor accounts. It is complementary
    // to the daily feed: keep token/cost facts here and leave request counts
    // to the daily report so the two feeds cannot double-count activity.
    if (context.config.enableDetailedFeeds === true) try {
      let eventPage = 1;
      for (;;) {
        const response = await fetchJson<Row>("https://api.cursor.com/teams/filtered-usage-events", {
          method: "POST", headers,
          body: JSON.stringify({ startDate: dates.start.getTime(), endDate: dates.end.getTime(), page: eventPage, pageSize: 100 }),
        });
        const events: Row[] = response.usageEvents ?? response.events ?? response.data ?? [];
        for (const [index, event] of events.entries()) {
          const timestamp = event.timestamp ?? event.createdAt ?? event.date;
          const cents = Number(event.chargedCents ?? event.spendCents ?? event.costCents ?? 0);
          usage.push({
            externalKey: stableKey(`cursor-event:${timestamp ?? event.id ?? eventPage}`, event, index),
            externalUserId: String(event.userId ?? event.email ?? "").toLowerCase() || null,
            email: event.email?.toLowerCase(), date: day(timestamp), provider: "cursor", product: "teams", toolName: "cursor",
            model: String(event.model ?? ""), inputTokens: bigint(event.inputTokens), outputTokens: bigint(event.outputTokens),
            cacheReadTokens: bigint(event.cacheReadTokens), cacheWriteTokens: bigint(event.cacheWriteTokens), costMicros: BigInt(Math.max(0, Math.round(cents * 10_000))),
            metadata: { usageKind: event.usageKind ?? null, isHeadless: Boolean(event.isHeadless), eventId: event.id ?? null },
            sourceEndpoint: "/teams/filtered-usage-events", sourceCapability: "usage_events", surface: event.isHeadless ? "cursor_headless" : "cursor_editor",
            costKind: cents > 0 ? "actual_spend" : null,
          });
        }
        if (events.length < 100 || eventPage >= int(response.totalPages) || eventPage >= 50) break;
        eventPage += 1;
      }
    } catch (error) {
      if (!String(error).includes("403") && !String(error).includes("404")) throw error;
    }

    // Enterprise AI-code analytics supplies repository-aware productivity
    // facts that the daily team report does not contain.
    if (context.config.enableDetailedFeeds === true) try {
      for (let page = 1; page <= 50; page += 1) {
        const response = await fetchJson<Row>(`https://api.cursor.com/analytics/ai-code/commits?startDate=${encodeURIComponent(dates.start.toISOString())}&endDate=${encodeURIComponent(dates.end.toISOString())}&page=${page}&pageSize=100`, { headers });
        const commits: Row[] = response.items ?? response.data ?? [];
        for (const [index, commit] of commits.entries()) {
          const repo = typeof commit.repoName === "string" && commit.repoName.includes("/")
            ? { host: "unknown", owner: commit.repoName.split("/")[0], name: commit.repoName.split("/").slice(1).join("/") }
            : null;
          usage.push({
            externalKey: stableKey(`cursor-commit:${commit.commitHash ?? commit.createdAt}`, commit, index),
            externalUserId: String(commit.userId ?? commit.userEmail ?? "").toLowerCase() || null,
            email: commit.userEmail?.toLowerCase(), date: day(commit.commitTs ?? commit.createdAt), provider: "cursor", product: "teams", toolName: "cursor",
            addedLines: bigint(Number(commit.tabLinesAdded ?? 0) + Number(commit.composerLinesAdded ?? 0)),
            deletedLines: bigint(Number(commit.tabLinesDeleted ?? 0) + Number(commit.composerLinesDeleted ?? 0)),
            commits: 1, metricKind: "productivity", repository: repo,
            metadata: { commitHash: commit.commitHash ?? null, branchName: commit.branchName ?? null, isPrimaryBranch: commit.isPrimaryBranch ?? null },
            sourceEndpoint: "/analytics/ai-code/commits", sourceCapability: "ai_code_analytics", surface: "cursor_commit",
          });
        }
        if (commits.length < 100) break;
      }
    } catch (error) {
      if (!String(error).includes("403") && !String(error).includes("404")) throw error;
    }
    let page = 1;
    do {
      const spend = await fetchJson<Row>("https://api.cursor.com/teams/spend", { method: "POST", headers, body: JSON.stringify({ page, pageSize: 100 }) });
      for (const [index, row] of (spend.teamMemberSpend ?? []).entries()) usage.push({
        externalKey: stableKey(`cursor-spend:${spend.subscriptionCycleStart}`, row, index), externalUserId: String(row.userId ?? row.email).toLowerCase(),
        email: row.email?.toLowerCase(), date: day(spend.subscriptionCycleStart), provider: "cursor", product: "teams", toolName: "cursor",
        costMicros: BigInt(int(row.spendCents)) * BigInt(10_000), metadata: { currentSubscriptionCycle: true, fastPremiumRequests: int(row.fastPremiumRequests) },
        sourceEndpoint: "/teams/spend", sourceCapability: "costs", costKind: "actual_spend", surface: "cursor_editor",
      });
      if (page >= int(spend.totalPages) || page >= 50) break;
      page += 1;
    } while (true);
    const seats: ProviderSeat[] = members.map((member) => ({ externalUserId: member.externalUserId, product: "cursor", plan: "teams", status: "active" }));
    return { externalOrgId: String(memberResponse.teamId ?? context.config.teamId ?? "cursor-team"), permissions: ["members:read", "usage:read", "spend:read"], members, seats, usage };
  },
};

function githubHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" };
}

function isCopilotUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /\(403\)|\(404\)/.test(message);
}

const github: ProviderAdapter = {
  provider: "github",
  products: ["copilot"],
  async validate(context) {
    const org = String(context.config.org ?? "");
    if (!org) throw new Error("GitHub account is required");
    if (String(context.config.accountType ?? "").toLowerCase() === "user") {
      return { externalOrgId: org, permissions: [] };
    }
    try {
      await fetchJson(`https://api.github.com/orgs/${encodeURIComponent(org)}/copilot/billing`, { headers: githubHeaders(context.credential) });
      return { externalOrgId: org, permissions: ["copilot_seats:read", "copilot_metrics:read"] };
    } catch (error) {
      if (!isCopilotUnavailable(error)) throw error;
      return { externalOrgId: org, permissions: [] };
    }
  },
  async sync(context) {
    const org = String(context.config.org ?? "");
    if (!org) throw new Error("GitHub account is required");
    const headers = githubHeaders(context.credential);
    if (String(context.config.accountType ?? "").toLowerCase() === "user") {
      // Personal installs have no org Copilot billing APIs; code sync still runs via GitHub App token.
      return { externalOrgId: org, permissions: [], members: [], seats: [], usage: [] };
    }
    const members: ProviderMember[] = [];
    const seats: ProviderSeat[] = [];
    let copilotAvailable = true;
    try {
      for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
        const response = await fetchJson<Row>(`https://api.github.com/orgs/${encodeURIComponent(org)}/copilot/billing/seats?per_page=100&page=${pageNumber}`, { headers });
        const rows: Row[] = response.seats ?? [];
        for (const row of rows) {
          const login = String(row.assignee?.login ?? row.assignee?.id ?? "");
          if (!login) continue;
          members.push({ externalUserId: login.toLowerCase(), name: login, metadata: { githubId: row.assignee?.id } });
          seats.push({ externalUserId: login.toLowerCase(), product: "copilot", plan: row.plan_type, status: row.pending_cancellation_date ? "pending_cancellation" : "active", assignedAt: row.created_at ? new Date(row.created_at) : null, lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at) : null, metadata: { editor: row.last_activity_editor ?? null } });
        }
        if (rows.length < 100) break;
      }
    } catch (error) {
      if (!isCopilotUnavailable(error)) throw error;
      copilotAvailable = false;
    }
    const usage: ProviderUsage[] = [];
    const dates = range(context, context.initialSync ? 28 : 3);
    for (let cursorDate = dates.start; cursorDate < dates.end; cursorDate = new Date(cursorDate.getTime() + 86400_000)) {
      const reportDay = cursorDate.toISOString().slice(0, 10);
      try {
        const links = await fetchJson<Row>(`https://api.github.com/orgs/${encodeURIComponent(org)}/copilot/metrics/reports/users-1-day?day=${reportDay}`, { headers });
        for (const link of links.download_links ?? []) {
          const rows = await fetchNdjson(String(link));
          rows.forEach((row, index) => usage.push({
            externalKey: stableKey(`github-copilot:${reportDay}`, row, index), externalUserId: String(row.user_login ?? row.user_id ?? "").toLowerCase() || null,
            date: day(reportDay), provider: "github", product: "copilot", toolName: "github-copilot", model: String(row.model ?? ""),
            requests: int(row.requests ?? row.total_engaged_users), suggestedLines: bigint(row.code_generation_activity_count ?? row.lines_suggested),
            acceptedLines: bigint(row.code_acceptance_activity_count ?? row.lines_accepted), metadata: row,
            sourceEndpoint: "/copilot/metrics/reports/users-1-day", sourceCapability: "daily_usage", surface: "github_copilot",
          }));
        }
      } catch (error) {
        if (!isCopilotUnavailable(error) && !String(error).includes("404")) throw error;
      }
    }
    return {
      externalOrgId: org,
      permissions: copilotAvailable ? ["copilot_seats:read", "copilot_metrics:read"] : [],
      members,
      seats,
      usage,
    };
  },
};

function bearerHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "content-type": "application/json" };
}

const openai: ProviderAdapter = {
  provider: "openai",
  products: ["api_platform", "codex_enterprise"],
  async validate(context) {
    if (String(context.config.product ?? "api_platform") === "codex_enterprise") {
      const endpoint = String(context.config.analyticsEndpoint ?? "").trim();
      if (!endpoint) throw new Error("Codex Analytics endpoint is required for this enterprise connection");
      await fetchJson(endpoint, { headers: bearerHeaders(context.credential) });
      return { permissions: ["codex_analytics:read"] };
    }
    await fetchJson("https://api.openai.com/v1/organization/users?limit=1", { headers: bearerHeaders(context.credential) });
    return { permissions: ["organization_users:read", "organization_usage:read", "organization_costs:read"] };
  },
  async sync(context) {
    const headers = bearerHeaders(context.credential);
    if (String(context.config.product ?? "api_platform") === "codex_enterprise") {
      const endpoint = String(context.config.analyticsEndpoint ?? "").trim();
      if (!endpoint) throw new Error("Codex Analytics endpoint is required for this enterprise connection");
      const payload = await fetchJson<Row>(endpoint, { headers });
      const rows: Row[] = payload.data ?? payload.results ?? payload.items ?? [];
      const members: ProviderMember[] = [];
      const usage: ProviderUsage[] = [];
      for (const [index, row] of rows.entries()) {
        const externalUserId = String(row.user_id ?? row.userId ?? row.account_id ?? row.email ?? "").trim();
        const email = typeof row.email === "string" ? row.email.toLowerCase() : undefined;
        if (externalUserId) members.push({ externalUserId, email, name: row.name, metadata: { source: "codex_analytics" } });
        const dateValue = row.date ?? row.starting_at ?? row.timestamp ?? context.now;
        usage.push({
          externalKey: stableKey(`openai-codex:${dateValue}`, row, index), externalUserId: externalUserId || null, email,
          date: day(dateValue), provider: "openai", product: "codex_enterprise", toolName: "codex", model: row.model ?? "",
          requests: int(row.requests ?? row.message_runs ?? row.turns), sessions: int(row.sessions), inputTokens: bigint(row.input_tokens),
          outputTokens: bigint(row.output_tokens), cacheReadTokens: bigint(row.cached_input_tokens ?? row.input_cached_tokens),
          acceptedLines: bigint(row.accepted_lines ?? row.lines_of_code_written),
          suggestedLines: bigint(row.suggested_lines ?? row.lines_of_code_generated), commits: int(row.commits),
          metadata: sanitizeExtractionPayload(row), sourceEndpoint: endpoint, sourceCapability: "codex_analytics", surface: "codex",
        });
      }
      return { permissions: ["codex_analytics:read"], members, seats: [], usage };
    }
    const members: ProviderMember[] = [];
    let after = "";
    for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
      const response = await fetchJson<Row>(`https://api.openai.com/v1/organization/users?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`, { headers });
      for (const row of response.data ?? []) members.push({ externalUserId: String(row.id), email: row.email?.toLowerCase(), name: row.name, role: row.role, metadata: row });
      if (!response.has_more || !response.last_id) break;
      after = String(response.last_id);
    }
    const projects: Row[] = [];
    after = "";
    for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
      const response = await fetchJson<Row>(`https://api.openai.com/v1/organization/projects?limit=100&include_archived=true${after ? `&after=${encodeURIComponent(after)}` : ""}`, { headers });
      projects.push(...(response.data ?? []));
      if (!response.has_more || !response.last_id) break;
      after = String(response.last_id);
    }
    const apiKeys: ProviderApiKey[] = [];
    for (const project of projects) {
      let keyAfter = "";
      for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
        const response = await fetchJson<Row>(`https://api.openai.com/v1/organization/projects/${encodeURIComponent(String(project.id))}/api_keys?limit=100&owner_project_access=any${keyAfter ? `&after=${encodeURIComponent(keyAfter)}` : ""}`, { headers });
        for (const key of response.data ?? []) apiKeys.push({
          externalKeyId: String(key.id),
          name: key.name ?? null,
          redactedHint: key.redacted_value ?? null,
          projectId: String(project.id),
          ownerExternalId: key.owner?.user?.id ?? key.owner?.service_account?.id ?? null,
          ownerEmail: key.owner?.user?.email?.toLowerCase() ?? null,
          principalType: key.owner?.type ?? null,
          status: key.owner_project_access === "inactive" ? "inactive" : "active",
          metadata: { projectName: project.name ?? null, lastUsedAt: key.last_used_at ?? null },
        });
        if (!response.has_more || !response.last_id) break;
        keyAfter = String(response.last_id);
      }
    }
    const dates = range(context, 90);
    const usage: ProviderUsage[] = [];
    let usagePage = "";
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const query = new URLSearchParams({ start_time: String(Math.floor(dates.start.getTime() / 1000)), end_time: String(Math.floor(dates.end.getTime() / 1000)), bucket_width: "1d", limit: "100" });
      for (const group of ["user_id", "api_key_id", "project_id", "model"]) query.append("group_by", group);
      if (usagePage) query.set("page", usagePage);
      const response = await fetchJson<Row>(`https://api.openai.com/v1/organization/usage/completions?${query}`, { headers });
      for (const bucket of response.data ?? []) for (const [index, row] of (bucket.results ?? []).entries()) usage.push({
        externalKey: stableKey(`openai-usage:${bucket.start_time}`, row, index), externalUserId: row.user_id ?? null,
        externalApiKeyId: row.api_key_id ?? null, externalProjectId: row.project_id ?? null, date: day(Number(bucket.start_time) * 1000),
        provider: "openai", product: "api_platform", toolName: "openai-api", model: row.model ?? "", requests: int(row.num_model_requests),
        inputTokens: bigint(row.input_tokens), outputTokens: bigint(row.output_tokens), cacheReadTokens: bigint(row.input_cached_tokens),
        metadata: { projectId: row.project_id ?? null, apiKeyId: row.api_key_id ?? null },
        sourceEndpoint: "/v1/organization/usage/completions", sourceCapability: "usage", surface: "openai_api",
      });
      usagePage = String(response.next_page ?? "");
      if (!response.has_more || !usagePage) break;
    }
    let costSyncSucceeded = true;
    try {
      let costPage = "";
      for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
        const query = new URLSearchParams({ start_time: String(Math.floor(dates.start.getTime() / 1000)), end_time: String(Math.floor(dates.end.getTime() / 1000)), bucket_width: "1d", limit: "180" });
        query.append("group_by", "project_id");
        query.append("group_by", "line_item");
        if (costPage) query.set("page", costPage);
        const response = await fetchJson<Row>(`https://api.openai.com/v1/organization/costs?${query}`, { headers });
        for (const bucket of response.data ?? []) for (const [index, row] of (bucket.results ?? []).entries()) usage.push({
          externalKey: stableKey(`openai-cost:${bucket.start_time}`, row, index), externalProjectId: row.project_id ?? null,
          date: day(Number(bucket.start_time) * 1000), provider: "openai", product: "api_platform", toolName: "openai-api",
          costMicros: microsFromUsd(row.amount?.value ?? row.amount), metadata: { currency: row.amount?.currency ?? "usd", projectId: row.project_id ?? null, lineItem: row.line_item ?? null },
          sourceEndpoint: "/v1/organization/costs", sourceCapability: "costs", costKind: "actual_spend", surface: "openai_api",
        });
        costPage = String(response.next_page ?? "");
        if (!response.has_more || !costPage) break;
      }
    } catch (error) {
      if (!String(error).includes("403") && !String(error).includes("404")) throw error;
      costSyncSucceeded = false;
    }
    return { permissions: ["organization_users:read", "organization_usage:read", ...(costSyncSucceeded ? ["organization_costs:read"] : [])], members, seats: [], apiKeys, usage, costSyncSucceeded, costDataThrough: costSyncSucceeded ? dates.end : null };
  },
};

function anthropicHeaders(key: string) {
  return { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
}

const anthropic: ProviderAdapter = {
  provider: "anthropic",
  products: ["api_platform", "enterprise"],
  async validate(context) {
    const product = String(context.config.product ?? "api_platform");
    const path = product === "enterprise" ? "/v1/organizations/usage_report/claude_code" : "/v1/organizations/usage_report/messages";
    const now = context.now.toISOString();
    const start = new Date(context.now.getTime() - 86400_000).toISOString();
    await fetchJson(`https://api.anthropic.com${path}?starting_at=${encodeURIComponent(start)}&ending_at=${encodeURIComponent(now)}&bucket_width=1d`, { headers: anthropicHeaders(context.credential) });
    return { permissions: [product === "enterprise" ? "claude_analytics:read" : "organization_usage:read", "organization_costs:read"] };
  },
  async sync(context) {
    const product = String(context.config.product ?? "api_platform");
    const dates = range(context, 90);
    const path = product === "enterprise" ? "/v1/organizations/usage_report/claude_code" : "/v1/organizations/usage_report/messages";
    const headers = anthropicHeaders(context.credential);
    const members: ProviderMember[] = [];
    if (product === "api_platform") {
      let userAfter = "";
      try {
        for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
          const response = await fetchJson<Row>(`https://api.anthropic.com/v1/organizations/users?limit=100${userAfter ? `&after_id=${encodeURIComponent(userAfter)}` : ""}`, { headers });
          for (const row of response.data ?? []) members.push({ externalUserId: String(row.id), email: row.email?.toLowerCase(), name: row.name, role: row.role, metadata: row });
          if (!response.has_more || !response.last_id) break;
          userAfter = String(response.last_id);
        }
      } catch (error) {
        if (!String(error).includes("403") && !String(error).includes("404")) throw error;
      }
    }
    const memberById = new Map(members.map((member) => [member.externalUserId, member]));
    const apiKeys: ProviderApiKey[] = [];
    if (product === "api_platform") {
      let keyAfter = "";
      for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
        const response = await fetchJson<Row>(`https://api.anthropic.com/v1/organizations/api_keys?limit=1000${keyAfter ? `&after_id=${encodeURIComponent(keyAfter)}` : ""}`, { headers });
        for (const key of response.data ?? []) {
          const principalId = key.principal?.id ?? key.created_by?.id ?? null;
          apiKeys.push({ externalKeyId: String(key.id), name: key.name ?? null, redactedHint: key.partial_key_hint ?? null,
            workspaceId: key.workspace_id ?? null, ownerExternalId: principalId, ownerEmail: principalId ? memberById.get(String(principalId))?.email ?? null : null,
            principalType: key.principal?.type ?? key.created_by?.type ?? null, status: key.status ?? "active", metadata: { expiresAt: key.expires_at ?? null } });
        }
        if (!response.has_more || !response.last_id) break;
        keyAfter = String(response.last_id);
      }
    }
    const usage: ProviderUsage[] = [];
    let costSyncSucceeded = true;
    for (const chunk of dateChunks(dates.start, dates.end, 31)) {
      let usagePage = "";
      for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
        const query = new URLSearchParams({ starting_at: chunk.start.toISOString(), ending_at: chunk.end.toISOString(), bucket_width: "1d", limit: "31" });
        if (product === "api_platform") for (const group of ["api_key_id", "workspace_id", "model"]) query.append("group_by[]", group);
        if (usagePage) query.set("page", usagePage);
        const response = await fetchJson<Row>(`https://api.anthropic.com${path}?${query}`, { headers });
        for (const bucket of response.data ?? []) for (const [index, row] of (bucket.results ?? []).entries()) usage.push({
          externalKey: stableKey(`anthropic-usage:${bucket.starting_at}`, row, index), externalUserId: row.user_id ?? row.account_id ?? null,
          externalApiKeyId: row.api_key_id ?? null, externalWorkspaceId: row.workspace_id ?? null, email: row.email?.toLowerCase(),
          date: day(bucket.starting_at), provider: "anthropic", product, toolName: product === "enterprise" ? "claude-code" : "anthropic-api", model: row.model ?? "",
          requests: int(row.request_count), sessions: int(row.session_count), inputTokens: bigint(row.uncached_input_tokens ?? row.input_tokens),
          outputTokens: bigint(row.output_tokens), cacheReadTokens: bigint(row.cache_read_input_tokens),
          cacheWriteTokens: bigint(Number(row.cache_creation_input_tokens ?? 0) + Number(row.cache_creation?.ephemeral_1h_input_tokens ?? 0) + Number(row.cache_creation?.ephemeral_5m_input_tokens ?? 0)),
          activeSeconds: bigint(row.active_time_seconds), addedLines: bigint(row.lines_of_code_added), deletedLines: bigint(row.lines_of_code_removed),
          commits: int(row.commit_count), pullRequests: int(row.pull_request_count), metadata: row,
          sourceEndpoint: path, sourceCapability: product === "enterprise" ? "claude_code_analytics" : "messages_usage", surface: product === "enterprise" ? "claude_code" : "messages_api",
        });
        usagePage = String(response.next_page ?? "");
        if (!response.has_more || !usagePage) break;
      }
      if (product !== "api_platform" || !costSyncSucceeded) continue;
      try {
        let costPage = "";
        for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
          const query = new URLSearchParams({ starting_at: chunk.start.toISOString(), ending_at: chunk.end.toISOString(), bucket_width: "1d", limit: "31" });
          query.append("group_by[]", "workspace_id");
          query.append("group_by[]", "description");
          if (costPage) query.set("page", costPage);
          const costs = await fetchJson<Row>(`https://api.anthropic.com/v1/organizations/cost_report?${query}`, { headers });
          for (const bucket of costs.data ?? []) for (const [index, row] of (bucket.results ?? []).entries()) usage.push({
            externalKey: stableKey(`anthropic-cost:${bucket.starting_at}`, row, index), externalWorkspaceId: row.workspace_id ?? null,
            date: day(bucket.starting_at), provider: "anthropic", product, toolName: "anthropic-api",
            costMicros: BigInt(Math.max(0, Math.round(Number(row.amount ?? 0) * 10_000))),
            metadata: { currency: row.currency ?? "USD", costType: row.cost_type ?? null, model: row.model ?? null, workspaceId: row.workspace_id ?? null, description: row.description ?? null },
            sourceEndpoint: "/v1/organizations/cost_report", sourceCapability: "cost_report", costKind: "actual_spend", surface: "messages_api",
          });
          costPage = String(costs.next_page ?? "");
          if (!costs.has_more || !costPage) break;
        }
      } catch (error) {
        if (!String(error).includes("403") && !String(error).includes("404")) throw error;
        costSyncSucceeded = false;
      }
    }
    for (const row of usage) if (row.externalUserId) members.push({ externalUserId: row.externalUserId, email: row.email, metadata: { inferredFromUsage: true } });
    return { permissions: [product === "enterprise" ? "claude_analytics:read" : "organization_usage:read", ...(product === "api_platform" && costSyncSucceeded ? ["organization_costs:read"] : [])], members, seats: [], apiKeys, usage, costSyncSucceeded: product === "api_platform" ? costSyncSucceeded : undefined, costDataThrough: product === "api_platform" && costSyncSucceeded ? dates.end : null };
  },
};

const adapters = [cursor, github, openai, anthropic];

export function getAdapter(provider: string, product: string) {
  const adapter = adapters.find((candidate) => candidate.provider === provider && candidate.products.includes(product));
  if (!adapter) throw new Error(`unsupported provider product: ${provider}/${product}`);
  return adapter;
}

export function supportedIntegrations() {
  return adapters.flatMap((adapter) => adapter.products.map((product) => ({ provider: adapter.provider, product })));
}
