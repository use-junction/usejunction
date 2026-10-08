"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AppPageSkeleton } from "@/components/app-data-state";
import { prefetchNavPage } from "@/lib/app-pages/nav-prefetch";
import {
  Activity,
  BarChart3,
  CircleDollarSign,
  Database,
  GitPullRequest,
  KeyRound,
  LayoutDashboard,
  Mail,
  MonitorSmartphone,
  Plug,
  ScrollText,
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
import { canManageSettings, canSeeOrgOverview } from "@/lib/rbac/permissions";
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
  ["/overview", "Overview", LayoutDashboard],
  ["/dashboard", "Usage", BarChart3],
  ["/activity", "Adoption", Activity],
  ["/tools", "Cost", CircleDollarSign],
  ["/work-spend", "Work", GitPullRequest],
  ["/reports", "Reports", Mail],
  ["/signals", "Signals", SignalsMark],
];

const discoverMember: NavItem[] = [
  ["/dashboard", "Usage", BarChart3],
  ["/activity", "Adoption", Activity],
  ["/tools", "Cost", CircleDollarSign],
  ["/reports", "Reports", Mail],
];

const peopleGroup: NavItem[] = [
  ["/team", "People", Users],
  ["/team?tab=fleet", "Fleet", MonitorSmartphone],
];
const youGroup: NavItem[] = [["/me/data", "My data", Database]];
const securityGroup: NavItem[] = [
  ["/accounts", "Tool accounts", KeyRound],
  ["/settings/audit", "Audit log", ScrollText],
];
const configureAdmin: NavItem[] = [
  ["/settings", "Settings", Settings],
  ["/settings/integrations", "Integrations", Plug],
];
const configureMember: NavItem[] = [["/settings", "Settings", Settings]];

const adminNav: NavGroup[] = [
  { label: "Discover", items: discoverAdmin },
  { label: "People", items: peopleGroup },
  { label: "You", items: youGroup },
  { label: "Security", items: securityGroup },
  { label: "Configure", items: configureAdmin },
];

/** Managers see the workspace but not settings, integrations, or security records. */
const managerNav: NavGroup[] = [
  { label: "Discover", items: discoverAdmin },
  { label: "People", items: peopleGroup },
  { label: "You", items: youGroup },
  { label: "Configure", items: configureMember },
];

const memberNav: NavGroup[] = [
  { label: "Discover", items: discoverMember },
  { label: "You", items: youGroup },
  { label: "Configure", items: configureMember },
];

/** Fleet is a tab of /team, so its active state depends on `?tab=`. */
function isNavItemActive(href: string, path: string, tab: string | null) {
  const [hrefPath, hrefQuery] = href.split("?");
  if (hrefQuery) {
    return path === hrefPath && new URLSearchParams(hrefQuery).get("tab") === tab;
  }
  if (href === "/team" && path === "/team" && tab === "fleet") return false;
  if (href === "/dashboard") return path === href;
  if (href === "/settings") return path === href;
  return path === href || path.startsWith(`${href}/`);
}

export function navForRole(role: OrganizationRole | null) {
  const groups = canManageSettings(role) ? adminNav : canSeeOrgOverview(role) ? managerNav : memberNav;
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
  const searchParams = useSearchParams();
  const [activePath, activeQuery] = active.split("?");
  const activeTab = activeQuery !== undefined ? new URLSearchParams(activeQuery).get("tab") : searchParams.get("tab");
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
          href={canSeeOrgOverview(role) ? "/overview" : "/dashboard"}
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
                    const isActive = isNavItemActive(href, activePath ?? active, activeTab);
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
    setPendingHref((current) => (current?.split("?")[0] === pathname ? null : current));
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
          // Same-page tab links (e.g. /team?tab=fleet from /team) never change the pathname.
          if (href.split("?")[0] !== pathname) {
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
              href={canSeeOrgOverview(role) ? "/overview" : "/dashboard"}
              prefetch={false}
              aria-label="UseJunction home"
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
