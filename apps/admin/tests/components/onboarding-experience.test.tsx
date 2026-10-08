// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingExperience } from "@/components/onboarding/onboarding-experience";
import { OnboardingStatusProvider } from "@/components/onboarding/onboarding-status-provider";

vi.mock("next/image", () => ({
  default: ({ alt = "", ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} {...props} />
  ),
}));

vi.mock("@/components/auth/auth-shell", () => ({
  AuthShell: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

vi.mock("@/components/onboarding/device-connect-card", () => ({
  DeviceConnectCard: () => <div>Connect card</div>,
  CollectionNoticeLink: () => null,
}));

vi.mock("@/components/onboarding/invite-team-form", () => ({
  InviteTeamForm: () => <div>Invite form</div>,
}));

vi.mock("@/components/tools/tool-brand-icon", () => ({
  hasToolBrandIcon: () => false,
  ToolLogoTile: () => null,
}));

describe("OnboardingExperience", () => {
  beforeEach(() => {
    cleanup();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders a server-provided workspace immediately without a bootstrap request", () => {
    render(
      <OnboardingStatusProvider
        status={{
          configured: true,
          role: "owner",
          onboardingCompletedAt: null,
          organization: { name: "Acme", slug: "acme" },
          developer: { devices: [] },
        }}
        needsSessionSync={false}
      >
        <OnboardingExperience />
      </OnboardingStatusProvider>,
    );

    expect(screen.getByRole("heading", { name: "Welcome to Acme." })).toBeTruthy();
    expect(screen.queryByText("Loading your workspace.")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps provisioning as a client fallback when no workspace exists", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          configured: true,
          role: "owner",
          onboardingCompletedAt: null,
          organization: { name: "New workspace", slug: "new-workspace" },
          developer: { devices: [] },
        }),
        { status: 201 },
      ),
    );

    render(
      <OnboardingExperience
        initialStatus={{ configured: false, role: null, onboardingCompletedAt: null }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Welcome to New workspace." })).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/onboarding",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps Skip available and stays on onboarding when completion fails", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "failed" }), { status: 500 }));

    render(
      <OnboardingExperience
        initialStatus={{
          configured: true,
          role: "user",
          onboardingCompletedAt: null,
          organization: { name: "Acme", slug: "acme" },
          developer: { devices: [] },
        }}
      />,
    );

    fireEvent.click(screen.getByText("Skip this step"));
    await waitFor(() => {
      expect(screen.getByText(/Unable to finish onboarding/i)).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/onboarding",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("starts solo analysis on the connected computer without showing team setup", () => {
    render(
      <OnboardingExperience
        soloMode
        initialStatus={{
          configured: true,
          role: "owner",
          onboardingCompletedAt: null,
          organization: { name: "Dinu workspace", slug: "dinu-workspace" },
          developer: { devices: [] },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Analyze your own usage first." })).toBeTruthy();
    expect(screen.queryByText(/I’m here to manage my team/i)).toBeNull();
  });
});
