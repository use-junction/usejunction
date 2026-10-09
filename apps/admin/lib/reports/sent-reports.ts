import { prisma } from "@usejunction/db";
import { buildDailyReportEmailDocument } from "@/lib/email/daily-report-html";
import { getPublicAppUrl } from "@/lib/public-url";
import {
  getDailyReportPayload,
  type DailyReportKind,
  type DailyReportPeriod,
} from "@/lib/reports/daily-report";
import { weekdayOfLocalDate } from "@/lib/timezone";

export type SentReportKindFilter = "all" | "personal" | "org";

export type SentReportListItem = {
  id: string;
  kind: DailyReportKind;
  period: DailyReportPeriod;
  localDate: string;
  status: string;
  sentAt: string;
  recipientName: string | null;
  recipientEmail: string;
  subject: string;
  label: string;
};

function inferPeriod(kind: DailyReportKind, localDate: string): DailyReportPeriod {
  if (kind === "personal") return "day";
  // Legacy org daily rows pre-weekly; weekly org ends on Sunday.
  return weekdayOfLocalDate(localDate) === 0 ? "week" : "day";
}

function reportLabel(kind: DailyReportKind, period: DailyReportPeriod, localDate: string, weekStart?: string) {
  if (kind === "personal") return `Your day · ${localDate}`;
  if (period === "week") {
    const start = weekStart ?? localDate;
    return start === localDate ? `Team week · ${localDate}` : `Team week · ${start} – ${localDate}`;
  }
  return `Team day · ${localDate}`;
}

async function subjectForDelivery(input: {
  kind: DailyReportKind;
  period: DailyReportPeriod;
  localDate: string;
  orgId: string;
  userId: string;
}) {
  const [user, developer] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { name: true, timeZone: true },
    }),
    input.kind === "personal"
      ? prisma.developer.findFirst({
          where: { orgId: input.orgId, authUserId: input.userId, removedAt: null },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  if (input.kind === "personal" && !developer) {
    return {
      subject: `Your UseJunction day · ${input.localDate}`,
      recipientName: user?.name ?? null,
      weekStart: undefined as string | undefined,
    };
  }
  try {
    const report = await getDailyReportPayload({
      orgId: input.orgId,
      kind: input.kind,
      developerId: developer?.id,
      timeZone: user?.timeZone,
      localDate: input.localDate,
      period: input.period,
    });
    const built = buildDailyReportEmailDocument({
      report,
      recipientName: user?.name,
      appOrigin: getPublicAppUrl(),
    });
    return {
      subject: built.subject,
      recipientName: user?.name ?? null,
      weekStart: report.weekStart,
    };
  } catch {
    const subject =
      input.kind === "personal"
        ? `Your UseJunction day · ${input.localDate}`
        : input.period === "week"
          ? `Team week · ${input.localDate}`
          : `Team day · ${input.localDate}`;
    return { subject, recipientName: user?.name ?? null, weekStart: undefined as string | undefined };
  }
}

export async function listSentReports(input: {
  orgId: string;
  viewerUserId: string;
  viewerRole: string;
  audience: "team" | "you";
  kind: SentReportKindFilter;
  limit: number;
  offset: number;
}): Promise<{ items: SentReportListItem[]; total: number }> {
  const isAdmin = input.viewerRole === "owner" || input.viewerRole === "admin";
  const isTeamAudience = input.audience === "team" && isAdmin;

  // Always scope to the viewer's inbox. Team = org digests they received;
  // You = personal digests. "All" on Team includes both so newly sent You
  // reports are visible without switching audience.
  let kindFilter: DailyReportKind | undefined;
  if (isTeamAudience) {
    if (input.kind === "personal") kindFilter = "personal";
    else if (input.kind === "org") kindFilter = "org";
    // kind === "all" → both
  } else {
    // You audience: personal only (block org filter)
    if (input.kind === "org") {
      return { items: [], total: 0 };
    }
    kindFilter = "personal";
  }

  const where = {
    orgId: input.orgId,
    userId: input.viewerUserId,
    status: "success",
    // Explicit list keeps non-report rows (e.g. empty-week reminders) out of the inbox.
    kind: kindFilter ?? { in: ["personal", "org"] },
  };

  const [rows, total] = await Promise.all([
    prisma.dailyReportDelivery.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { localDate: "desc" }],
      take: input.limit,
      skip: input.offset,
      include: {
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.dailyReportDelivery.count({ where }),
  ]);

  const items = await Promise.all(
    rows.map(async (row) => {
      const period = inferPeriod(row.kind as DailyReportKind, row.localDate);
      const { subject, weekStart } = await subjectForDelivery({
        kind: row.kind as DailyReportKind,
        period,
        localDate: row.localDate,
        orgId: row.orgId,
        userId: row.userId,
      });
      return {
        id: row.id,
        kind: row.kind as DailyReportKind,
        period,
        localDate: row.localDate,
        status: row.status,
        sentAt: row.createdAt.toISOString(),
        recipientName: row.user.name,
        recipientEmail: row.user.email,
        subject,
        label: reportLabel(row.kind as DailyReportKind, period, row.localDate, weekStart),
      } satisfies SentReportListItem;
    }),
  );

  return { items, total };
}

export async function getSentReportPreview(input: {
  orgId: string;
  deliveryId: string;
  viewerUserId: string;
  viewerRole: string;
  audience: "team" | "you";
}) {
  const row = await prisma.dailyReportDelivery.findFirst({
    where: {
      id: input.deliveryId,
      orgId: input.orgId,
      userId: input.viewerUserId,
      status: "success",
    },
    include: { user: { select: { id: true, name: true, email: true, timeZone: true } } },
  });
  if (!row) return null;

  const isAdmin = input.viewerRole === "owner" || input.viewerRole === "admin";
  const isTeamAudience = input.audience === "team" && isAdmin;
  // Team audience may preview personal + org for self; You only personal.
  const canView = isTeamAudience
    ? row.kind === "org" || row.kind === "personal"
    : row.kind === "personal";
  if (!canView) return null;

  const kind = row.kind as DailyReportKind;
  const period = inferPeriod(kind, row.localDate);
  const developer =
    kind === "personal"
      ? await prisma.developer.findFirst({
          where: { orgId: input.orgId, authUserId: row.userId, removedAt: null },
          select: { id: true },
        })
      : null;

  const report = await getDailyReportPayload({
    orgId: input.orgId,
    kind,
    developerId: developer?.id,
    timeZone: row.user.timeZone,
    localDate: row.localDate,
    period,
  });

  const email = buildDailyReportEmailDocument({
    report,
    recipientName: row.user.name,
    appOrigin: getPublicAppUrl(),
  });

  return {
    id: row.id,
    kind,
    period,
    localDate: row.localDate,
    sentAt: row.createdAt.toISOString(),
    recipientName: row.user.name,
    recipientEmail: row.user.email,
    report,
    subject: email.subject,
    html: email.html,
    text: email.text,
  };
}
