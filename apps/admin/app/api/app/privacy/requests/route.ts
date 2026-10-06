import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@usejunction/db";
import { requireOrgRole, rolesFor } from "@/lib/rbac";

export async function GET(req: NextRequest) {
  const auth = await requireOrgRole(req, rolesFor("privacy_manage"));
  if (auth instanceof NextResponse) return auth;
  const requests = await prisma.privacyRequest.findMany({
    where: { orgId: auth.orgId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { developer: { select: { name: true, email: true } } },
  });
  return NextResponse.json({
    requests: requests.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      subjectDeveloperId: row.subjectDeveloperId,
      subject: row.developer,
      scheduledFor: row.scheduledFor?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}
