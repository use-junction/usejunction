"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { SentReportsSection } from "@/components/activity/sent-reports-section";
import { AppPageSkeleton } from "@/components/app-data-state";
import { PageHeader } from "@/components/page-header";
import { HubTabList } from "@/components/hub-nav";
import { useAppQuery } from "@/lib/api/client";
import { workspaceContextKey } from "@/lib/app-pages/query-keys";
import { canSeeOrgOverview, type OrganizationRole } from "@/lib/rbac/permissions";
import { useRouter, usePathname } from "next/navigation";

type WorkspaceRole = { current: { role: OrganizationRole } | null };

/** Every digest UseJunction emailed, in one place, so a leader can forward last week's numbers. */
export default function ReportsClientScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const context = useAppQuery<WorkspaceRole>(workspaceContextKey, "/api/app/workspace-context");
  const role = context.data?.current?.role ?? null;
  if (!role) return <AppPageSkeleton />;

  const canSeeTeam = canSeeOrgOverview(role);
  const scope = canSeeTeam && searchParams.get("scope") !== "you" ? "team" : "you";

  return (
    <>
      <PageHeader
        title="Reports."
        description="The daily and weekly digests emailed to you. Open one to see exactly what was sent."
        actions={
          <Link href="/settings#email-reports" className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
            Email schedule <ArrowRight className="size-3" aria-hidden />
          </Link>
        }
      >
        {canSeeTeam ? (
          <HubTabList
            items={[{ id: "team", label: "Team" }, { id: "you", label: "You" }]}
            value={scope}
            onChange={(id) => {
              const params = new URLSearchParams(searchParams.toString());
              params.set("scope", id);
              router.replace(`${pathname}?${params.toString()}`, { scroll: false });
            }}
            className="border-b border-border"
            aria-label="Report audience"
          />
        ) : null}
      </PageHeader>
      <SentReportsSection key={scope} audience={scope} title={scope === "team" ? "Sent to the team." : "Sent to you."} />
    </>
  );
}
