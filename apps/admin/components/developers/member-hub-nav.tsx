"use client";

import { useSearchParams } from "next/navigation";
import { HubNav } from "@/components/hub-nav";
import { signalsProductEnabled } from "@/lib/region";

const tabs = [
  { suffix: "", label: "Overview" },
  { suffix: "/work", label: "Work" },
  { suffix: "/coding", label: "Coding" },
  { suffix: "/fleet", label: "Fleet" },
] as const;

export function MemberHubNav({
  developerId,
  className,
}: {
  developerId: string;
  className?: string;
}) {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const querySuffix = query ? `?${query}` : "";
  const base = `/team/${developerId}`;
  const visibleTabs = signalsProductEnabled() ? tabs : tabs.filter((tab) => tab.suffix !== "/work");

  const items = visibleTabs.map(({ suffix, label }) => {
    const matchHref = `${base}${suffix}`;
    return {
      href: `${matchHref}${querySuffix}`,
      matchHref,
      label,
      exact: suffix === "",
    };
  });

  return (
    <HubNav
      items={items}
      className={className}
      aria-label="Member sections"
      justify="start"
    />
  );
}
