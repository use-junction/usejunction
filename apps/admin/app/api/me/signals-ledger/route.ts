import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { requireOrgRole, rolesFor } from "@/lib/rbac";

export async function GET(req: NextRequest) {
  const auth = await requireOrgRole(req, rolesFor("self_view"));
  if (auth instanceof NextResponse) return auth;

  const developer = await prisma.developer.findUnique({
    where: { orgId_authUserId: { orgId: auth.orgId, authUserId: auth.userId } },
    select: { id: true },
  });
  if (!developer) return NextResponse.json({ sessions: [] });

  const sessions = await prisma.signalsSession.findMany({
    where: { orgId: auth.orgId, developerId: developer.id },
    orderBy: { startedAt: "desc" },
    take: 100,
    include: { device: { select: { hostname: true, os: true } } },
  });
  const workSessions = await prisma.localWorkSession.findMany({
    where: { orgId: auth.orgId, developerId: developer.id },
    orderBy: { observedAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      tldr: true,
      overview: true,
      toolName: true,
      model: true,
      observedAt: true,
      source: true,
    },
  });

  return NextResponse.json({
    sessions: sessions.map((session) => ({
      id: session.id,
      localId: session.localId,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt.toISOString(),
      durationSeconds: session.durationSeconds,
      aiTool: session.aiTool,
      appBefore: session.appBefore,
      domainBefore: session.domainBefore,
      appAfter: session.appAfter,
      domainAfter: session.domainAfter,
      flowSignature: session.flowSignature,
      confidence: session.confidence,
      collectionMode: session.collectionMode,
      steps: session.steps,
      device: session.device,
    })),
    workSessions: workSessions.map((session) => ({
      ...session,
      observedAt: session.observedAt.toISOString(),
    })),
  });
}
