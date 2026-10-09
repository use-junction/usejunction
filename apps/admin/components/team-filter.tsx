"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppQuery } from "@/lib/api/client";
import { teamsKey } from "@/lib/app-pages/query-keys";
import type { TeamSummary } from "@/lib/teams";
import { cn } from "@/lib/utils";

const NO_TEAM = "none";

/**
 * Scopes a page to one team through `?team=`. Renders nothing until the workspace has teams,
 * so small teams never see an empty control.
 */
export function TeamFilter({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useAppQuery<{ teams: TeamSummary[] }>(teamsKey, "/api/app/teams", { staleTime: 60_000 });
  const teams = query.data?.teams ?? [];
  const current = searchParams.get("team");
  if (!teams.length) return null;

  const selected = current === NO_TEAM ? "No team" : teams.find((team) => team.id === current)?.name ?? null;

  function select(next: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("team", next);
    else params.delete("team");
    const search = params.toString();
    router.push(`${pathname}${search ? `?${search}` : ""}`, { scroll: false });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("h-9 rounded-none gap-2 text-xs font-semibold", selected ? "text-foreground" : "text-muted-foreground", className)}
          aria-label={selected ? `Team: ${selected}` : "Filter by team"}
        >
          <Users className="size-3.5" aria-hidden />
          <span className="max-w-[10rem] truncate">{selected ?? "All teams"}</span>
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 rounded-none">
        <DropdownMenuLabel className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Team</DropdownMenuLabel>
        <DropdownMenuItem className="rounded-none" onSelect={() => select(null)}>
          <span className="flex-1">All teams</span>
          {!current ? <Check className="size-3.5" aria-hidden /> : null}
        </DropdownMenuItem>
        {teams.map((team) => (
          <DropdownMenuItem key={team.id} className="rounded-none" onSelect={() => select(team.id)}>
            <span className="size-2 shrink-0" style={{ background: team.color ?? "var(--muted-foreground)" }} aria-hidden />
            <span className="flex-1 truncate">{team.name}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{team.memberCount}</span>
            {current === team.id ? <Check className="size-3.5" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem className="rounded-none" onSelect={() => select(NO_TEAM)}>
          <span className="flex-1 text-muted-foreground">No team</span>
          {current === NO_TEAM ? <Check className="size-3.5" aria-hidden /> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="rounded-none text-xs text-muted-foreground">
          <Link href="/team?tab=teams">Manage teams</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
