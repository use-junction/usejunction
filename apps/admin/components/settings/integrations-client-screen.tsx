"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppPageSkeleton } from "@/components/app-data-state";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { ToolBrandIcon } from "@/components/tools/tool-brand-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { browserMutationInit, useInvalidateAppData } from "@/lib/api/client";
import { userFacingError } from "@/lib/errors/user-facing";
import { formatRelativeTime } from "@/lib/format";

type Connection = {
  id: string;
  provider: string;
  product: string;
  method: string;
  status: string;
  externalOrgId: string | null;
  credentialFingerprint: string | null;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  lastError: string | null;
};

type IntegrationsResponse = { connections: Connection[] };

/** Vendor admin APIs the backend can sync. Billing data from these replaces estimates from machines. */
const PROVIDERS = [
  {
    provider: "cursor",
    product: "teams",
    icon: "cursor",
    name: "Cursor Teams",
    gives: "Members, seats, daily usage and spend per person, straight from Cursor.",
    keyLabel: "Admin API key",
    keyHelp: "Create an Admin API key in your Cursor team dashboard settings. Only team admins can create one.",
    placeholder: "key_…",
  },
  {
    provider: "openai",
    product: "api_platform",
    icon: "codex",
    name: "OpenAI API",
    gives: "Usage and billed cost per project and API key, so pay-as-you-go spend is exact.",
    keyLabel: "Admin key",
    keyHelp: "Create an Admin key in the OpenAI platform under your organization's settings. Read access to usage is enough.",
    placeholder: "sk-admin-…",
  },
  {
    provider: "anthropic",
    product: "api_platform",
    icon: "claude",
    name: "Anthropic API",
    gives: "Usage and cost reports, workspaces and API keys with their owners.",
    keyLabel: "Admin API key",
    keyHelp: "Create an Admin API key in the Anthropic Console settings. Only organization admins can create one.",
    placeholder: "sk-ant-admin…",
  },
] as const;

type ProviderSpec = (typeof PROVIDERS)[number];

async function fetchIntegrations(signal?: AbortSignal): Promise<IntegrationsResponse> {
  const response = await fetch("/api/integrations", { credentials: "same-origin", signal });
  if (!response.ok) throw new Error("Could not load integrations.");
  return (await response.json()) as IntegrationsResponse;
}

function StatusLine({ connection }: { connection: Connection | undefined }) {
  if (!connection || connection.status === "disconnected") {
    return <span className="text-xs text-muted-foreground">Not connected</span>;
  }
  if (connection.lastError) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <CircleAlert className="size-3.5" aria-hidden /> Last sync failed · test the key or reconnect
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CheckCircle2 className="size-3.5 text-success" aria-hidden />
      Connected{connection.externalOrgId ? ` · ${connection.externalOrgId}` : ""}
      {connection.lastSyncedAt ? ` · synced ${formatRelativeTime(connection.lastSyncedAt)}` : " · not synced yet"}
    </span>
  );
}

export default function IntegrationsClientScreen() {
  const queryClient = useQueryClient();
  const invalidateAppData = useInvalidateAppData();
  const query = useQuery({ queryKey: ["app", "integrations"], queryFn: ({ signal }) => fetchIntegrations(signal) });
  const [connecting, setConnecting] = useState<ProviderSpec | null>(null);
  const [disconnecting, setDisconnecting] = useState<{ spec: ProviderSpec; connection: Connection } | null>(null);
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (query.isPending) return <AppPageSkeleton />;
  if (query.isError) {
    return (
      <>
        <PageHeader title="Integrations." />
        <p className="text-sm text-muted-foreground">Only workspace owners and admins can manage integrations.</p>
      </>
    );
  }

  const connections = query.data.connections;
  const connectionFor = (spec: ProviderSpec) =>
    connections.find((row) => row.provider === spec.provider && row.product === spec.product && row.status !== "disconnected");
  const github = connections.filter((row) => row.provider === "github" && row.status !== "disconnected");

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["app", "integrations"] });
    await invalidateAppData();
  }

  async function connect() {
    if (!connecting) return;
    setBusy("connect");
    setError(null);
    const response = await fetch(
      "/api/integrations",
      browserMutationInit("POST", {
        provider: connecting.provider,
        product: connecting.product,
        method: "admin_api_key",
        credential: credential.trim(),
        config: {},
      }),
    );
    const body = (await response.json().catch(() => ({}))) as { error?: string; connection?: { id: string } };
    if (!response.ok || !body.connection) {
      setBusy(null);
      setError(
        response.status === 422
          ? `${connecting.name} rejected that key. Check it's an admin key with read access.`
          : userFacingError(body.error, "Could not connect."),
      );
      return;
    }
    // First sync right away so numbers show up without waiting.
    await fetch(`/api/integrations/${encodeURIComponent(body.connection.id)}/sync`, browserMutationInit("POST")).catch(() => null);
    setBusy(null);
    setCredential("");
    toast.success(`${connecting.name} connected.`);
    setConnecting(null);
    await refresh();
  }

  async function act(connection: Connection, action: "sync" | "test" | "disconnect", name: string) {
    setBusy(`${action}:${connection.id}`);
    const response = await fetch(`/api/integrations/${encodeURIComponent(connection.id)}/${action}`, browserMutationInit("POST"));
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!response.ok) {
      toast.error(
        action === "test"
          ? `${name} rejected the stored key. Reconnect with a new one.`
          : userFacingError(body.error, action === "sync" ? `Could not sync ${name}.` : `Could not disconnect ${name}.`),
      );
      return;
    }
    toast.success(action === "sync" ? `${name} synced.` : action === "test" ? `${name} key works.` : `${name} disconnected.`);
    if (action === "disconnect") setDisconnecting(null);
    await refresh();
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Integrations."
        description="Connect vendor admin APIs so seats and spend come from the vendor's own records instead of estimates from machines."
        className="mb-8"
      />

      <div className="space-y-6">
        <Panel as="section" padded={false}>
          <div className="border-b bg-muted/25 px-5 py-4">
            <h2 className="text-lg font-semibold tracking-tight">AI vendors.</h2>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Keys are encrypted at rest and never shown again. Use read-only admin keys where the vendor offers them.
              Connections sync when you press Sync now, and on the scheduled provider sync where your deployment runs it.
            </p>
          </div>
          <ul className="divide-y">
            {PROVIDERS.map((spec) => {
              const connection = connectionFor(spec);
              return (
                <li key={`${spec.provider}-${spec.product}`} className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
                  <span className="flex min-w-0 max-w-xl items-start gap-3">
                    <ToolBrandIcon tool={spec.icon} size={22} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{spec.name}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{spec.gives}</span>
                      <span className="mt-1.5 block"><StatusLine connection={connection} /></span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {connection ? (
                      <>
                        <Button size="sm" variant="outline" className="rounded-none" disabled={Boolean(busy)} onClick={() => void act(connection, "sync", spec.name)}>
                          {busy === `sync:${connection.id}` ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-3.5" aria-hidden />} Sync now
                        </Button>
                        <Button size="sm" variant="outline" className="rounded-none" disabled={Boolean(busy)} onClick={() => void act(connection, "test", spec.name)}>
                          {busy === `test:${connection.id}` ? <Loader2 className="size-4 animate-spin" /> : null} Test key
                        </Button>
                        <Button size="sm" variant="ghost" className="rounded-none text-destructive hover:text-destructive" disabled={Boolean(busy)} onClick={() => setDisconnecting({ spec, connection })}>
                          Disconnect
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" className="rounded-none" onClick={() => { setError(null); setCredential(""); setConnecting(spec); }}>
                        Connect
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel as="section" padded={false}>
          <div className="border-b bg-muted/25 px-5 py-4">
            <h2 className="text-lg font-semibold tracking-tight">Code and work.</h2>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5">
            <span className="flex min-w-0 max-w-xl items-start gap-3">
              <ToolBrandIcon tool="github-copilot" size={22} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">GitHub</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Repositories, pull requests and Projects, so Work can show where AI spend landed.
                </span>
                <span className="mt-1.5 block text-xs text-muted-foreground">
                  {github.length ? `${github.length} ${github.length === 1 ? "account" : "accounts"} connected` : "Not connected"}
                </span>
              </span>
            </span>
            <Link href="/work-spend" className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
              {github.length ? "Manage in Work" : "Connect in Work"} <ArrowRight className="size-3" aria-hidden />
            </Link>
          </div>
        </Panel>

        <Panel as="section" className="sm:p-6">
          <h2 className="text-lg font-semibold tracking-tight">Single sign-on.</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            SAML SSO and SCIM provisioning (Okta, Entra ID, Google Workspace) are not available yet. Today people sign in with Google,
            GitHub, or email, and you can restrict who joins with a verified company domain during onboarding.
          </p>
        </Panel>
      </div>

      <Dialog open={connecting !== null} onOpenChange={(next) => { if (!next && !busy) setConnecting(null); }}>
        <DialogContent className="max-w-md gap-5 rounded-none">
          {connecting ? (
            <>
              <DialogHeader>
                <DialogTitle>Connect {connecting.name}</DialogTitle>
                <DialogDescription>{connecting.keyHelp}</DialogDescription>
              </DialogHeader>
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void connect();
                }}
              >
                <Label htmlFor="integration-credential">{connecting.keyLabel}</Label>
                <Input
                  id="integration-credential"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={credential}
                  placeholder={connecting.placeholder}
                  onChange={(event) => setCredential(event.target.value)}
                  className="rounded-none font-mono"
                />
                <p className="text-xs text-muted-foreground">We check the key with {connecting.name} before saving it.</p>
              </form>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button variant="outline" className="rounded-none" disabled={Boolean(busy)} onClick={() => setConnecting(null)}>Cancel</Button>
                <Button className="rounded-none" disabled={Boolean(busy) || credential.trim().length < 8} onClick={() => void connect()}>
                  {busy === "connect" ? <Loader2 className="size-4 animate-spin" /> : "Connect"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={disconnecting !== null} onOpenChange={(next) => { if (!next && !busy) setDisconnecting(null); }}>
        <DialogContent className="max-w-md gap-5 rounded-none">
          {disconnecting ? (
            <>
              <DialogHeader>
                <DialogTitle>Disconnect {disconnecting.spec.name}?</DialogTitle>
                <DialogDescription>
                  The stored key is deleted and syncing stops. Usage already imported stays; new spend falls back to machine estimates.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" className="rounded-none" disabled={Boolean(busy)} onClick={() => setDisconnecting(null)}>Cancel</Button>
                <Button variant="destructive" className="rounded-none" disabled={Boolean(busy)} onClick={() => void act(disconnecting.connection, "disconnect", disconnecting.spec.name)}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : "Disconnect"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
