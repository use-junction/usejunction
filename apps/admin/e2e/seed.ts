import { hash } from "bcryptjs";
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { hashOpaqueToken } from "../lib/security";
import { flowKeyFromSession } from "../lib/signals/policies/flow";
import { COLLECTION_NOTICE_VERSION, LEGAL_PRIVACY_VERSION, LEGAL_TERMS_VERSION } from "../lib/legal/versions";

const loadedEnv = loadEnvConfig(path.join(__dirname, "../.."));
if (!process.env.DATABASE_URL && loadedEnv.combinedEnv.DATABASE_URL) {
  process.env.DATABASE_URL = loadedEnv.combinedEnv.DATABASE_URL;
}

const orgSlug = process.env.E2E_ORG_SLUG ?? "e2e-calculation-fixture";
const ownerEmail = process.env.E2E_OWNER_EMAIL ?? "owner@example.com";
const developerEmail = process.env.E2E_DEVELOPER_EMAIL ?? "developer@example.com";
const password = process.env.E2E_OWNER_PASSWORD ?? "e2e-password";
const teamInviteToken = process.env.E2E_TEAM_INVITE_TOKEN ?? "uj_team_e2e_calculation_invite";
const orgInviteToken = process.env.E2E_ORG_INVITE_TOKEN ?? "uj_invite_e2e_calculation_member";
const inviteeEmail = process.env.E2E_INVITEE_EMAIL ?? "invitee@example.com";
const now = new Date("2026-07-16T12:00:00.000Z");
const inviteExpiresAt = new Date("2027-12-16T12:00:00.000Z");
const journey = flowKeyFromSession({
  appBefore: "Google Chrome",
  domainBefore: "github.com",
  aiTool: "cursor",
  appAfter: "Slack",
  domainAfter: "slack.com",
});
let disconnect: (() => Promise<void>) | null = null;

async function main() {
  const { prisma } = await import("@usejunction/db");
  disconnect = () => prisma.$disconnect();
  const existing = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (existing) await prisma.organization.delete({ where: { id: existing.id } });
  await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, developerEmail] } } });

  const org = await prisma.organization.create({
    data: {
      name: "Calculation E2E",
      slug: orgSlug,
      plan: "team",
      subscriptionStatus: "active",
      lemonSqueezyCustomerId: "e2e-lemon-customer",
      lemonSqueezySubscriptionId: "e2e-lemon-subscription",
      lemonSqueezyQuantity: 5,
      dataRegion: process.env.DEPLOYMENT_REGION === "eu" ? "eu" : "us",
      usageRetentionDays: 1095,
    },
  });
  const passwordHash = await hash(password, 10);
  const legalAcceptance = {
    termsAcceptedAt: now,
    termsVersion: LEGAL_TERMS_VERSION,
    privacyVersion: LEGAL_PRIVACY_VERSION,
  };
  const ownerUser = await prisma.user.create({ data: { name: "E2E Owner", email: ownerEmail, passwordHash, emailVerified: now, ...legalAcceptance } });
  const developerUser = await prisma.user.create({ data: { name: "E2E Developer", email: developerEmail, passwordHash, emailVerified: now, ...legalAcceptance } });
  await prisma.organizationMembership.createMany({
    data: [
      {
        orgId: org.id,
        userId: ownerUser.id,
        role: "owner",
        onboardingCompletedAt: now,
        collectionNoticeAckAt: now,
        collectionNoticeVersion: COLLECTION_NOTICE_VERSION,
      },
      {
        orgId: org.id,
        userId: developerUser.id,
        role: "user",
        onboardingCompletedAt: now,
        collectionNoticeAckAt: now,
        collectionNoticeVersion: COLLECTION_NOTICE_VERSION,
      },
    ],
  });
  await prisma.developer.create({ data: { id: "e2e-owner", orgId: org.id, name: "E2E Owner", email: ownerEmail, role: "owner", authUserId: ownerUser.id } });
  const developer = await prisma.developer.create({ data: { id: "e2e-developer", orgId: org.id, name: "E2E Developer", email: developerEmail, role: "user", authUserId: developerUser.id } });
  const deviceSeenAt = new Date();
  const device = await prisma.device.create({
    data: {
      orgId: org.id,
      userId: developer.id,
      hostname: "e2e-laptop",
      os: "darwin",
      architecture: "arm64",
      agentVersion: "0.1.0",
      deviceToken: "uj_e2e_calculation_device",
      lastSeenAt: deviceSeenAt,
      lastToolsSyncAt: deviceSeenAt,
      lastUsageSyncAt: deviceSeenAt,
    },
  });
  await prisma.toolInstallation.create({
    data: {
      orgId: org.id,
      userId: developer.id,
      deviceId: device.id,
      toolName: "cursor",
      detected: true,
      configured: true,
      version: "1.0.0",
      lastCheckedAt: now,
    },
  });
  await prisma.toolInstallation.create({
    data: {
      orgId: org.id,
      userId: developer.id,
      deviceId: device.id,
      toolName: "opencode",
      detected: true,
      configured: true,
      version: "1.17.16",
      lastCheckedAt: now,
    },
  });

  await prisma.toolAccount.createMany({
    data: [
      {
        orgId: org.id,
        userId: developer.id,
        deviceId: device.id,
        toolName: "cursor",
        accountKey: "work",
        email: developerEmail,
        plan: "pro",
        loginMethod: "email",
        authPresent: true,
        usageEnabled: true,
        loggingEnabled: false,
      },
      {
        orgId: org.id,
        userId: developer.id,
        deviceId: device.id,
        toolName: "opencode",
        accountKey: "personal",
        email: developerEmail,
        plan: null,
        loginMethod: "email",
        authPresent: true,
        usageEnabled: false,
        loggingEnabled: false,
      },
    ],
  });

  await prisma.billingPlanTemplate.create({
    data: {
      id: "e2e-cursor-pro-plan",
      orgId: org.id,
      provider: "cursor",
      product: "cursor",
      toolName: "cursor",
      toolKey: "cursor",
      catalogPlanKey: "pro",
      name: "Cursor Pro",
      tier: "pro",
      billingCadence: "monthly",
      billingCycleAnchorDate: new Date("2026-07-01T00:00:00.000Z"),
      seatCapacity: 2,
      cycleSeatMicros: BigInt(20_000_000),
      includedCycleMicros: BigInt(5_000_000),
      inputRateMicrosPerMillion: BigInt(2_000_000),
      outputRateMicrosPerMillion: BigInt(4_000_000),
      cacheRateMicrosPerMillion: BigInt(1_000_000),
      createdByUserId: ownerUser.id,
      customPrice: false,
      priceSource: "e2e",
      priceVerifiedAt: new Date("2026-07-01T00:00:00.000Z"),
    },
  });
  await prisma.developerPlanAssignment.create({
    data: {
      id: "e2e-cursor-pro-assignment",
      orgId: org.id,
      developerId: developer.id,
      planTemplateId: "e2e-cursor-pro-plan",
      provider: "cursor",
      product: "cursor",
      toolName: "cursor",
      planName: "Cursor Pro",
      planTier: "pro",
      billingCadence: "monthly",
      billingCycleAnchorDate: new Date("2026-07-01T00:00:00.000Z"),
      cycleSeatMicros: BigInt(20_000_000),
      includedCycleMicros: BigInt(5_000_000),
      inputRateMicrosPerMillion: BigInt(2_000_000),
      outputRateMicrosPerMillion: BigInt(4_000_000),
      cacheRateMicrosPerMillion: BigInt(1_000_000),
      seatCount: 1,
      seatStatus: "active",
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      source: "admin_confirmed",
      createdByUserId: ownerUser.id,
    },
  });

  const openAiConnection = await prisma.providerConnection.create({
    data: {
      id: "e2e-openai-connection",
      orgId: org.id,
      provider: "openai",
      product: "api_platform",
      method: "admin_api_key",
      status: "active",
      permissions: ["organization_usage:read", "organization_costs:read"],
      lastSyncedAt: new Date("2026-07-16T10:00:00.000Z"),
      lastCostSyncedAt: new Date("2026-07-15T23:59:59.000Z"),
      costDataThrough: new Date("2026-07-15T23:59:59.000Z"),
      createdByUserId: ownerUser.id,
    },
  });
  const anthropicConnection = await prisma.providerConnection.create({
    data: {
      id: "e2e-anthropic-connection",
      orgId: org.id,
      provider: "anthropic",
      product: "api_platform",
      method: "admin_api_key",
      status: "degraded",
      permissions: ["organization_usage:read", "organization_costs:read"],
      lastSyncedAt: new Date("2026-07-16T09:00:00.000Z"),
      lastCostSyncedAt: new Date("2026-07-15T23:59:59.000Z"),
      costDataThrough: new Date("2026-07-15T23:59:59.000Z"),
      lastError: "E2E degraded connection",
      createdByUserId: ownerUser.id,
    },
  });
  await prisma.apiCreditPool.createMany({
    data: [
      {
        id: "e2e-openai-pool", orgId: org.id, connectionId: openAiConnection.id, provider: "openai", product: "api_platform",
        name: "OpenAI API credits", mode: "recurring", budgetMicros: BigInt(100_000_000), billingCadence: "monthly",
        billingCycleAnchorDate: new Date("2026-07-01T00:00:00.000Z"), createdByUserId: ownerUser.id,
      },
      {
        id: "e2e-anthropic-pool", orgId: org.id, connectionId: anthropicConnection.id, provider: "anthropic", product: "api_platform",
        name: "Anthropic API credits", mode: "fixed", budgetMicros: BigInt(50_000_000), grantStartDate: new Date("2026-07-01T00:00:00.000Z"),
        expiresAt: new Date("2026-09-01T00:00:00.000Z"), createdByUserId: ownerUser.id,
      },
    ],
  });
  await prisma.providerApiKey.createMany({
    data: [
      {
        id: "e2e-openai-key-mapped", orgId: org.id, connectionId: openAiConnection.id, developerId: developer.id,
        externalKeyId: "key_e2e_mapped", name: "Production backend", redactedHint: "sk-...1234", projectId: "project-production",
        ownerEmail: developer.email, principalType: "user", mappingSource: "provider_owner",
      },
      {
        id: "e2e-openai-key-unmapped", orgId: org.id, connectionId: openAiConnection.id,
        externalKeyId: "key_e2e_unmapped", name: "Legacy service", redactedHint: "sk-...5678", projectId: "project-legacy",
        principalType: "service_account",
      },
      {
        id: "e2e-anthropic-key-unmapped", orgId: org.id, connectionId: anthropicConnection.id,
        externalKeyId: "apikey_e2e_unmapped", name: "Claude worker", redactedHint: "...cdef", workspaceId: "workspace-ai",
        principalType: "service_account",
      },
    ],
  });

  const usageFrom = new Date("2026-07-01T00:00:00.000Z");
  const usageTo = new Date("2026-07-16T00:00:00.000Z");

  await prisma.usageDaily.createMany({
    data: [
      {
        orgId: org.id, developerId: developer.id, deviceId: device.id, date: new Date("2026-07-10T00:00:00.000Z"), provider: "cursor", product: "cursor", toolName: "cursor", model: "gpt-4.1", source: "vendor_verified", verified: true, requests: 10, inputTokens: BigInt(1_000_000), outputTokens: BigInt(500_000), costMicros: BigInt(5_000_000), costKind: "verified_usage", accountKey: "work", dedupeKey: "e2e:cursor:2026-07-10", observedAt: now,
      },
      {
        orgId: org.id, developerId: developer.id, deviceId: device.id, date: new Date("2026-07-11T00:00:00.000Z"), provider: "cursor", product: "cursor", toolName: "cursor", model: "gpt-4.1", source: "estimated", requests: 5, inputTokens: BigInt(100), outputTokens: BigInt(50), costMicros: BigInt(1_000_000), costKind: "estimated_api", accountKey: "work", dedupeKey: "e2e:cursor:2026-07-11", observedAt: now,
      },
      {
        orgId: org.id, developerId: developer.id, connectionId: openAiConnection.id, date: new Date("2026-07-12T00:00:00.000Z"), provider: "openai", product: "api_platform", toolName: "openai-api", model: "gpt-5", source: "vendor_verified", verified: true, requests: 25, inputTokens: BigInt(2_000_000), outputTokens: BigInt(500_000), dedupeKey: "e2e:openai:usage:mapped", observedAt: now, metadata: { apiKeyId: "key_e2e_mapped", projectId: "project-production" },
      },
      {
        orgId: org.id, connectionId: openAiConnection.id, date: new Date("2026-07-12T00:00:00.000Z"), provider: "openai", product: "api_platform", toolName: "openai-api", source: "vendor_verified", verified: true, costMicros: BigInt(12_000_000), costKind: "verified_usage", dedupeKey: "e2e:openai:cost", observedAt: now, metadata: { projectId: "project-production", lineItem: "Responses API" },
      },
      {
        orgId: org.id, developerId: developer.id, date: new Date("2026-07-16T00:00:00.000Z"), provider: "openai", product: "gateway", toolName: "junction-gateway", model: "gpt-5", source: "gateway_observed", requests: 3, inputTokens: BigInt(200_000), outputTokens: BigInt(50_000), costMicros: BigInt(1_000_000), costKind: "estimated_api", dedupeKey: "e2e:openai:gateway:pending", observedAt: now,
      },
      {
        orgId: org.id, connectionId: anthropicConnection.id, date: new Date("2026-07-13T00:00:00.000Z"), provider: "anthropic", product: "api_platform", toolName: "anthropic-api", model: "claude-sonnet-4", source: "vendor_verified", verified: true, requests: 12, inputTokens: BigInt(1_000_000), outputTokens: BigInt(200_000), dedupeKey: "e2e:anthropic:usage", observedAt: now, metadata: { apiKeyId: "apikey_e2e_unmapped", workspaceId: "workspace-ai" },
      },
      {
        orgId: org.id, connectionId: anthropicConnection.id, date: new Date("2026-07-13T00:00:00.000Z"), provider: "anthropic", product: "api_platform", toolName: "anthropic-api", source: "vendor_verified", verified: true, costMicros: BigInt(8_000_000), costKind: "verified_usage", dedupeKey: "e2e:anthropic:cost", observedAt: now, metadata: { workspaceId: "workspace-ai", description: "Claude usage" },
      },
      {
        orgId: org.id, developerId: developer.id, deviceId: device.id, date: new Date("2026-07-14T00:00:00.000Z"), provider: "opencode", product: "opencode", toolName: "opencode", model: "opencode-go/kimi-k2.7-code", source: "device_observed", verified: false, requests: 28, inputTokens: BigInt(121_126), outputTokens: BigInt(8_927), costMicros: BigInt(376_150), costKind: "actual_spend", metricKind: "usage", accountKey: "personal", dedupeKey: "e2e:opencode:usage:2026-07-14", observedAt: now,
      },
      {
        orgId: org.id, developerId: developer.id, deviceId: device.id, date: new Date("2026-07-14T00:00:00.000Z"), provider: "opencode", product: "opencode", toolName: "opencode", model: "opencode", source: "device_observed", verified: false, requests: 3, addedLines: 120, deletedLines: 30, metricKind: "productivity", accountKey: "personal", dedupeKey: "e2e:opencode:local:2026-07-14", observedAt: now,
      },
    ],
  });

  // Page loaders read sealed org-day snapshots only — materialize after direct usage_daily inserts.
  const { materializeOrgUsageRange } = await import("../lib/analytics/snapshots");
  const snapshotRows = await materializeOrgUsageRange(org.id, usageFrom, usageTo);
  if (snapshotRows <= 0) {
    throw new Error(`e2e seed expected org usage snapshots; materialize wrote ${snapshotRows} rows`);
  }

  await prisma.localWorkSession.create({
    data: {
      id: "e2e-opencode-work-session",
      orgId: org.id,
      developerId: developer.id,
      deviceId: device.id,
      localId: "opencode:ses-work-1",
      toolName: "opencode",
      model: "opencode/big-pickle",
      title: "Ship onboarding polish",
      observedAt: new Date("2026-07-14T11:30:00.000Z"),
      startedAt: new Date("2026-07-14T11:00:00.000Z"),
      endedAt: new Date("2026-07-14T11:30:00.000Z"),
      source: "opencode_sessions",
      trace: {
        location: { kind: "workspace", project: "acme-web" },
        stats: { linesAdded: 42, linesRemoved: 7, filesChanged: 3 },
      },
    },
  });
  await prisma.signalsPolicy.create({
    data: { orgId: org.id, enabled: false, retentionDays: 90, collectionMode: "app_domain", excludedApps: [], excludedDomains: [], storeEvents: false, updatedByUserId: ownerUser.id },
  });
  await prisma.signalsSession.create({
    data: {
      id: "e2e-signal-session",
      orgId: org.id,
      developerId: developer.id,
      deviceId: device.id,
      localId: "e2e-session-1",
      startedAt: new Date("2026-07-15T10:00:00.000Z"),
      endedAt: new Date("2026-07-15T10:02:00.000Z"),
      durationSeconds: 120,
      aiTool: "cursor",
      appBefore: "Google Chrome",
      domainBefore: "github.com",
      appAfter: "Slack",
      domainAfter: "slack.com",
      flowSignature: journey,
      confidence: 0.9,
      collectionMode: "app_domain",
      steps: [{ label: "github.com", startedAt: "2026-07-15T10:00:00.000Z", endedAt: "2026-07-15T10:00:30.000Z" }],
    },
  });

  const featureDay = new Date();
  featureDay.setUTCHours(0, 0, 0, 0);
  featureDay.setUTCDate(featureDay.getUTCDate() - 7);
  const githubConnection = await prisma.providerConnection.create({
    data: {
      id: "e2e-github-connection",
      orgId: org.id,
      provider: "github",
      product: "copilot",
      method: "oauth",
      status: "active",
      externalOrgId: "acme",
      config: { product: "copilot", org: "acme", installationId: "12345", accountType: "Organization", githubMemberLogins: "ada" },
      permissions: { pull_requests: "read", contents: "read", issues: "read", metadata: "read", members: "read" },
      lastSyncedAt: now,
      createdByUserId: ownerUser.id,
    },
  });
  const repo = await prisma.repository.create({
    data: { id: "e2e-repo", orgId: org.id, host: "github.com", owner: "acme", name: "app" },
  });
  await prisma.externalIdentity.createMany({
    data: [
      { id: "e2e-github-ada", orgId: org.id, connectionId: githubConnection.id, developerId: developer.id, provider: "github", externalUserId: "ada", email: developerEmail, matchedBy: "email" },
      { id: "e2e-github-ghost", orgId: org.id, connectionId: githubConnection.id, provider: "github", externalUserId: "ghost", matchedBy: null },
    ],
  });
  const featurePr = await prisma.gitPullRequest.create({
    data: {
      id: "e2e-pr-482",
      orgId: org.id,
      connectionId: githubConnection.id,
      repositoryId: repo.id,
      number: 482,
      title: "PAY-219 checkout",
      state: "merged",
      headRefName: "feature/pay-219-checkout",
      authorLogin: "ada",
      authorDeveloperId: developer.id,
      url: "https://github.com/acme/app/pull/482",
      githubCreatedAt: new Date(featureDay.getTime() - 86_400_000),
      mergedAt: new Date(featureDay.getTime() + 18 * 3_600_000),
      additions: 40,
      deletions: 6,
      changedFiles: 3,
      ticketKeys: ["PAY-219"],
    },
  });
  const unlinkedPr = await prisma.gitPullRequest.create({
    data: {
      id: "e2e-pr-12",
      orgId: org.id,
      connectionId: githubConnection.id,
      repositoryId: repo.id,
      number: 12,
      title: "Tidy readme",
      state: "merged",
      authorLogin: "ada",
      authorDeveloperId: developer.id,
      githubCreatedAt: new Date(featureDay.getTime() + 8 * 3_600_000),
      mergedAt: new Date(featureDay.getTime() + 9 * 3_600_000),
      ticketKeys: [],
    },
  });
  await prisma.gitCommit.createMany({
    data: [
      { orgId: org.id, repositoryId: repo.id, sha: "aaa111aaa111aaa111aaa111aaa111aaa111aaa1", authoredAt: new Date(featureDay.getTime() + 12 * 3_600_000), committedAt: new Date(featureDay.getTime() + 12 * 3_600_000), authorLogin: "ada", authorDeveloperId: developer.id, messageHeadline: "PAY-219 implement checkout", pullRequestId: featurePr.id, ticketKeys: ["PAY-219"] },
      { orgId: org.id, repositoryId: repo.id, sha: "aaa222aaa222aaa222aaa222aaa222aaa222aaa2", authoredAt: new Date(featureDay.getTime() + 13 * 3_600_000), committedAt: new Date(featureDay.getTime() + 13 * 3_600_000), authorLogin: "ada", authorDeveloperId: developer.id, messageHeadline: "PAY-219 tests", pullRequestId: featurePr.id, ticketKeys: ["PAY-219"] },
      { orgId: org.id, repositoryId: repo.id, sha: "bbb111bbb111bbb111bbb111bbb111bbb111bbb1", authoredAt: new Date(featureDay.getTime() + 8.5 * 3_600_000), committedAt: new Date(featureDay.getTime() + 8.5 * 3_600_000), authorLogin: "ada", authorDeveloperId: developer.id, messageHeadline: "readme", pullRequestId: unlinkedPr.id, ticketKeys: [] },
      { orgId: org.id, repositoryId: repo.id, sha: "ccc111ccc111ccc111ccc111ccc111ccc111ccc1", authoredAt: new Date(featureDay.getTime() + 15 * 3_600_000), committedAt: new Date(featureDay.getTime() + 15 * 3_600_000), authorLogin: "ghost", messageHeadline: "drive-by", isDirectPush: true, ticketKeys: [] },
    ],
  });
  await prisma.featureCostAllocation.createMany({
    data: [
      { orgId: org.id, date: featureDay, developerId: developer.id, repositoryId: repo.id, pullRequestId: featurePr.id, costKind: "verified_usage", costMicros: BigInt(4_000_000), weight: 2, method: "commit_split", calculationVersion: "usage-v2:feature-v4" },
      { orgId: org.id, date: featureDay, developerId: developer.id, repositoryId: repo.id, commitSha: "bbb111bbb111bbb111bbb111bbb111bbb111bbb1", pullRequestId: unlinkedPr.id, costKind: "verified_usage", costMicros: BigInt(1_000_000), weight: 1, method: "commit_split", calculationVersion: "usage-v2:feature-v4" },
    ],
  });
  await prisma.providerConnectionCapability.createMany({
    data: [
      { orgId: org.id, connectionId: githubConnection.id, capability: "pull_requests", status: "available", lastSuccessAt: now, lastCheckedAt: now },
      { orgId: org.id, connectionId: githubConnection.id, capability: "org_members", status: "available", lastSuccessAt: now, lastCheckedAt: now, cursor: "1" },
    ],
  });

  await prisma.teamInviteLink.create({
    data: {
      orgId: org.id,
      tokenHash: hashOpaqueToken(teamInviteToken),
      tokenReveal: teamInviteToken,
      enabled: true,
      rotatedAt: now,
    },
  });
  await prisma.organizationInvite.create({
    data: {
      orgId: org.id,
      email: inviteeEmail,
      role: "user",
      tokenHash: hashOpaqueToken(orgInviteToken),
      expiresAt: inviteExpiresAt,
      invitedByUserId: ownerUser.id,
    },
  });

  console.log(
    JSON.stringify({
      orgId: org.id,
      ownerEmail,
      developerEmail,
      password,
      journey,
      teamInviteToken,
      orgInviteToken,
      inviteeEmail,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await disconnect?.();
});
