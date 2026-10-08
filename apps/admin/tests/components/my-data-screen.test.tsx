// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import "../setup/component";
import { collectionNoticeCopy } from "@/lib/privacy/collection-notice";
import type { MyDataPayload } from "@/lib/privacy/my-data-types";
import { MyDataNoticeBanner } from "@/components/me/my-data-notice-banner";
import { MyDataRights } from "@/components/me/my-data-rights";
import { MyDataSummary } from "@/components/me/my-data-summary";
import MyDataClientScreen from "@/components/me/my-data-client-screen";

vi.mock("@/components/panel", () => ({
  Panel: ({ children, ...props }: { children: React.ReactNode }) => <section {...props}>{children}</section>,
}));

vi.mock("@/components/tools/tool-brand-icon", () => ({
  ToolLogoTile: () => null,
}));

vi.mock("@/components/page-header", () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
}));

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  persistAnalyticsConsent: vi.fn(),
  useAppPageQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  };
});

vi.mock("@/lib/consent/analytics-consent", () => ({
  hasAnalyticsConsent: () => false,
  persistAnalyticsConsent: (...args: unknown[]) => mocks.persistAnalyticsConsent(...args),
}));

vi.mock("@/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/client")>("@/lib/api/client");
  return {
    ...actual,
    useAppPageQuery: mocks.useAppPageQuery,
  };
});

vi.mock("@/components/app-data-state", () => ({
  AppPageError: ({ error }: { error: Error }) => <div>{error.message}</div>,
  AppPageSkeleton: () => <div>loading</div>,
  isBlockingAppQueryError: (error: unknown, hasData: boolean) => Boolean(error) && !hasData,
  useAppQueryErrorToast: vi.fn(),
}));

const notice = collectionNoticeCopy({ orgName: "Acme", usageRetentionDays: 365 });

function payload(partial: Partial<MyDataPayload> = {}): MyDataPayload {
  return {
    account: { name: "Dev", email: "dev@example.com", termsAcceptedAt: null, termsVersion: null, privacyVersion: null },
    organization: { name: "Acme", dataRegion: "eu", usageRetentionDays: 365 },
    membership: { role: "user", collectionNoticeAcked: true, collectionNoticeAckAt: "2026-09-18T00:00:00.000Z" },
    notice,
    signalsAvailable: false,
    developerId: "dev_1",
    summary: {
      accountCount: 2,
      collectingCount: 1,
      usageCollectingCount: 1,
      loggingCollectingCount: 0,
      deviceCount: 1,
      lastDeviceSeenAt: "2026-09-23T08:00:00.000Z",
      latestStoredUsageDay: "2026-09-21",
      hasUnattributedUsage: true,
    },
    collection: { accounts: [], preferenceEvents: [] },
    rights: {
      exportHref: "/api/app/me/privacy/export",
      erasure: { pending: false, scheduledFor: null, requestId: null },
      legalLinks: [
        { href: "/privacy", label: "Privacy" },
        { href: "/gdpr", label: "GDPR" },
        { href: "https://github.com/Dinuda/usejunction/blob/main/docs/compliance/employee-notice-template.md", label: "Employee notice" },
      ],
    },
    ...partial,
  };
}

function withQuery(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>,
  );
}

describe("My data transparency surfaces", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    mocks.invalidateQueries.mockReset();
    mocks.persistAnalyticsConsent.mockReset();
  });

  it("records notice acknowledgment as read, not consent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    withQuery(<MyDataNoticeBanner notice={notice} acknowledged={false} acknowledgedAt={null} />);
    expect(screen.getByText(/not consent to workplace monitoring/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Read full notice" }));
    expect(screen.getByText("Never collected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I have read this" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(String((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain("/api/me/collection-notice");
  });

  it("shows that an acknowledged notice was read", () => {
    withQuery(<MyDataNoticeBanner notice={notice} acknowledged acknowledgedAt="2026-09-18T00:00:00.000Z" />);
    expect(screen.getByText(/Collection notice read/)).toBeTruthy();
    expect(screen.getByText(/not that you consented to monitoring/)).toBeTruthy();
  });

  it("summarizes logins, devices, stored days, and region without a KPI strip", () => {
    render(
      <MyDataSummary
        summary={payload().summary}
        region="eu"
        retentionDays={365}
      />,
    );
    expect(screen.getByText(/1 of 2 logins are sharing usage/)).toBeTruthy();
    expect(screen.getByText(/EU · usage kept 3 years/)).toBeTruthy();
    expect(screen.getByText("Latest stored usage day").parentElement?.textContent).toMatch(/2026/);
    expect(screen.getByText(/1 enrolled · last heard/)).toBeTruthy();
    expect(screen.getByText(/daily totals, not live activity/)).toBeTruthy();
  });

  it("updates analytics immediately and confirms erasure with the grace period", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ scheduledFor: "2026-10-23T00:00:00.000Z" }), { status: 200 })));
    function Harness() {
      const [enabled, setEnabled] = useState(false);
      return (
        <MyDataRights
          rights={payload().rights}
          analyticsEnabled={enabled}
          onAnalyticsChange={setEnabled}
        />
      );
    }
    withQuery(<Harness />);
    expect(screen.getByRole("link", { name: "Download export" })).toBeTruthy();
    expect(screen.getByText(/does not change what your devices upload/)).toBeTruthy();
    const analytics = screen.getByRole("switch", { name: "Analytics cookies" }) as HTMLInputElement;
    expect(analytics.checked).toBe(false);
    fireEvent.click(analytics);
    expect(mocks.persistAnalyticsConsent).toHaveBeenCalledWith(true);
    expect((screen.getByRole("switch", { name: "Analytics cookies" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Request erasure" }));
    expect(await screen.findByText(/30 days/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Schedule erasure" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  it("shows a human-readable pending erasure date", () => {
    withQuery(
      <MyDataRights
        rights={{
          ...payload().rights,
          erasure: { pending: true, scheduledFor: "2026-10-23T00:00:00.000Z", requestId: "erase_1" },
        }}
        analyticsEnabled={false}
        onAnalyticsChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Erasure scheduled for/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request erasure" })).toBeNull();
  });

  it("composes the four sections from one page payload", () => {
    mocks.useAppPageQuery.mockReturnValue({
      data: payload(),
      isPending: false,
      error: null,
      refetch: vi.fn(),
    });
    withQuery(<MyDataClientScreen />);
    expect(screen.getByRole("heading", { name: "My data." })).toBeTruthy();
    expect(screen.getByRole("region", { name: "At a glance" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Tool logins" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your rights" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Work sessions uploaded" })).toBeNull();
    expect(mocks.useAppPageQuery).toHaveBeenCalledWith(["app", "me", "data"], "/api/app/me/data");
  });
});
