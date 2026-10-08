import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { OnboardingStatus } from "@/components/onboarding/onboarding-experience";
import { OnboardingStatusProvider } from "@/components/onboarding/onboarding-status-provider";
import {
  buildOnboardingStatus,
  type OnboardingStatusPayload,
} from "@/lib/onboarding-status";

function serializeStatus(status: OnboardingStatusPayload): OnboardingStatus {
  return {
    configured: status.configured,
    role: status.role,
    onboardingCompletedAt: status.onboardingCompletedAt?.toISOString() ?? null,
    organization: status.organization
      ? {
          name: status.organization.name,
          slug: status.organization.slug,
        }
      : undefined,
    developer: status.developer
      ? {
          devices: status.developer.devices.map((device) => ({
            id: device.id,
            hostname: device.hostname,
            os: device.os,
            createdAt: device.createdAt.toISOString(),
            lastSeenAt: device.lastSeenAt.toISOString(),
            lastToolsSyncAt: device.lastToolsSyncAt?.toISOString() ?? null,
            lastUsageSyncAt: device.lastUsageSyncAt?.toISOString() ?? null,
            toolInstallations: device.toolInstallations.map((tool) => ({
              toolName: tool.toolName,
              version: tool.version,
            })),
          })),
        }
      : status.developer,
  };
}

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?from=/onboarding");
  }

  const status = await buildOnboardingStatus(session.user.id, session.user.orgId, {
    includeDeveloper: true,
    mode: "poll",
  });

  if (status.onboardingCompletedAt) {
    redirect("/dashboard");
  }

  return (
    <OnboardingStatusProvider
      status={serializeStatus(status)}
      needsSessionSync={Boolean(status.configured && !session.user.orgId)}
    >
      {children}
    </OnboardingStatusProvider>
  );
}
