"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AppPageSkeleton } from "@/components/app-data-state";
import { prefetchNavPage } from "@/lib/app-pages/nav-prefetch";
import {
  Activity,
  CircleDollarSign,
  Database,
  Eye,
  GitPullRequest,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import {
  ActivePlanBadge,
  PlanStatusCard,
  shouldShowSidebarPlanCard,
} from "@/components/saas-billing/plan-status-card";
import { SignalsMark } from "@/components/signals/signals-mark";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { WorkspaceUserMenu } from "@/components/workspace-user-menu";
import type { OrgBillingStatus } from "@/lib/saas-billing/status";
import { canSeeOrgOverview } from "@/lib/rbac/permissions";
import type { OrganizationRole } from "@/lib/rbac/permissions";
import { signalsProductEnabled } from "@/lib/region";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

type NavIcon = LucideIcon | typeof SignalsMark;
type NavItem = readonly [href: string, label: string, icon: NavIcon];
type NavGroup = { label: string; items: NavItem[] };

const discoverAdmin: NavItem[] = [
  ["/dashboard", "Coverage", Eye],
  ["/activity", "Adoption", Activity],
  ["/tools", "Cost", CircleDollarSign],
  ["/work-spend", "Work", GitPullRequest],
  ["/signals", "Signals", SignalsMark],
];

const discoverMember: NavItem[] = [
  ["/dashboard", "Coverage", Eye],
  ["/activity", "Adoption", Activity],
  ["/tools", "Cost", CircleDollarSign],
];

const peopleGroup: NavItem[] = [["/team", "Team", Users]];
const youGroup: NavItem[] = [["/me/data", "My data", Database]];
const configureGroup: NavItem[] = [["/settings", "Settings", Settings]];

const adminNav: NavGroup[] = [
  { label: "Discover", items: discoverAdmin },
  { label: "People", items: peopleGroup },
  { label: "You", items: youGroup },
  { label: "Configure", items: configureGroup },
];

const memberNav: NavGroup[] = [
  { label: "Discover", items: discoverMember },
  { label: "You", items: youGroup },
  { label: "Configure", items: configureGroup },
];

function navForRole(role: OrganizationRole | null) {
  const groups = canSeeOrgOverview(role) ? adminNav : memberNav;
  if (signalsProductEnabled()) return groups;
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(([href]) => href !== "/signals"),
    }))
    .filter((group) => group.items.length > 0);
}

type WorkspaceShellProps = {
  organizations: Array<{ id: string; name: string; color: string | null; role: OrganizationRole }>;
  currentOrgId: string | null;
  role: OrganizationRole | null;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  billing: OrgBillingStatus | null;
  loading?: boolean;
  children: React.ReactNode;
};

const SIDEBAR_SKELETON_ITEMS = 8;

function AppSidebar({
  active,
  role,
  billing,
  loading,
  onNavigateStart,
}: {
  active: string;
  role: OrganizationRole | null;
  billing: OrgBillingStatus | null;
  loading?: boolean;
  onNavigateStart: (href: string) => void;
}) {
  const groups = navForRole(role);
  const { setOpenMobile } = useSidebar();
  const queryClient = useQueryClient();
  const hoverTimers = useRef(new Map<string, number>());

  useEffect(() => {
    return () => {
      for (const timer of hoverTimers.current.values()) window.clearTimeout(timer);
      hoverTimers.current.clear();
    };
  }, []);

  function warmNavCache(href: string) {
    if (hoverTimers.current.has(href)) return;
    const timer = window.setTimeout(() => {
      hoverTimers.current.delete(href);
      prefetchNavPage(queryClient, href);
    }, 150);
    hoverTimers.current.set(href, timer);
  }

  return (
    <Sidebar collapsible="offcanvas" variant="sidebar">
      <SidebarHeader className="h-14 justify-center border-b px-4 py-0">
        <Link
          href="/dashboard"
          prefetch={false}
          className="flex h-full items-center gap-3 overflow-hidden"
          onClick={() => setOpenMobile(false)}
        >
          <BrandLogo className="h-8 w-auto" />
        </Link>
      </SidebarHeader>
      <SidebarContent className="gap-0 pt-3">
        {loading ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu aria-busy="true" aria-label="Loading navigation">
                {Array.from({ length: SIDEBAR_SKELETON_ITEMS }).map((_, index) => (
                  <SidebarMenuItem key={index}>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          groups.map((group) => (
            <SidebarGroup key={group.label} className="py-1">
              <SidebarGroupLabel className="h-7 px-2 text-[11px] font-medium uppercase tracking-[0.16em] text-sidebar-foreground/45">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map(([href, label, Icon]) => {
                    const isActive =
                      href === "/dashboard"
                        ? active === href || active.startsWith(`${href}?`)
                        : active === href || active.startsWith(`${href}/`) || active.startsWith(`${href}?`);
                    return (
                      <SidebarMenuItem key={href}>
                        <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
                          <Link
                            href={href}
                            prefetch={false}
                            aria-current={isActive ? "page" : undefined}
                            onClick={(event) => {
                              setOpenMobile(false);
                              if (
                                event.defaultPrevented ||
                                event.button !== 0 ||
                                event.metaKey ||
                                event.ctrlKey ||
                                event.shiftKey ||
                                event.altKey
                              ) {
                                return;
                              }
                              onNavigateStart(href);
                            }}
                            onPointerEnter={() => warmNavCache(href)}
                          >
                            <Icon aria-hidden="true" />
                            <span>{label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))
        )}
      </SidebarContent>
      {!loading && billing && (
        <SidebarFooter className="mt-auto shrink-0 border-t-0 p-2 pt-0">
          {shouldShowSidebarPlanCard(billing) ? (
            <PlanStatusCard billing={billing} />
          ) : (
            <ActivePlanBadge billing={billing} onNavigate={() => setOpenMobile(false)} />
          )}
        </SidebarFooter>
      )}
    </Sidebar>
  );
}

export function WorkspaceShell({
  organizations,
  currentOrgId,
  role,
  name,
  email,
  image,
  billing,
  loading = false,
  children,
}: WorkspaceShellProps) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPendingHref((current) => (current === pathname ? null : current));
  }, [pathname]);

  useEffect(() => {
    if (!pendingHref) return;
    const timeout = window.setTimeout(() => setPendingHref(null), 30_000);
    return () => window.clearTimeout(timeout);
  }, [pendingHref]);

  const activePath = pendingHref ?? pathname;
  const showContentSkeleton = loading || Boolean(pendingHref);

  return (
    <SidebarProvider
      defaultOpen
      className="h-dvh min-h-dvh overflow-hidden"
    >
      <AppSidebar
        active={activePath}
        role={role}
        billing={billing}
        loading={loading}
        onNavigateStart={(href) => {
          if (href !== pathname) {
            setPendingHref(href);
            contentRef.current?.scrollTo?.({ top: 0 });
          }
        }}
      />
      <SidebarInset className="h-dvh min-h-0 min-w-0 overflow-hidden">
        <header className="z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-none bg-white px-3 backdrop-blur-sm sm:gap-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-3">
            <SidebarTrigger className="-ml-1 size-11 shrink-0 md:hidden" />
            <Link
              href="/dashboard"
              prefetch={false}
              aria-label="UseJunction dashboard"
              className="flex shrink-0 items-center md:hidden"
            >
              <BrandLogo className="h-5 w-auto min-[360px]:h-6" />
            </Link>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-6">
            <WorkspaceSwitcher
              organizations={loading ? [] : organizations}
              currentOrgId={loading ? null : currentOrgId}
              role={role}
              className="h-11 min-w-0 w-[clamp(5.25rem,27vw,9rem)] px-2 sm:h-9 sm:w-auto sm:min-w-[12rem] sm:max-w-[18rem] sm:px-3"
            />
            <WorkspaceUserMenu name={name} email={email} image={image} role={role} />
          </div>
        </header>
        <div
          ref={contentRef}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none px-4 py-5 sm:px-6 sm:py-6 lg:px-8"
        >
          <div className="mx-auto w-full max-w-[1440px]">
            {showContentSkeleton ? <AppPageSkeleton /> : children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
