"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Cable, UserPlus } from "lucide-react";
import { DeviceConnectCard } from "@/components/onboarding/device-connect-card";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInvalidateAppData } from "@/lib/api/client";
import type { OverviewPayload } from "@/lib/app-pages/overview";

/** Shown above the faded sample overview while nobody in the workspace has a connected machine. */
export function OverviewConnectBanner() {
  const router = useRouter();
  const invalidateAppData = useInvalidateAppData();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Panel as="section" aria-label="Connect a machine" className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Cable className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">Connect a machine to fill in this page.</h2>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-muted-foreground">
              Once a machine reports, you&apos;ll see what you pay for AI, which seats sit idle, and who is using it.
              The numbers below are a sample.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" onClick={() => setOpen(true)}>
            <Cable />
            Connect this machine
          </Button>
          <Button asChild variant="outline">
            <Link href="/team"><UserPlus />Invite teammates</Link>
          </Button>
        </div>
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl gap-5 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Connect this machine.</DialogTitle>
            <DialogDescription>Run the install command in Terminal. Expires in 15 minutes.</DialogDescription>
          </DialogHeader>
          <DeviceConnectCard
            compact
            title="Connect command"
            description="Installs the agent, configures tools, and starts reporting."
            onConnected={() => {
              void invalidateAppData();
              router.refresh();
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

const M = 1_000_000;
const micros = (dollars: number) => String(Math.round(dollars * M));
const SAMPLE_USAGE = [612, 840, 1_105, 1_380, 1_520, 690];
/** A plausible week shape for the sample: busy weekdays, quiet weekends. */
const SAMPLE_DAY_BY_WEEKDAY = [6, 58, 71, 66, 74, 49, 9];

/** Fixed sample numbers in the shape of the real payload, keeping the real month and trend labels. */
export function sampleOverview(data: OverviewPayload): OverviewPayload {
  return {
    ...data,
    team: null,
    spend: {
      monthlyTotalMicros: micros(2_340),
      seatsMonthlyMicros: micros(1_720),
      payAsYouGoToDateMicros: micros(410),
      payAsYouGoProjectedMicros: micros(620),
      usageValueWithinPlansMicros: micros(1_150),
      totalIsEstimate: true,
    },
    idle: { micros: micros(240), seats: 4 },
    adoption: { windowDays: 30, active: 14, enrolled: 18, members: 21, notEnrolled: 3, notStarted: 2, noData: 1, previousActive: 11 },
    fleet: { machines: 22, online: 19, stale: 1, needsRepair: 0, needsUpdate: 2 },
    actions: [
      { key: "idle", title: "4 seats unused in 30 days", detail: "Cursor ×2, Copilot ×2. Reassign or cancel them.", href: "/tools", cta: "Review seats", savingsMicros: micros(240), tone: "money" },
      { key: "not-started", title: "2 people haven't used AI in 30 days", detail: "Their machine reports, but no AI-tool days.", href: "/activity", cta: "See who", savingsMicros: null, tone: "people" },
      { key: "not-enrolled", title: "3 people have no machine connected", detail: "Their usage and seats can't be measured yet.", href: "/activity", cta: "Send setup", savingsMicros: null, tone: "people" },
      { key: "agent-update", title: "2 machines need an agent update", detail: "Older agents can't take remote sync requests.", href: "/team?tab=fleet", cta: "Open Fleet", savingsMicros: null, tone: "fleet" },
    ],
    trend: data.trend.map((row, index) => ({ ...row, usageMicros: micros(SAMPLE_USAGE[index % SAMPLE_USAGE.length]) })),
    daily: (data.daily ?? []).map((row) => ({ ...row, usageMicros: micros(SAMPLE_DAY_BY_WEEKDAY[new Date(`${row.date}T00:00:00Z`).getUTCDay()]) })),
    byTeam: [
      { id: "sample-platform", name: "Platform", color: "#7aa6b0", people: 8, active: 7, seatsMonthlyMicros: micros(760), idleMonthlyMicros: "0", usageMonthToDateMicros: micros(310) },
      { id: "sample-product", name: "Product", color: "#e0b49a", people: 7, active: 5, seatsMonthlyMicros: micros(600), idleMonthlyMicros: micros(120), usageMonthToDateMicros: micros(220) },
      { id: "sample-design", name: "Design", color: "#c4d29a", people: 6, active: 2, seatsMonthlyMicros: micros(360), idleMonthlyMicros: micros(120), usageMonthToDateMicros: micros(160) },
    ],
  };
}
