import { prisma } from "@usejunction/db";
import type { AppPrincipal } from "@/lib/api/app-auth";
import { jsonSafe } from "@/lib/api/app-response";
import { classifyAccount, companyDomains, maskPersonalEmail, type AccountOwnership } from "@/lib/security/tool-accounts";
import { canonicalToolKey } from "@/lib/tools/catalog";

export type ToolAccountRow = {
  id: string;
  person: { id: string; name: string };
  toolKey: string;
  /** Company addresses in full; personal addresses masked. */
  email: string | null;
  ownership: AccountOwnership;
  plan: string | null;
  loginMethod: string;
  signedIn: boolean;
  usageShared: boolean;
  /** The workspace pays for a seat on this tool for this person. */
  companySeat: boolean;
  machine: string;
  updatedAt: string;
};

export type ToolAccountsPayload = {
  domains: string[];
  totals: { logins: number; company: number; personal: number; unknown: number; personalWithSeat: number; personalWithoutSeat: number };
  accounts: ToolAccountRow[];
};

/**
 * Which logins people use for AI tools on work machines. Personal accounts on work machines are the
 * shadow-AI question: work done on plans the company doesn't control, or seats paid twice.
 */
export async function loadToolAccountsPage(principal: AppPrincipal): Promise<ToolAccountsPayload> {
  const [accounts, domains, members, seats] = await Promise.all([
    prisma.toolAccount.findMany({
      where: { orgId: principal.orgId, user: { removedAt: null }, device: { decommissionedAt: null } },
      select: {
        id: true,
        toolName: true,
        email: true,
        plan: true,
        loginMethod: true,
        authPresent: true,
        usageEnabled: true,
        updatedAt: true,
        user: { select: { id: true, name: true } },
        device: { select: { hostname: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
    }),
    prisma.organizationDomain.findMany({ where: { orgId: principal.orgId, verifiedAt: { not: null } }, select: { domain: true } }),
    prisma.developer.findMany({ where: { orgId: principal.orgId, removedAt: null }, select: { email: true } }),
    prisma.developerPlanAssignment.findMany({
      where: { orgId: principal.orgId, active: true, seatStatus: "active", cycleSeatMicros: { gt: 0n } },
      select: { developerId: true, toolName: true },
    }),
  ]);

  const company = companyDomains(domains.map((row) => row.domain), members.map((row) => row.email));
  const seatKeys = new Set(seats.map((seat) => `${seat.developerId}:${canonicalToolKey(seat.toolName)}`));

  const rows: ToolAccountRow[] = accounts.map((account) => {
    const toolKey = canonicalToolKey(account.toolName);
    const ownership = classifyAccount(account.email, company);
    return {
      id: account.id,
      person: { id: account.user.id, name: account.user.name },
      toolKey,
      email: account.email ? (ownership === "company" ? account.email : maskPersonalEmail(account.email)) : null,
      ownership,
      plan: account.plan,
      loginMethod: account.loginMethod,
      signedIn: account.authPresent,
      usageShared: account.usageEnabled,
      companySeat: seatKeys.has(`${account.user.id}:${toolKey}`),
      machine: account.device.hostname,
      updatedAt: account.updatedAt.toISOString(),
    };
  });

  const personal = rows.filter((row) => row.ownership === "personal");
  return jsonSafe({
    domains: [...company].sort(),
    totals: {
      logins: rows.length,
      company: rows.filter((row) => row.ownership === "company").length,
      personal: personal.length,
      unknown: rows.filter((row) => row.ownership === "unknown").length,
      personalWithSeat: personal.filter((row) => row.companySeat).length,
      personalWithoutSeat: personal.filter((row) => !row.companySeat).length,
    },
    accounts: rows.sort((a, b) => {
      const rank = { personal: 0, unknown: 1, company: 2 } as const;
      return rank[a.ownership] - rank[b.ownership] || a.person.name.localeCompare(b.person.name);
    }),
  });
}
