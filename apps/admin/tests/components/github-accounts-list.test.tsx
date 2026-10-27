// @vitest-environment happy-dom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import "../setup/component";
import { GitHubAccountsList } from "@/components/features/github-accounts-list";
import type { GitHubConnectionView } from "@/lib/integrations/github-connections";

const org: GitHubConnectionView = {
  id: "conn-org", githubOrg: "acme", accountType: "Organization", installationId: "42", state: "ready", needsMembers: false,
  approveUrl: "https://github.com/organizations/acme/settings/installations/42", appPermissionsUrl: null, lastSyncedAt: "2026-09-24T09:00:00.000Z", lastError: null,
};
const personal: GitHubConnectionView = { ...org, id: "conn-user", githubOrg: "ada", accountType: "User", installationId: "43", state: "syncing", approveUrl: null };

function mount(overrides: Partial<Parameters<typeof GitHubAccountsList>[0]> = {}) {
  const onDisconnect = vi.fn();
  render(<GitHubAccountsList connections={[org, personal]} canManage installHref="/api/integrations/github/connect?returnTo=/work-spend" onDisconnect={onDisconnect} {...overrides} />);
  return { onDisconnect };
}

test("renders a heading row with the connect action and one row per account", () => {
  mount();
  const section = screen.getByRole("region", { name: "GitHub accounts" });
  expect(within(section).getByRole("link", { name: "Connect account" })).toHaveAttribute("href", "/api/integrations/github/connect?returnTo=/work-spend");
  const rows = within(section).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("acme");
  expect(rows[0]).toHaveTextContent("Organization");
  expect(rows[0]).toHaveTextContent("Connected");
  expect(rows[1]).toHaveTextContent("ada");
  expect(rows[1]).toHaveTextContent("Personal account");
  expect(rows[1]).toHaveTextContent("Syncing");
});

test("Configure opens the GitHub installation page in a new tab only when the account has one", () => {
  mount();
  const [orgRow, personalRow] = screen.getAllByRole("listitem");
  const configure = within(orgRow).getByRole("link", { name: /Configure/ });
  expect(configure).toHaveAttribute("href", org.approveUrl);
  expect(configure).toHaveAttribute("target", "_blank");
  expect(configure).toHaveAttribute("rel", "noreferrer");
  expect(within(personalRow).queryByRole("link", { name: /Configure/ })).not.toBeInTheDocument();
});

test("Disconnect is labelled per account and hands the connection back", () => {
  const { onDisconnect } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Disconnect ada…" }));
  expect(onDisconnect).toHaveBeenCalledWith(personal);
  expect(screen.getByRole("button", { name: "Disconnect acme…" })).toBeInTheDocument();
});

test("a sync cut short by its time budget reads as needing attention with the progress note", () => {
  const note = "Synced 6 of 40 repositories before this run's time budget ran out; the remaining 34 continue on the next sync.";
  mount({ connections: [{ ...personal, state: "partial", lastError: note }] });
  const [row] = screen.getAllByRole("listitem");
  expect(row).toHaveTextContent("Needs attention");
  expect(row).not.toHaveTextContent("Syncing");
  expect(within(row).getByRole("alert")).toHaveTextContent(note);
});

test("surfaces attention states and sync errors inside the row", () => {
  mount({ connections: [
    { ...org, state: "permission_required", needsMembers: true },
    { ...personal, state: "partial", lastError: "Pull requests could not be read." },
  ] });
  const [needsPermission, partial] = screen.getAllByRole("listitem");
  expect(needsPermission).toHaveTextContent("Permissions needed");
  expect(needsPermission).toHaveTextContent("Read-only member access is needed to match authors.");
  expect(partial).toHaveTextContent("Needs attention");
  expect(within(partial).getByRole("alert")).toHaveTextContent("Pull requests could not be read.");
});

test("lists GitHub installations that are not linked yet with a Link action", () => {
  mount({ availableInstalls: [
    { id: "900", login: "acme", accountType: "Organization", linked: true },
    { id: "901", login: "acme-labs", accountType: "Organization" },
    { id: "902", login: "grace", accountType: "User" },
  ] });
  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(4);
  expect(rows[2]).toHaveTextContent("acme-labs");
  expect(rows[2]).toHaveTextContent("Installed on GitHub, not linked");
  expect(within(rows[2]).getByRole("link", { name: "Link" })).toHaveAttribute("href", "/api/integrations/github/callback?installation_id=901");
  expect(rows[3]).toHaveTextContent("grace");
  expect(rows[3]).toHaveTextContent("Personal account");
  expect(screen.getAllByRole("link", { name: "Link" })).toHaveLength(2);
});

test("viewers see accounts but no actions", () => {
  mount({ canManage: false, availableInstalls: [{ id: "901", login: "acme-labs", accountType: "Organization" }] });
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.queryByRole("link", { name: "Connect account" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Configure/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Link" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Disconnect/ })).not.toBeInTheDocument();
  expect(screen.getByText("A workspace admin can connect or disconnect GitHub accounts.")).toBeInTheDocument();
});

test("the heading can be renamed by the host screen", () => {
  mount({ heading: "Connected accounts" });
  expect(screen.getByRole("heading", { name: "Connected accounts" })).toBeInTheDocument();
});
