import { prisma } from "@usejunction/db";
import { sendDailyReportEmail, sendTeamReminderEmail } from "@/lib/email/daily-report";
import {
  UndeliverableEmailRecipientError,
  isUndeliverableEmailRecipient,
} from "@/lib/email/recipient";
import {
  getDailyReportPayload,
  isEmptyReport,
  type DailyReportKind,
  type DailyReportPeriod,
} from "@/lib/reports/daily-report";
import {
  isDueForDailyReport,
  isDueForDailyReportAtUtcHour,
  isDueForWeeklyOrgReport,
  isDueForWeeklyOrgReportAtUtcHour,
  localDateString,
  normalizeTimeZone,
  utcHourProbeDate,
  weekRangeEndingOnOrBefore,
} from "@/lib/timezone";
import { logServerError } from "@/lib/errors/public";

const ADMIN_ROLES = new Set(["owner", "admin"]);

/** Delivery-log kinds: the two report kinds plus the empty-week team reminder. */
type DeliveryKind = DailyReportKind | "org_reminder";

export type DailyReportSendResult = {
  scanned: number;
  due: number;
  sent: number;
  /** Team admins nudged with a reminder because the team week had no usage. */
  reminded: number;
  skipped: number;
  failed: number;
  utcHour?: number;
};

async function alreadyDelivered(input: {
  userId: string;
  orgId: string;
  kind: DeliveryKind;
  localDate: string;
}) {
  const row = await prisma.dailyReportDelivery.findUnique({
    where: {
      userId_orgId_kind_localDate: {
        userId: input.userId,
        orgId: input.orgId,
        kind: input.kind,
        localDate: input.localDate,
      },
    },
    select: { status: true },
  });
  return row?.status === "success";
}

async function recordDelivery(input: {
  userId: string;
  orgId: string;
  kind: DeliveryKind;
  localDate: string;
  status: "success" | "failed";
  error?: string;
}) {
  await prisma.dailyReportDelivery.upsert({
    where: {
      userId_orgId_kind_localDate: {
        userId: input.userId,
        orgId: input.orgId,
        kind: input.kind,
        localDate: input.localDate,
      },
    },
    create: {
      userId: input.userId,
      orgId: input.orgId,
      kind: input.kind,
      localDate: input.localDate,
      status: input.status,
      error: input.error,
    },
    update: {
      status: input.status,
      error: input.error ?? null,
    },
  });
}

export type DailyReportSendOptions = {
  /** Dev/test only: send regardless of local 19:00 hour / Sunday gate. */
  ignoreHour?: boolean;
  /** Dev/test only: send even if already delivered for localDate. */
  resend?: boolean;
  /**
   * UTC hour bucket (0–23) for Hobby-compatible once-daily Vercel crons.
   * When set, due checks use a mid-hour probe so half-hour offsets stay stable.
   */
  utcHour?: number;
};

async function sendOne(input: {
  userId: string;
  orgId: string;
  email: string;
  name: string | null;
  kind: DailyReportKind;
  developerId: string | null;
  timeZone: string;
  localDate: string;
  period: DailyReportPeriod;
  resend?: boolean;
}) {
  if (!input.resend && (await alreadyDelivered(input))) return "skipped" as const;
  if (isUndeliverableEmailRecipient(input.email)) {
    console.info(
      `[daily-report-send] skipped undeliverable recipient userId=${input.userId} orgId=${input.orgId} kind=${input.kind} to=${input.email}`,
    );
    return "skipped" as const;
  }
  try {
    const report = await getDailyReportPayload({
      orgId: input.orgId,
      kind: input.kind,
      developerId: input.developerId,
      timeZone: input.timeZone,
      localDate: input.localDate,
      period: input.period,
    });
    if (isEmptyReport(report)) {
      // Never send an empty report. Team admins get a nudge instead.
      if (input.kind !== "org") return "skipped" as const;
      return await sendTeamReminder({ ...input, localDate: report.localDate, report });
    }
    await sendDailyReportEmail({
      to: input.email,
      report,
      recipientName: input.name,
    });
    // Idempotency key: personal uses the calendar day; team weekly uses week-end Sunday.
    await recordDelivery({
      userId: input.userId,
      orgId: input.orgId,
      kind: input.kind,
      localDate: report.localDate,
      status: "success",
    });
    return "sent" as const;
  } catch (error) {
    if (error instanceof UndeliverableEmailRecipientError) {
      console.info(
        `[daily-report-send] skipped undeliverable recipient userId=${input.userId} orgId=${input.orgId} kind=${input.kind} to=${input.email}`,
      );
      return "skipped" as const;
    }
    logServerError("daily-report-send", error, {
      userId: input.userId,
      orgId: input.orgId,
      kind: input.kind,
    });
    await recordDelivery({
      userId: input.userId,
      orgId: input.orgId,
      kind: input.kind,
      localDate: input.localDate,
      status: "failed",
      error: error instanceof Error ? error.message.slice(0, 500) : "send failed",
    });
    return "failed" as const;
  }
}

async function sendTeamReminder(input: {
  userId: string;
  orgId: string;
  email: string;
  name: string | null;
  localDate: string;
  report: { weekStart?: string; weekEnd?: string; localDate: string };
  resend?: boolean;
}) {
  const key = {
    userId: input.userId,
    orgId: input.orgId,
    kind: "org_reminder" as const,
    localDate: input.localDate,
  };
  if (!input.resend && (await alreadyDelivered(key))) return "skipped" as const;
  const org = await prisma.organization.findUnique({
    where: { id: input.orgId },
    select: { name: true },
  });
  await sendTeamReminderEmail({
    to: input.email,
    organizationName: org?.name ?? "",
    weekStart: input.report.weekStart ?? input.report.localDate,
    weekEnd: input.report.weekEnd ?? input.report.localDate,
    recipientName: input.name,
  });
  await recordDelivery({ ...key, status: "success" });
  return "reminded" as const;
}

const membershipInclude = {
  user: {
    select: {
      id: true,
      email: true,
      name: true,
      timeZone: true,
      notificationPreferences: true,
      developerProfiles: {
        where: { removedAt: null },
        select: { id: true, orgId: true },
      },
    },
  },
} as const;

async function loadMembershipsForUtcHour(utcHour: number, now: Date) {
  const zoneRows = await prisma.user.findMany({
    where: { memberships: { some: {} } },
    distinct: ["timeZone"],
    select: { timeZone: true },
  });
  const dueZones = new Set<string>();
  for (const row of zoneRows) {
    const tz = normalizeTimeZone(row.timeZone);
    if (
      isDueForDailyReportAtUtcHour(utcHour, tz, now) ||
      isDueForWeeklyOrgReportAtUtcHour(utcHour, tz, now)
    ) {
      dueZones.add(tz);
    }
  }

  if (dueZones.size === 0) return [];

  const zoneList = [...dueZones];
  return prisma.organizationMembership.findMany({
    where: {
      OR: [
        { user: { timeZone: { in: zoneList } } },
        // unset timeZone normalizes to UTC
        ...(dueZones.has("UTC")
          ? [{ user: { OR: [{ timeZone: null }, { timeZone: "" }] } }]
          : []),
      ],
    },
    include: membershipInclude,
  });
}

/**
 * Fan out report emails:
 * - Personal: daily at 19:00 local
 * - Team/org: weekly on Sunday at 19:00 local (Mon–Sun numbers)
 *
 * Pass `utcHour` when invoked from the 24 once-daily Vercel crons so each
 * bucket only loads memberships whose timezone is due in that UTC hour.
 */
export async function runDailyReportSend(
  now = new Date(),
  options: DailyReportSendOptions = {},
): Promise<DailyReportSendResult> {
  const { ignoreHour = false, resend = false, utcHour } = options;
  const probe =
    utcHour != null && !ignoreHour ? utcHourProbeDate(now, utcHour) : now;

  const memberships =
    utcHour != null && !ignoreHour
      ? await loadMembershipsForUtcHour(utcHour, now)
      : await prisma.organizationMembership.findMany({ include: membershipInclude });

  const result: DailyReportSendResult = {
    scanned: memberships.length,
    due: 0,
    sent: 0,
    reminded: 0,
    skipped: 0,
    failed: 0,
    ...(utcHour != null ? { utcHour } : {}),
  };

  for (const membership of memberships) {
    const timeZone = normalizeTimeZone(membership.user.timeZone);
    const dailyDue =
      ignoreHour ||
      (utcHour != null
        ? isDueForDailyReportAtUtcHour(utcHour, timeZone, now)
        : isDueForDailyReport(probe, timeZone));
    const weeklyDue =
      ignoreHour ||
      (utcHour != null
        ? isDueForWeeklyOrgReportAtUtcHour(utcHour, timeZone, now)
        : isDueForWeeklyOrgReport(probe, timeZone));
    if (!dailyDue && !weeklyDue) continue;
    result.due += 1;

    const localDate = localDateString(probe, timeZone);
    const prefs =
      membership.user.notificationPreferences.find((p) => p.orgId === membership.orgId) ?? null;
    const personalEnabled = prefs?.dailyPersonalEnabled ?? true;
    const orgEnabled = prefs?.dailyOrgEnabled ?? true;
    const developerId =
      membership.user.developerProfiles.find((d) => d.orgId === membership.orgId)?.id ?? null;

    if (dailyDue && personalEnabled && developerId) {
      const outcome = await sendOne({
        userId: membership.user.id,
        orgId: membership.orgId,
        email: membership.user.email,
        name: membership.user.name,
        kind: "personal",
        developerId,
        timeZone,
        localDate,
        period: "day",
        resend,
      });
      result[outcome] += 1;
    }

    if (weeklyDue && orgEnabled && ADMIN_ROLES.has(membership.role)) {
      const { end: weekEnd } = weekRangeEndingOnOrBefore(localDate);
      const outcome = await sendOne({
        userId: membership.user.id,
        orgId: membership.orgId,
        email: membership.user.email,
        name: membership.user.name,
        kind: "org",
        developerId: null,
        timeZone,
        localDate: weekEnd,
        period: "week",
        resend,
      });
      result[outcome] += 1;
    }
  }

  return result;
}
