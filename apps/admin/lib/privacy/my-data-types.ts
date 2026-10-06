import type { CollectionNoticeCopy } from "@/lib/privacy/collection-notice";
import type { PublicCollectionAccount, PublicCollectionEvent } from "@/lib/privacy/account-collection-types";

export type UsageStorageState = "none" | "active_day" | "historical_day";

export type UsageStorageHint = {
  state: UsageStorageState;
  lastUsageDay: string | null;
  firstUsageDay?: string | null;
  storedRequests?: number;
};

export type UsageStorageAggregate = {
  deviceId: string | null;
  toolName: string;
  accountKey: string;
  lastUsageDay: string;
  firstUsageDay?: string | null;
  requests?: number;
};

export type MyDataAccountRow = PublicCollectionAccount & {
  usageStorage: UsageStorageHint;
};

export type MyDataPreferenceEvent = PublicCollectionEvent & {
  hostname: string;
  displayName: string;
  email: string | null;
};

export type MyDataSummary = {
  accountCount: number;
  collectingCount: number;
  usageCollectingCount: number;
  loggingCollectingCount: number;
  deviceCount: number;
  lastDeviceSeenAt: string | null;
  latestStoredUsageDay: string | null;
  storedRequests?: number;
  hasUnattributedUsage: boolean;
};

export type MyDataRights = {
  exportHref: string;
  erasure: {
    pending: boolean;
    scheduledFor: string | null;
    requestId: string | null;
  };
  legalLinks: Array<{ href: string; label: string }>;
};

export type MyDataPayload = {
  account: {
    name: string | null;
    email: string;
    termsAcceptedAt: string | null;
    termsVersion: string | null;
    privacyVersion: string | null;
  } | null;
  organization: {
    name: string;
    dataRegion: string;
    usageRetentionDays: number;
  } | null;
  membership: {
    role: string;
    collectionNoticeAcked: boolean;
    collectionNoticeAckAt: string | null;
  };
  notice: CollectionNoticeCopy;
  signalsAvailable: boolean;
  developerId: string | null;
  summary: MyDataSummary;
  collection: {
    accounts: MyDataAccountRow[];
    preferenceEvents: MyDataPreferenceEvent[];
  };
  rights: MyDataRights;
};
