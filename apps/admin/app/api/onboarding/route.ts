import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { isAuthUserNotFoundError } from "@/lib/ensure-auth-user";
import {
  ensureOwnerWorkspace,
  isPendingInviteError,
} from "@/lib/ensure-workspace";
import { timingHeader } from "@/lib/api/app-response";
import {
  buildOnboardingStatus,
  buildOnboardingStatusForOrg,
} from "@/lib/onboarding-status";
import { ACTIVE_ORG_COOKIE, resolveOrgId } from "@/lib/require-organization";
import { browserMutationGuard } from "@/lib/security/http";
import { syncSessionWorkspace } from "@/lib/workspace-session";
import { prisma } from "@usejunction/db";

const updateSchema = z.object({
  action: z.enum(["complete", "skip", "dismiss_checklist", "reopen_checklist"]),
});

function onboardingHeaders(serverTiming: string) {
  return {
    "cache-control": "private, no-store, max-age=0",
    pragma: "no-cache",
    "server-timing": serverTiming,
  };
}

export async function POST(request: NextRequest) {
  const rejected = browserMutationGuard(request);
  if (rejected) return rejected;

  const started = performance.now();
  const session = await auth();
  const sessionMs = performance.now();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let result:
    | { orgId: string; userId?: string; role: string; created: boolean }
    | undefined;
  if (session.user.orgId) {
    const membership = await prisma.organizationMembership.findUnique({
      where: {
        userId_orgId: { userId: session.user.id, orgId: session.user.orgId },
      },
      select: { orgId: true, role: true },
    });
    if (membership) {
      result = { orgId: membership.orgId, role: membership.role, created: false };
    }
  }
  const fastPathMs = performance.now();

  if (!result) {
    try {
      result = await ensureOwnerWorkspace(
        {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        },
        { rejectPendingInvite: true },
      );
    } catch (error) {
      if (isAuthUserNotFoundError(error)) {
        return NextResponse.json({ error: "session_expired" }, { status: 401 });
      }
      if (isPendingInviteError(error)) {
        return NextResponse.json(
          { error: "invite_pending", configured: false },
          { status: 409 },
        );
      }
      throw error;
    }
    // resolveAuthUser reconciles a stale JWT user id by email (e.g. after a DB
    // reset). The workspace then belongs to a different id than the session, so
    // syncing would 403 forever; force a fresh sign-in instead.
    if (result.userId && result.userId !== session.user.id) {
      return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }
  }
  const resolveMs = performance.now();

  const needsSessionSync = session.user.orgId !== result.orgId;
  const statusPromise = buildOnboardingStatusForOrg(session.user.id, result.orgId, {
    includeDeveloper: true,
    mode: "poll",
  });

  let sessionSynced = false;
  let status;
  let syncMs = 0;
  let statusMs = 0;
  if (needsSessionSync) {
    const syncStart = performance.now();
    const statusStart = performance.now();
    const [synced, resolvedStatus] = await Promise.all([
      syncSessionWorkspace(session.user.id, result.orgId).then((value) => {
        syncMs = performance.now() - syncStart;
        return value;
      }),
      statusPromise.then((value) => {
        statusMs = performance.now() - statusStart;
        return value;
      }),
    ]);
    if (!synced.ok) {
      return NextResponse.json({ error: synced.error }, { status: synced.status });
    }
    sessionSynced = true;
    status = resolvedStatus;
  } else {
    const statusStart = performance.now();
    status = await statusPromise;
    statusMs = performance.now() - statusStart;
  }
  const dataMs = performance.now();

  const response = NextResponse.json(status, {
    status: result.created ? 201 : 200,
    headers: onboardingHeaders(
      timingHeader({
        session: sessionMs - started,
        fastPath: fastPathMs - sessionMs,
        workspace: resolveMs - fastPathMs,
        sync: syncMs,
        status: statusMs,
        total: dataMs - started,
      }),
    ),
  });
  if (sessionSynced) {
    response.cookies.delete(ACTIVE_ORG_COOKIE);
  }
  return response;
}

export async function GET(request: NextRequest) {
  const started = performance.now();
  const session = await auth();
  const sessionMs = performance.now();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const includeDeveloper = request.nextUrl.searchParams.get("include") === "developer";
  const status = await buildOnboardingStatus(session.user.id, session.user.orgId, {
    includeDeveloper,
    mode: includeDeveloper ? "poll" : "full",
  });
  const dataMs = performance.now();

  return NextResponse.json(status, {
    headers: onboardingHeaders(
      timingHeader({
        session: sessionMs - started,
        data: dataMs - sessionMs,
        total: dataMs - started,
      }),
    ),
  });
}

export async function PATCH(request: NextRequest) {
  const rejected = browserMutationGuard(request);
  if (rejected) return rejected;

  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "invalid onboarding action" }, { status: 400 });

  const orgId = await resolveOrgId(session.user.id, session.user.orgId);
  if (!orgId) return NextResponse.json({ error: "organization setup required" }, { status: 409 });

  const membership = await prisma.organizationMembership.findUnique({
    where: { userId_orgId: { userId: session.user.id, orgId } },
  });
  if (!membership) return NextResponse.json({ error: "organization setup required" }, { status: 409 });

  const now = new Date();
  const data =
    parsed.data.action === "complete" || parsed.data.action === "skip"
      ? { onboardingCompletedAt: now }
      : parsed.data.action === "dismiss_checklist"
        ? { setupChecklistDismissedAt: now }
        : { setupChecklistDismissedAt: null };

  const updated = await prisma.organizationMembership.update({ where: { id: membership.id }, data });
  return NextResponse.json({
    onboardingCompletedAt: updated.onboardingCompletedAt,
    setupChecklistDismissedAt: updated.setupChecklistDismissedAt,
  });
}
