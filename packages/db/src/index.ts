import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

/**
 * Bump when Device (or other hot models) gain fields so a long-lived Next.js
 * process drops a stale PrismaClient after `prisma generate`.
 */
const PRISMA_SCHEMA_REV = "account-collection-v2";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSchemaRev?: string;
};

function databasePoolMax() {
  const configured = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 5;
}

function createPrismaClient() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: databasePoolMax(),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    // Prisma's adapter decodes PostgreSQL timestamps as UTC. Pinning the
    // session timezone prevents a database-local offset from being applied
    // twice when deployed outside UTC.
    options: "-c timezone=UTC",
  });
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getPrisma(): PrismaClient {
  if (globalForPrisma.prisma && globalForPrisma.prismaSchemaRev === PRISMA_SCHEMA_REV) {
    return globalForPrisma.prisma;
  }
  if (globalForPrisma.prisma) {
    void globalForPrisma.prisma.$disconnect().catch(() => undefined);
  }
  const client = createPrismaClient();
  // Next.js can evaluate the database package from several server chunks in one
  // process. Keep exactly one adapter-backed pool for development and deployed
  // functions alike.
  globalForPrisma.prisma = client;
  globalForPrisma.prismaSchemaRev = PRISMA_SCHEMA_REV;
  return client;
}

export const prisma = getPrisma();

export { Prisma, PrismaClient } from "@prisma/client";

export type {
  Account,
  AccountCollectionEvent,
  ActivitySettings,
  AgentRelease,
  AgentUpdateDeployment,
  AgentUpdateEvent,
  AnalyticsDirtyDay,
  AnalyticsWatermark,
  AppRuntimeSetting,
  OrgUsageDaySnapshot,
  AuditLog,
  ApiCreditPool,
  AuthActionToken,
  BillingPlanTemplate,
  DailyReportDelivery,
  DailyReportUsageSnapshot,
  Developer,
  DeveloperPlanAssignment,
  DeveloperToolClaim,
  Device,
  DeviceActivityEvent,
  DeviceSyncRequestTarget,
  EnrollmentToken,
  ExternalIdentity,
  LocalModel,
  LocalWorkSession,
  Organization,
  OrganizationDomain,
  OrganizationInvite,
  OrganizationMembership,
  PlanInterest,
  ProviderConnection,
  ProviderApiKey,
  ProviderConnectionCapability,
  ProviderSourceRecord,
  ProviderSyncRun,
  QuotaSnapshot,
  RateLimitBucket,
  Repository,
  RequestMetadata,
  SeatAssignment,
  Session,
  SignalsActivityEvent,
  SignalsPolicy,
  SignalsSession,
  SyncRequest,
  TeamInviteAllowlist,
  TeamInviteLink,
  TelemetryEndpoint,
  ToolAccount,
  ToolInstallation,
  UsageDaily,
  User,
  UserNotificationPreference,
  VerificationToken,
} from "@prisma/client";
