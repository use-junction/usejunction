export type OrganizationRole = "owner" | "admin" | "manager" | "user";

export const ORGANIZATION_ROLES = ["owner", "admin", "manager", "user"] as const satisfies readonly OrganizationRole[];

export const ASSIGNABLE_ROLES = ["admin", "manager", "user"] as const;

export type Capability = "settings_billing" | "org_overview" | "self_view" | "privacy_manage";

export const CAPABILITIES = {
  settings_billing: ["owner", "admin"],
  org_overview: ["owner", "admin", "manager"],
  self_view: ["owner", "admin", "manager", "user"],
  privacy_manage: ["owner", "admin"],
} as const satisfies Record<Capability, readonly OrganizationRole[]>;

export function rolesFor(cap: Capability): readonly OrganizationRole[] {
  return CAPABILITIES[cap];
}

export function hasCapability(role: OrganizationRole | null | undefined, cap: Capability): boolean {
  if (!role) return false;
  return (CAPABILITIES[cap] as readonly OrganizationRole[]).includes(role);
}

export function canManageSettings(role: OrganizationRole | null | undefined): boolean {
  return hasCapability(role, "settings_billing");
}

export function canManagePrivacy(role: OrganizationRole | null | undefined): boolean {
  return hasCapability(role, "privacy_manage");
}

export function canSeeOrgOverview(role: OrganizationRole | null | undefined): boolean {
  return hasCapability(role, "org_overview");
}

/** Admins/managers/owners pick manage-team vs connect; developers go straight to connect. */
export function canChooseOnboardingPath(role: OrganizationRole | null | undefined): boolean {
  return canSeeOrgOverview(role);
}

/** Members are nudged to connect on onboarding; dashboard still offers connect later. */
export function requiresDeviceOnboarding(role: OrganizationRole | null | undefined): boolean {
  return role === "user";
}

export function isSelfScopedRole(role: OrganizationRole | null | undefined): boolean {
  return role === "user";
}

export function isAssignableRole(role: string): role is (typeof ASSIGNABLE_ROLES)[number] {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}
