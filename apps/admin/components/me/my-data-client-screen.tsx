"use client";

import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { AppPageError, AppPageSkeleton, isBlockingAppQueryError, useAppQueryErrorToast } from "@/components/app-data-state";
import { useAppPageQuery } from "@/lib/api/client";
import { myDataKey } from "@/lib/app-pages/query-keys";
import { hasAnalyticsConsent } from "@/lib/consent/analytics-consent";
import type { MyDataPayload } from "@/lib/privacy/my-data-types";
import { MyDataCollection } from "@/components/me/my-data-collection";
import { MyDataNoticeBanner } from "@/components/me/my-data-notice-banner";
import { MyDataRights } from "@/components/me/my-data-rights";
import { MyDataSummary } from "@/components/me/my-data-summary";

export default function MyDataClientScreen() {
  const query = useAppPageQuery<MyDataPayload>(myDataKey, "/api/app/me/data");
  const [analyticsEnabled, setAnalyticsEnabled] = useState(() => hasAnalyticsConsent());
  useAppQueryErrorToast(query.error, { retry: () => void query.refetch() });

  if (query.isPending && !query.data) return <AppPageSkeleton />;
  if (isBlockingAppQueryError(query.error, Boolean(query.data))) {
    return <AppPageError error={query.error} retry={() => void query.refetch()} />;
  }
  const data = query.data;
  if (!data) return <AppPageSkeleton />;

  const noticeBanner = (
    <MyDataNoticeBanner
      notice={data.notice}
      acknowledged={data.membership.collectionNoticeAcked}
      acknowledgedAt={data.membership.collectionNoticeAckAt}
    />
  );

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader title="What do we hold?" className="mb-8" />
      <div className="space-y-6">
        {data.membership.collectionNoticeAcked ? null : noticeBanner}
        <MyDataSummary
          summary={data.summary}
          region={data.organization?.dataRegion ?? null}
          retentionDays={data.organization?.usageRetentionDays ?? null}
        />
        <MyDataCollection
          accounts={data.collection.accounts}
          preferenceEvents={data.collection.preferenceEvents}
          notice={data.notice}
          hasUnattributedUsage={data.summary.hasUnattributedUsage}
        />
        {data.membership.collectionNoticeAcked ? <div className="-mt-5">{noticeBanner}</div> : null}
        <MyDataRights
          rights={data.rights}
          analyticsEnabled={analyticsEnabled}
          onAnalyticsChange={setAnalyticsEnabled}
        />
      </div>
    </div>
  );
}
