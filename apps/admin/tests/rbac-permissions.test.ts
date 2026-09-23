import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  CAPABILITIES,
  canManageSettings,
  canSeeOrgOverview,
  canManagePrivacy,
  canChooseOnboardingPath,
  requiresDeviceOnboarding,
  hasCapability,
  isAssignableRole,
  isSelfScopedRole,
  rolesFor,
} from "@/lib/rbac/permissions";

describe("RBAC capabilities", () => {
  it("maps settings_billing to owner and admin only", () => {
    expect(rolesFor("settings_billing")).toEqual(["owner", "admin"]);
    expect(canManageSettings("owner")).toBe(true);
    expect(canManageSettings("admin")).toBe(true);
    expect(canManageSettings("manager")).toBe(false);
    expect(canManageSettings("user")).toBe(false);
  });

  it("maps org_overview to owner, admin, and manager", () => {
    expect(rolesFor("org_overview")).toEqual(["owner", "admin", "manager"]);
    expect(canSeeOrgOverview("manager")).toBe(true);
    expect(canSeeOrgOverview("user")).toBe(false);
  });

  it("lets managers choose onboarding path; developers connect only", () => {
    expect(canChooseOnboardingPath("owner")).toBe(true);
    expect(canChooseOnboardingPath("admin")).toBe(true);
    expect(canChooseOnboardingPath("manager")).toBe(true);
    expect(canChooseOnboardingPath("user")).toBe(false);
    expect(requiresDeviceOnboarding("user")).toBe(true);
    expect(requiresDeviceOnboarding("manager")).toBe(false);
  });

  it("maps privacy_manage to owner and admin only", () => {
    expect(rolesFor("privacy_manage")).toEqual(["owner", "admin"]);
    expect(canManagePrivacy("owner")).toBe(true);
    expect(canManagePrivacy("admin")).toBe(true);
    expect(canManagePrivacy("manager")).toBe(false);
    expect(canManagePrivacy("user")).toBe(false);
  });

  it("maps self_view to all roles", () => {
    expect(rolesFor("self_view")).toEqual(["owner", "admin", "manager", "user"]);
    expect(hasCapability("user", "self_view")).toBe(true);
    expect(isSelfScopedRole("user")).toBe(true);
    expect(isSelfScopedRole("manager")).toBe(false);
  });

  it("keeps capability tables exhaustive", () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual([
      "org_overview",
      "privacy_manage",
      "self_view",
      "settings_billing",
    ]);
  });

  it("validates assignable invite/member roles", () => {
    expect(ASSIGNABLE_ROLES).toEqual(["admin", "manager", "user"]);
    expect(isAssignableRole("manager")).toBe(true);
    expect(isAssignableRole("owner")).toBe(false);
    expect(isAssignableRole("developer")).toBe(false);
  });
});
