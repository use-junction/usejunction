"use client";

import { ActivitySettingsCard } from "@/components/activity/activity-settings-card";
import { PageHeader } from "@/components/page-header";
import { BillingSettingsCard } from "@/components/settings/billing-settings-card";
import { EmailReportsSettingsCard, type EmailReportsPrefs } from "@/components/settings/email-reports-settings-card";
import { SignalsSettingsCard } from "@/components/settings/signals-settings-card";
import { MachineConnectionSettingsCard } from "@/components/settings/machine-connection-settings-card";
import { AnalyticsConsentCard } from "@/components/settings/analytics-consent-card";
import { WorkspaceSettingsCard } from "@/components/settings/workspace-settings-card";
import { DataRetentionSettingsCard } from "@/components/settings/data-retention-settings-card";
import type { getOrgActivitySettings } from "@/lib/activity/service";
import type { getOrgSignalsPolicy } from "@/lib/signals/service";
import type { getOrgBillingStatus } from "@/lib/saas-billing/status";
import { useAppPageQuery } from "@/lib/api/client";
import { notificationPreferencesKey, settingsKey } from "@/lib/app-pages/query-keys";
import { AppPageError, AppPageSkeleton, isBlockingAppQueryError, useAppQueryErrorToast } from "@/components/app-data-state";
import { signalsProductEnabled } from "@/lib/region";

type SettingsPayload = {
  orgId: string;
  orgName: string;
  orgColor: string | null;
  settings: Awaited<ReturnType<typeof getOrgActivitySettings>>;
  signalsPolicy: Awaited<ReturnType<typeof getOrgSignalsPolicy>>;
  billing: Awaited<ReturnType<typeof getOrgBillingStatus>>;
  billingMembers: Array<{ id: string; name: string; email: string }>;
};

export default function SettingsClientScreen() {
  const prefsQuery = useAppPageQuery<EmailReportsPrefs>(
    notificationPreferencesKey,
    "/api/app/me/notification-preferences",
  );
  const canManageOrg =
    prefsQuery.data?.role === "owner" || prefsQuery.data?.role === "admin";
  const orgQuery = useAppPageQuery<SettingsPayload>(
    settingsKey,
    "/api/app/settings",
    { enabled: canManageOrg },
  );

  useAppQueryErrorToast(orgQuery.error, {
    enabled: canManageOrg && Boolean(prefsQuery.data),
    retry: () => void orgQuery.refetch(),
  });

  if ((prefsQuery.isPending && !prefsQuery.data) || (canManageOrg && orgQuery.isPending && !orgQuery.data)) {
    return <AppPageSkeleton />;
  }
  if (isBlockingAppQueryError(prefsQuery.error, Boolean(prefsQuery.data))) {
    return <AppPageError error={prefsQuery.error} retry={() => void prefsQuery.refetch()} />;
  }
  if (canManageOrg && isBlockingAppQueryError(orgQuery.error, Boolean(orgQuery.data))) {
    return <AppPageError error={orgQuery.error} retry={() => void orgQuery.refetch()} />;
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="Settings." className="mb-8" />

      <div className="space-y-6">
        {canManageOrg && orgQuery.data ? (
          <>
            <WorkspaceSettingsCard
              orgId={orgQuery.data.orgId}
              initialName={orgQuery.data.orgName}
              initialColor={orgQuery.data.orgColor}
            />
            <BillingSettingsCard billing={orgQuery.data.billing} members={orgQuery.data.billingMembers} />
            {prefsQuery.data ? <div id="email-reports" className="scroll-mt-20"><EmailReportsSettingsCard initial={prefsQuery.data} /></div> : null}
            <ActivitySettingsCard initialSettings={orgQuery.data.settings} />
            <DataRetentionSettingsCard />
            {signalsProductEnabled() ? <SignalsSettingsCard initialPolicy={orgQuery.data.signalsPolicy} /> : null}
          </>
        ) : prefsQuery.data ? (
          <div id="email-reports" className="scroll-mt-20"><EmailReportsSettingsCard initial={prefsQuery.data} /></div>
        ) : null}

        {/* Personal settings come after the workspace ones admins visit this page for. */}
        <h2 className="pt-4 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Just you</h2>
        <MachineConnectionSettingsCard />
        <AnalyticsConsentCard />
      </div>
    </div>
  );
}
