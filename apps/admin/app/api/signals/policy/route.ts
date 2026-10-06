import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { accelerateOrgAgentRollout } from "@/lib/agent-updates";
import { audit, requireOrgRole, rolesFor } from "@/lib/rbac";
import {
  SIGNALS_COLLECTION_MODE,
  SIGNALS_DEFAULT_RETENTION_DAYS,
  defaultExcludedApps,
  defaultExcludedDomains,
  normalizeList,
  signalsPolicyInputSchema,
} from "@/lib/signals/contracts";
import { signalsAllowed } from "@/lib/region";
import { nextWorkExtractionStartedAt } from "@/lib/signals/collection-window";
import { getOrgSignalsPolicy } from "@/lib/signals/service";

export async function GET(req: NextRequest) {
  const auth = await requireOrgRole(req, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) return auth;
  const policy = await getOrgSignalsPolicy(auth.orgId);
  return NextResponse.json({ policy });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireOrgRole(req, rolesFor("settings_billing"));
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const parsed = signalsPolicyInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid signals policy", details: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.signalsPolicy.findFirst({ where: { orgId: auth.orgId } });
  const wasWorkExtractionEnabled = existing?.workExtractionEnabled ?? false;
  const workExtractionEnabled = signalsAllowed()
    ? parsed.data.workExtractionEnabled ?? existing?.workExtractionEnabled ?? false
    : false;
  const rawWorkTextEnabled = signalsAllowed()
    ? parsed.data.rawWorkTextEnabled ?? existing?.rawWorkTextEnabled ?? false
    : false;
  if (!signalsAllowed() && (parsed.data.workExtractionEnabled === true || parsed.data.rawWorkTextEnabled === true)) {
    return NextResponse.json(
      { error: "Signals work extraction is not available." },
      { status: 403 },
    );
  }
  const workExtractionStartedAt = nextWorkExtractionStartedAt({
    wasEnabled: wasWorkExtractionEnabled,
    enabled: workExtractionEnabled,
    existingStartedAt: existing?.workExtractionStartedAt,
    now: new Date(),
  });

  const data = {
    // Classic app/domain journey sampling stays off for this release.
    enabled: false,
    retentionDays: parsed.data.retentionDays ?? existing?.retentionDays ?? SIGNALS_DEFAULT_RETENTION_DAYS,
    collectionMode: SIGNALS_COLLECTION_MODE,
    excludedApps: normalizeList(parsed.data.excludedApps ?? existing?.excludedApps, defaultExcludedApps),
    excludedDomains: normalizeList(parsed.data.excludedDomains ?? existing?.excludedDomains, defaultExcludedDomains),
    storeEvents: false,
    workExtractionEnabled,
    rawWorkTextEnabled,
    workExtractionStartedAt,
    updatedByUserId: auth.userId,
  };
  const policy = existing
    ? await prisma.signalsPolicy.update({ where: { id: existing.id }, data })
    : await prisma.signalsPolicy.create({ data: { orgId: auth.orgId, ...data } });

  const turningWorkExtractionOn = !wasWorkExtractionEnabled && policy.workExtractionEnabled;
  const agentRollout = turningWorkExtractionOn
    ? await accelerateOrgAgentRollout(auth.orgId)
    : null;

  await audit({
    orgId: auth.orgId,
    actorType: "user",
    actorId: auth.userId,
    action: "signals_policy.updated",
    targetType: "signals_policy",
    targetId: policy.id,
    metadata: {
      enabled: policy.enabled,
      collectionMode: policy.collectionMode,
      retentionDays: policy.retentionDays,
      workExtractionEnabled: policy.workExtractionEnabled,
      rawWorkTextEnabled: policy.rawWorkTextEnabled,
      workExtractionStartedAt: policy.workExtractionStartedAt?.toISOString() ?? null,
      agentRollout,
    },
  });

  return NextResponse.json({
    policy: await getOrgSignalsPolicy(auth.orgId),
    agentRollout,
  });
}
