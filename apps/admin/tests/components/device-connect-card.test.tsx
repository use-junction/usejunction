// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceConnectCard } from "@/components/onboarding/device-connect-card";

vi.mock("@/components/panel", () => ({
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/tools/tool-brand-icon", () => ({
  hasToolBrandIcon: () => false,
  ToolLogoTile: () => null,
}));

vi.mock("@/components/onboarding/platform-command", () => ({
  PlatformCommand: ({ onCopied }: { onCopied?: () => void }) => (
    <button type="button" data-testid="platform-command" onClick={onCopied}>
      command
    </button>
  ),
}));

const enrolledDevice = {
  id: "dev-1",
  hostname: "laptop",
  os: "darwin",
  lastSeenAt: "2026-01-01T00:00:00.000Z",
  toolInstallations: [],
};

const enrollmentCredentials = {
  token: "uj_enroll_test",
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
  controlPlaneUrl: "https://app.example",
};

function mockFetch(handlers: Record<string, () => Response | Promise<Response>>) {
  const all = {
    "/api/me/collection-notice": () =>
      new Response(JSON.stringify({ acknowledged: true, notice: { title: "Collection notice" } }), { status: 200 }),
    ...handlers,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      for (const [pattern, handler] of Object.entries(all)) {
        if (url.includes(pattern) && (pattern.includes("enrollment-token") ? method === "POST" : true)) {
          return handler();
        }
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }),
  );
}

describe("DeviceConnectCard", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("enters sync wait when parent supplies an enrolled device on mount", async () => {
    mockFetch({
      "/api/onboarding?include=developer": () =>
        new Response(
          JSON.stringify({
            developer: { devices: [enrolledDevice] },
          }),
          { status: 200 },
        ),
    });

    render(
      <DeviceConnectCard
        skipInitialStatusFetch
        initialDevices={[enrolledDevice]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Device enrolled — waiting for tool inventory/i)).toBeTruthy();
    });
    expect(screen.getByText(/Having trouble\? Finish setup/i)).toBeTruthy();
    expect(screen.queryByTestId("platform-command")).toBeNull();
    fireEvent.click(screen.getByText(/Having trouble\? Finish setup/i));
    expect(screen.getByTestId("platform-command")).toBeTruthy();

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(
      fetchMock.mock.calls.some(
        (call) => String(call[0]).includes("/api/onboarding") && call[1]?.method === "POST",
      ),
    ).toBe(false);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/me/enrollment-token"))).toBe(
      false,
    );
  });

  it("shows a connect command from parent credentials without bootstrap POST", async () => {
    mockFetch({
      "/api/onboarding?include=developer": () =>
        new Response(JSON.stringify({ developer: { devices: [] } }), { status: 200 }),
    });

    render(
      <DeviceConnectCard
        skipInitialStatusFetch
        initialDevices={[]}
        initialCredentials={enrollmentCredentials}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("platform-command")).toBeTruthy();
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(
      fetchMock.mock.calls.some(
        (call) => String(call[0]).includes("/api/onboarding") && call[1]?.method === "POST",
      ),
    ).toBe(false);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/me/enrollment-token"))).toBe(
      false,
    );
  });

  it("shows a connect command when no device exists yet (standalone)", async () => {
    mockFetch({
      "/api/onboarding?include=developer": () =>
        new Response(JSON.stringify({ developer: { devices: [] } }), { status: 200 }),
      "/api/me/enrollment-token": () =>
        new Response(JSON.stringify(enrollmentCredentials), { status: 201 }),
    });

    render(<DeviceConnectCard />);

    await waitFor(() => {
      expect(screen.getByTestId("platform-command")).toBeTruthy();
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/api/onboarding") && !url.includes("sync-status"))).toBe(true);
    expect(urls.some((url) => url.includes("/api/me/enrollment-token"))).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        (call) => String(call[0]).includes("/api/onboarding") && call[1]?.method === "POST",
      ),
    ).toBe(false);
  });

  it("asks for collection notice acknowledgment before minting a token", async () => {
    mockFetch({
      "/api/onboarding?include=developer": () =>
        new Response(JSON.stringify({ developer: { devices: [] } }), { status: 200 }),
      "/api/me/collection-notice": () =>
        new Response(
          JSON.stringify({
            acknowledged: false,
            notice: {
              title: "What this agent collects",
              summary: "Usage and device health.",
              collects: ["Usage"],
              neverCollects: ["Keystrokes"],
              whoSees: "Admins",
              retention: "365 days",
            },
          }),
          { status: 200 },
        ),
    });

    render(<DeviceConnectCard />);

    await waitFor(() => {
      expect(screen.getByText("What this agent collects")).toBeTruthy();
    });
    expect(screen.queryByTestId("platform-command")).toBeNull();
    expect(screen.getByRole("button", { name: "Continue to connect command" })).toBeTruthy();
  });

  it("finishes exactly once when both server sync checkpoints arrive", async () => {
    const readyDevice = {
      ...enrolledDevice,
      lastToolsSyncAt: "2026-01-01T00:01:00.000Z",
      lastUsageSyncAt: "2026-01-01T00:02:00.000Z",
    };
    mockFetch({
      "/api/onboarding?include=developer": () =>
        new Response(JSON.stringify({ developer: { devices: [readyDevice] } }), { status: 200 }),
    });
    const onConnected = vi.fn();

    render(
      <DeviceConnectCard
        skipInitialStatusFetch
        initialDevices={[enrolledDevice]}
        onConnected={onConnected}
      />,
    );

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    expect(onConnected).toHaveBeenCalledWith(readyDevice);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/onboarding/sync-status")),
    ).toBe(false);
  });

  it("changes an old incomplete enrollment to a stalled recovery state", async () => {
    const oldDevice = { ...enrolledDevice, createdAt: "2020-01-01T00:00:00.000Z" };
    mockFetch({
      "/api/onboarding?include=developer": () =>
        new Response(JSON.stringify({ developer: { devices: [oldDevice] } }), { status: 200 }),
    });

    render(
      <DeviceConnectCard
        skipInitialStatusFetch
        initialDevices={[oldDevice]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Setup has not reported successfully yet/i)).toBeTruthy();
    });
    expect(screen.getByText("Check again")).toBeTruthy();
  });
});
