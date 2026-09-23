export type CollectionStream = "usage" | "logging";

export type PublicCollectionAccount = {
  id: string;
  deviceId: string;
  hostname: string;
  toolName: string;
  displayName: string;
  accountKey: string;
  email: string | null;
  plan: string | null;
  authPresent: boolean;
  usageEnabled: boolean;
  loggingEnabled: boolean;
  usageAdminLocked: boolean;
  loggingAdminLocked: boolean;
  usageAllowed: boolean;
  loggingAllowed: boolean;
  updatedAt: string;
};

export type PublicCollectionEvent = {
  id: string;
  deviceId: string;
  toolName: string;
  accountKey: string;
  stream: string;
  enabled: boolean;
  actor: string;
  createdAt: string;
};
