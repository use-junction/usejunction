// @vitest-environment happy-dom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  DashboardMetricsSkeleton,
  DashboardPageLoading,
  DashboardPeriodRefreshing,
} from "@/components/dashboard/dashboard-period-refreshing";

afterEach(() => {
  cleanup();
});

test("page loading keeps the real title and shows metrics skeleton", () => {
  render(<DashboardPageLoading showSyncPlaceholder />);

  assert.ok(screen.getByRole("heading", { name: "Usage." }));
  assert.ok(screen.getByLabelText("Loading period"));
  assert.equal(screen.queryByText("Crunching your numbers."), null);
});

test("period refreshing swaps only the metrics body", () => {
  const { rerender } = render(
    <DashboardPeriodRefreshing refreshing={false}>
      <p>Live metrics</p>
    </DashboardPeriodRefreshing>,
  );
  assert.ok(screen.getByText("Live metrics"));

  rerender(
    <DashboardPeriodRefreshing refreshing>
      <p>Live metrics</p>
    </DashboardPeriodRefreshing>,
  );
  assert.equal(screen.queryByText("Live metrics"), null);
  assert.ok(screen.getByLabelText("Loading period"));
});

test("metrics skeleton is self-contained for reuse", () => {
  render(<DashboardMetricsSkeleton />);
  assert.ok(screen.getByLabelText("Loading period"));
});
