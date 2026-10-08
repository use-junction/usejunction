// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import "../setup/component";
import { GithubInstallReview } from "@/components/features/github-install-review";

test("leads with the team's own AI usage and a single connect action", () => {
  render(<GithubInstallReview installHref="/connect" spendMicros="372790000" days={30} />);
  expect(screen.getByRole("heading", { name: /Your team used \$372\.79 of AI in the last 30 days/ })).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /Connect GitHub/ })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Connect GitHub Projects" })).not.toBeInTheDocument();
  expect(screen.getByText(/never your source code/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Linear/ })).not.toBeInTheDocument();
  expect(screen.getByText("Linear").closest("[aria-disabled]")).toHaveTextContent("LinearSoon");
  expect(screen.getByText("Jira").closest("[aria-disabled]")).toHaveTextContent("JiraSoon");
});

test("an existing GitHub install becomes the one-click primary action", () => {
  render(
    <GithubInstallReview
      installHref="/connect"
      installations={[{ id: "42", login: "usejunction", accountType: "Organization" }, { id: "7", login: "old", accountType: "User", linked: true }]}
    />,
  );
  const link = screen.getByRole("link", { name: /Connect usejunction/ });
  expect(link).toHaveAttribute("href", "/api/integrations/github/callback?installation_id=42");
  expect(screen.queryByText(/Connect old/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Install on another GitHub account/ })).toHaveAttribute("href", "/connect");
});

test("falls back to a generic headline with no spend, and tells non-admins who can connect", () => {
  render(<GithubInstallReview installHref="/connect" canManage={false} />);
  expect(screen.getByRole("heading", { name: "See which pull requests your AI spend went into." })).toBeInTheDocument();
  expect(screen.getByText(/Ask a workspace owner or admin to connect GitHub/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Connect GitHub/ })).not.toBeInTheDocument();
});
