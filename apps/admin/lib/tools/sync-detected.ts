import { prisma } from "@usejunction/db";
import { assignmentSnapshot } from "@/lib/billing/assignments";
import {
  detectedCycleFromQuotas,
  detectedCycleSeatMicros,
  quotaToolNamesForKey,
  type QuotaResetRow,
} from "./detected-cycle";
import { canonicalToolKey, findCatalogPlan, findCatalogTool } from "./catalog";
import { deriveSubscription } from "./subscriptions";
import {
  canAutoCreateDetectedSeat,
  hasReportedVendorPlan,
  mapVendorPlanToCatalog,
  strongerVendorPlan,
} from "./detected-plan";
import { logServerError } from "@/lib/errors/public";

export type DetectedAccount = {
  toolName: string;
  plan?: string | null;
  email?: string | null;
  vendorOrgId?: string | null;
  authPresent?: boolean;
};

export {
  canAutoCreateDetectedSeat,
  hasReportedVendorPlan,
  mapVendorPlanToCatalog,
} from "./detected-plan";

function utcDateOnly(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Map each (toolKey, vendorOrgId) in an org to the strongest plan any login has
 * reported for that vendor org. Lets a login with no plan of its own inherit
 * the plan of a teammate on the same vendor org.
 */
async function buildOrgPlanMap(orgId: string): Promise<Map<string, string>> {
  const rows = await prisma.toolAccount.findMany({
    where: { orgId, vendorOrgId: { not: null }, plan: { not: null } },
    select: { toolName: true, vendorOrgId: true, plan: true },
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    const org = row.vendorOrgId?.trim();
    const plan = row.plan?.trim();
    if (!org || !plan) continue;
    const toolKey = canonicalToolKey(row.toolName);
    const key = `${toolKey}\u0000${org}`;
    const current = map.get(key);
    map.set(key, current ? strongerVendorPlan(toolKey, plan, current) : plan);
  }
  return map;
}

async function loadQuotaRowsForTool(orgId: string, toolKey: string): Promise<QuotaResetRow[]> {
  const names = quotaToolNamesForKey(toolKey);
  if (!names.length) return [];
  return prisma.quotaSnapshot.findMany({
    where: { orgId, toolName: { in: names } },
    select: {
      toolName: true,
      windowType: true,
      usedPercent: true,
      resetAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 40,
  });
}

function deriveDetectedSubscription(input: {
  toolKey: string;
  catalogPlanKey: string;
  quotas: QuotaResetRow[];
  seatCapacity?: number;
  existingAnchor?: Date | null;
  existingCadence?: string | null;
}) {
  const catalogPlan = findCatalogPlan(input.toolKey, input.catalogPlanKey);
  const cycle = detectedCycleFromQuotas(input.quotas, { toolKey: input.toolKey });
  const seatFromCadence = detectedCycleSeatMicros(input.toolKey, input.catalogPlanKey, cycle.billingCadence);

  // No billing-grade renewal (common for ChatGPT: weekly quotas only). Preserve an
  // existing monthly anchor; never promote a weekly quota reset into Plus renewal.
  const canPreserveAnchor =
    !cycle.nextRenewalDate &&
    input.existingAnchor &&
    (input.existingCadence ?? cycle.billingCadence) === cycle.billingCadence;

  return deriveSubscription({
    toolKey: input.toolKey,
    planKey: input.catalogPlanKey,
    billingCadence: cycle.billingCadence,
    usageWindowPreference: "auto",
    ...(cycle.nextRenewalDate
      ? { nextRenewalDate: cycle.nextRenewalDate }
      : canPreserveAnchor
        ? { billingCycleAnchorDate: utcDateOnly(input.existingAnchor!) }
        : {}),
    seatCapacity: input.seatCapacity ?? 1,
    ...(catalogPlan?.customPrice ? { cycleSeatMicros: BigInt(0) } : {}),
    ...(seatFromCadence !== undefined && !catalogPlan?.customPrice ? { cycleSeatMicros: seatFromCadence } : {}),
    notes: "Auto-synced from detected device usage",
  });
}

function cycleFieldsChanged(
  template: {
    billingCadence: string;
    billingCycleAnchorDate: Date | null;
    billingCycleDays: number | null;
    cycleSeatMicros: bigint;
  },
  derived: {
    billingCadence: string;
    billingCycleAnchorDate: Date;
    billingCycleDays: number | null;
    cycleSeatMicros: bigint;
  },
) {
  const anchor = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
  return (
    template.billingCadence !== derived.billingCadence ||
    anchor(template.billingCycleAnchorDate) !== anchor(derived.billingCycleAnchorDate) ||
    template.billingCycleDays !== derived.billingCycleDays ||
    template.cycleSeatMicros !== derived.cycleSeatMicros
  );
}

async function syncDetectedAssignmentsCycle(
  orgId: string,
  templateId: string,
  fields: {
    billingCadence: string;
    billingCycleAnchorDate: Date;
    billingCycleDays: number | null;
    cycleSeatMicros: bigint;
  },
) {
  await prisma.developerPlanAssignment.updateMany({
    where: {
      orgId,
      planTemplateId: templateId,
      active: true,
      seatStatus: "active",
      source: "detected",
    },
    data: {
      billingCadence: fields.billingCadence,
      billingCycleAnchorDate: fields.billingCycleAnchorDate,
      billingCycleDays: fields.billingCycleDays,
      cycleSeatMicros: fields.cycleSeatMicros,
    },
  });
}

async function ensureTemplate(input: {
  orgId: string;
  toolKey: string;
  catalogPlanKey: string;
  actorId: string;
}) {
  const quotas = await loadQuotaRowsForTool(input.orgId, input.toolKey);
  const existing = await prisma.billingPlanTemplate.findFirst({
    where: {
      orgId: input.orgId,
      toolKey: input.toolKey,
      catalogPlanKey: input.catalogPlanKey,
      active: true,
    },
  });

  if (existing) {
    if (existing.priceSource !== "detected") {
      return { template: existing, created: false, updated: false };
    }
    const derived = deriveDetectedSubscription({
      toolKey: input.toolKey,
      catalogPlanKey: input.catalogPlanKey,
      quotas,
      seatCapacity: existing.seatCapacity,
      existingAnchor: existing.billingCycleAnchorDate,
      existingCadence: existing.billingCadence,
    });
    if (!cycleFieldsChanged(existing, derived)) {
      return { template: existing, created: false, updated: false };
    }
    const template = await prisma.billingPlanTemplate.update({
      where: { id: existing.id },
      data: {
        billingCadence: derived.billingCadence,
        billingCycleAnchorDate: derived.billingCycleAnchorDate,
        billingCycleDays: derived.billingCycleDays,
        cycleSeatMicros: derived.cycleSeatMicros,
      },
    });
    await syncDetectedAssignmentsCycle(input.orgId, template.id, {
      billingCadence: derived.billingCadence,
      billingCycleAnchorDate: derived.billingCycleAnchorDate,
      billingCycleDays: derived.billingCycleDays,
      cycleSeatMicros: derived.cycleSeatMicros,
    });
    return { template, created: false, updated: true };
  }

  const derived = deriveDetectedSubscription({
    toolKey: input.toolKey,
    catalogPlanKey: input.catalogPlanKey,
    quotas,
  });

  const template = await prisma.billingPlanTemplate.create({
    data: {
      ...derived,
      orgId: input.orgId,
      createdByUserId: input.actorId,
      priceSource: "detected",
    },
  });
  return { template, created: true, updated: false };
}

async function deactivateOrphanDetectedTemplate(orgId: string, templateId: string) {
  const template = await prisma.billingPlanTemplate.findFirst({
    where: { id: templateId, orgId, active: true, priceSource: "detected" },
    select: { id: true },
  });
  if (!template) return;

  const remaining = await prisma.developerPlanAssignment.count({
    where: {
      orgId,
      planTemplateId: templateId,
      active: true,
      seatStatus: "active",
    },
  });
  if (remaining > 0) return;

  await prisma.billingPlanTemplate.update({
    where: { id: templateId },
    data: { active: false },
  });
}

async function ensureSeatAndAssign(input: {
  orgId: string;
  developerId: string;
  actorId: string;
  toolName: string;
  templateId: string;
  email: string | null;
}) {
  let template = await prisma.billingPlanTemplate.findFirstOrThrow({
    where: { id: input.templateId, orgId: input.orgId },
  });
  const aggregate = await prisma.developerPlanAssignment.aggregate({
    where: {
      orgId: input.orgId,
      planTemplateId: template.id,
      active: true,
      seatStatus: "active",
    },
    _sum: { seatCount: true },
  });
  const assignedSeats = aggregate._sum.seatCount ?? 0;
  if (assignedSeats + 1 > template.seatCapacity) {
    template = await prisma.billingPlanTemplate.update({
      where: { id: template.id },
      data: { seatCapacity: assignedSeats + 1 },
    });
  }

  const snapshot = assignmentSnapshot(template, {});
  await prisma.developerPlanAssignment.create({
    data: {
      ...snapshot,
      toolName: input.toolName,
      orgId: input.orgId,
      developerId: input.developerId,
      planTemplateId: template.id,
      startDate: utcDateOnly(),
      endDate: null,
      seatCount: 1,
      seatStatus: "active",
      source: "detected",
      vendorAccountEmail: input.email,
      notes: "Auto-synced from detected device usage",
      createdByUserId: input.actorId,
    },
  });
}

export async function syncDetectedPlansForDevice(input: {
  orgId: string;
  developerId: string;
  toolNames?: string[];
  accounts?: DetectedAccount[];
}) {
  const byTool = new Map<
    string,
    { plan: string | null; email: string | null; hasVendorPlan: boolean; authPresent: boolean }
  >();

  for (const name of input.toolNames ?? []) {
    const toolKey = canonicalToolKey(name);
    if (!findCatalogTool(toolKey)) continue;
    if (!byTool.has(toolKey)) {
      byTool.set(toolKey, { plan: null, email: null, hasVendorPlan: false, authPresent: false });
    }
  }

  // A login that carries no plan (e.g. a desktop-only Team account whose plan
  // we never read on this device) is resolved from its vendor org: any login in
  // this org that did report a plan for the same vendor org establishes it.
  const orgPlanMap = await buildOrgPlanMap(input.orgId);

  for (const account of input.accounts ?? []) {
    const toolKey = canonicalToolKey(account.toolName);
    if (!findCatalogTool(toolKey)) continue;
    let effectivePlan = account.plan ?? null;
    if (!hasReportedVendorPlan(effectivePlan) && account.vendorOrgId?.trim()) {
      effectivePlan = orgPlanMap.get(`${toolKey}\u0000${account.vendorOrgId.trim()}`) ?? effectivePlan;
    }
    const existing = byTool.get(toolKey) ?? {
      plan: null,
      email: null,
      hasVendorPlan: false,
      authPresent: false,
    };
    const hasVendorPlan = hasReportedVendorPlan(effectivePlan);
    const next = {
      plan: existing.plan,
      email: existing.email ?? account.email ?? null,
      hasVendorPlan: existing.hasVendorPlan || hasVendorPlan,
      authPresent: existing.authPresent || Boolean(account.authPresent),
    };
    // One person can have several logins for a tool (e.g. a personal Pro and a
    // work Team account). The seat is singular, so keep the strongest plan and
    // the email that goes with it, rather than letting the last account win.
    if (hasVendorPlan && effectivePlan) {
      if (!existing.plan || strongerVendorPlan(toolKey, effectivePlan, existing.plan) === effectivePlan) {
        next.plan = effectivePlan;
        next.email = account.email ?? existing.email ?? null;
      }
    }
    byTool.set(toolKey, next);
  }

  if (byTool.size === 0) return { created: 0, assigned: 0 };

  const developer = await prisma.developer.findFirst({
    where: { id: input.developerId, orgId: input.orgId },
    select: { id: true, authUserId: true },
  });
  if (!developer) return { created: 0, assigned: 0 };

  const actorId = developer.authUserId ?? developer.id;
  let created = 0;
  let assigned = 0;

  for (const [toolKey, meta] of byTool) {
    const tool = findCatalogTool(toolKey);
    if (!tool) continue;

    try {
      const existingAssignment = await prisma.developerPlanAssignment.findFirst({
        where: {
          orgId: input.orgId,
          developerId: developer.id,
          provider: tool.provider,
          product: tool.product,
          active: true,
          seatStatus: "active",
          OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
        },
        include: { template: { select: { id: true, catalogPlanKey: true, toolKey: true } } },
        orderBy: { createdAt: "desc" },
      });

      // Never invent a seat from tool detection alone — require a vendor plan or
      // authenticated account with a catalog default (e.g. Antigravity → individual).
      // If a prior auto-detected seat lost both vendor plan and auth, end it.
      if (!canAutoCreateDetectedSeat(toolKey, meta)) {
        if (existingAssignment?.source === "detected") {
          await prisma.developerPlanAssignment.update({
            where: { id: existingAssignment.id },
            data: { active: false, endDate: utcDateOnly(), seatStatus: "ended" },
          });
          if (existingAssignment.planTemplateId) {
            await deactivateOrphanDetectedTemplate(input.orgId, existingAssignment.planTemplateId);
          }
        } else if (existingAssignment && meta.email && !existingAssignment.vendorAccountEmail) {
          await prisma.developerPlanAssignment.update({
            where: { id: existingAssignment.id },
            data: { vendorAccountEmail: meta.email },
          });
        }
        continue;
      }

      const catalogPlanKey = mapVendorPlanToCatalog(toolKey, meta.plan);

      const ensured = await ensureTemplate({
        orgId: input.orgId,
        toolKey,
        catalogPlanKey,
        actorId,
      });
      const template = ensured.template;
      if (ensured.created) created += 1;

      if (existingAssignment?.planTemplateId === template.id) {
        if (meta.email && existingAssignment.vendorAccountEmail !== meta.email) {
          await prisma.developerPlanAssignment.update({
            where: { id: existingAssignment.id },
            data: { vendorAccountEmail: meta.email },
          });
        }
        continue;
      }

      if (existingAssignment) {
        // Keep admin-confirmed coverage; only migrate auto-detected seats when vendor plan differs.
        if (existingAssignment.source !== "detected") continue;
        if (existingAssignment.template.catalogPlanKey === catalogPlanKey) continue;
        const previousTemplateId = existingAssignment.planTemplateId;
        await prisma.developerPlanAssignment.update({
          where: { id: existingAssignment.id },
          data: { active: false, endDate: utcDateOnly(), seatStatus: "ended" },
        });
        if (previousTemplateId) {
          await deactivateOrphanDetectedTemplate(input.orgId, previousTemplateId);
        }
      }

      await ensureSeatAndAssign({
        orgId: input.orgId,
        developerId: developer.id,
        actorId,
        toolName: tool.toolName,
        templateId: template.id,
        email: meta.email,
      });
      assigned += 1;
    } catch (error) {
      logServerError("sync-detected", error, { toolKey });
    }
  }

  return { created, assigned };
}

/** Force-migrate a developer's detected seat to the vendor-reported catalog plan. */
export async function applyDetectedPlanForDeveloper(input: {
  orgId: string;
  developerId: string;
  toolKey: string;
  actorUserId: string;
}) {
  const tool = findCatalogTool(input.toolKey);
  if (!tool) throw new Error("CATALOG_TOOL_NOT_FOUND");

  const names = [tool.toolName, ...tool.aliases];
  const account = await prisma.toolAccount.findFirst({
    where: {
      orgId: input.orgId,
      userId: input.developerId,
      toolName: { in: names },
      plan: { not: null },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!account?.plan?.trim()) throw new Error("VENDOR_PLAN_NOT_FOUND");

  const catalogPlanKey = mapVendorPlanToCatalog(input.toolKey, account.plan);
  const ensured = await ensureTemplate({
    orgId: input.orgId,
    toolKey: input.toolKey,
    catalogPlanKey,
    actorId: input.actorUserId,
  });

  const existingAssignment = await prisma.developerPlanAssignment.findFirst({
    where: {
      orgId: input.orgId,
      developerId: input.developerId,
      provider: tool.provider,
      product: tool.product,
      active: true,
      seatStatus: "active",
      OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
  });

  if (existingAssignment?.planTemplateId === ensured.template.id) {
    return { template: ensured.template, migrated: false, catalogPlanKey };
  }

  if (existingAssignment) {
    if (existingAssignment.source !== "detected") throw new Error("ADMIN_ASSIGNMENT_LOCKED");
    const previousTemplateId = existingAssignment.planTemplateId;
    await prisma.developerPlanAssignment.update({
      where: { id: existingAssignment.id },
      data: { active: false, endDate: utcDateOnly(), seatStatus: "ended" },
    });
    if (previousTemplateId) {
      await deactivateOrphanDetectedTemplate(input.orgId, previousTemplateId);
    }
  }

  await ensureSeatAndAssign({
    orgId: input.orgId,
    developerId: input.developerId,
    actorId: input.actorUserId,
    toolName: tool.toolName,
    templateId: ensured.template.id,
    email: account.email,
  });

  return { template: ensured.template, migrated: true, catalogPlanKey };
}

/**
 * Recompute cadence/anchors for all active detected plan templates from live quotas.
 * Safe to run repeatedly (idempotent when quotas unchanged).
 */
export async function repairDetectedPlanCycles(orgId?: string) {
  const templates = await prisma.billingPlanTemplate.findMany({
    where: {
      active: true,
      priceSource: "detected",
      ...(orgId ? { orgId } : {}),
      toolKey: { not: null },
      catalogPlanKey: { not: null },
    },
    select: {
      id: true,
      orgId: true,
      toolKey: true,
      catalogPlanKey: true,
      seatCapacity: true,
      billingCadence: true,
      billingCycleAnchorDate: true,
      billingCycleDays: true,
      cycleSeatMicros: true,
      createdByUserId: true,
    },
  });

  let updated = 0;
  for (const template of templates) {
    if (!template.toolKey || !template.catalogPlanKey) continue;
    try {
      const quotas = await loadQuotaRowsForTool(template.orgId, template.toolKey);
      const derived = deriveDetectedSubscription({
        toolKey: template.toolKey,
        catalogPlanKey: template.catalogPlanKey,
        quotas,
        seatCapacity: template.seatCapacity,
        existingAnchor: template.billingCycleAnchorDate,
        existingCadence: template.billingCadence,
      });
      if (!cycleFieldsChanged(template, derived)) continue;
      await prisma.billingPlanTemplate.update({
        where: { id: template.id },
        data: {
          billingCadence: derived.billingCadence,
          billingCycleAnchorDate: derived.billingCycleAnchorDate,
          billingCycleDays: derived.billingCycleDays,
          cycleSeatMicros: derived.cycleSeatMicros,
        },
      });
      await syncDetectedAssignmentsCycle(template.orgId, template.id, {
        billingCadence: derived.billingCadence,
        billingCycleAnchorDate: derived.billingCycleAnchorDate,
        billingCycleDays: derived.billingCycleDays,
        cycleSeatMicros: derived.cycleSeatMicros,
      });
      updated += 1;
    } catch (error) {
      logServerError("repair-detected-cycles", error, { toolKey: template.toolKey });
    }
  }
  return { scanned: templates.length, updated };
}
