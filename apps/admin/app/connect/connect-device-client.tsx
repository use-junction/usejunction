"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Laptop, Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { OAuthProviderButtons, getEnabledOAuthProviders } from "@/components/auth/oauth-provider-buttons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { browserMutationInit, useRawQuery } from "@/lib/api/client";
import { formatUserCode, normalizeUserCode } from "@/lib/device-auth-code";
import { userFacingError } from "@/lib/errors/user-facing";
import type { CollectionNoticeCopy } from "@/lib/privacy/collection-notice";
import { cn } from "@/lib/utils";

type Session = { user?: { id?: string; email?: string | null } };

type Workspace = { id: string; name: string; current: boolean; blocked: string | null };

type DeviceRequest = {
  status: "pending" | "approved" | "denied" | "consumed" | "expired";
  code: string;
  device: { hostname: string; os: string };
  expiresAt: string;
  workspaces: Workspace[];
  notice: CollectionNoticeCopy;
};

type Lookup =
  | { kind: "loading" }
  | { kind: "ready"; request: DeviceRequest }
  | { kind: "not_found" }
  | { kind: "signed_out" }
  | { kind: "error"; message: string };

type Outcome = "connected" | "refused" | null;

const shell = { size: "md", accent: "cyan", contentAlign: "top", statement: "Visibility before control." } as const;

function Waiting({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin text-primary" />
      {label}
    </div>
  );
}

/** No code in the link: the person types the one their terminal printed. */
function EnterCode({ invalid }: { invalid: boolean }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(
    invalid ? "That code isn’t valid. Check the one your terminal printed." : null,
  );

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = normalizeUserCode(value);
    if (!code) {
      setError("Enter the 8-letter code your terminal printed, like KQRT-BXWM.");
      return;
    }
    window.location.href = `/connect?code=${formatUserCode(code)}`;
  }

  return (
    <AuthShell {...shell} title="Connect a device." description="Enter the code your terminal printed after the install command.">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="device-code">Code</Label>
          <Input
            id="device-code"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="KQRT-BXWM"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono uppercase tracking-[0.2em]"
            autoFocus
          />
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
    </AuthShell>
  );
}

/** Signed out: sign in or sign up, and come back to the same code. */
function SignInToConnect({ code }: { code: string }) {
  const callbackUrl = `/connect?code=${code}`;
  const hasOAuth = getEnabledOAuthProviders().length > 0;
  return (
    <AuthShell
      {...shell}
      title="Connect this device."
      description="Sign in or create an account to see this machine’s AI coding usage. You’ll confirm the device on the next step."
    >
      <div className="space-y-4">
        <CodeLine code={code} />
        <OAuthProviderButtons
          callbackUrl={callbackUrl}
          showEmailDivider={hasOAuth}
          emailDividerLabel="or use email"
          notice={
            <p className="text-center text-xs leading-5 text-muted-foreground">
              By continuing with a provider, you agree to the{" "}
              <a href="/terms" className="font-medium text-foreground underline underline-offset-4">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/privacy" className="font-medium text-foreground underline underline-offset-4">
                Privacy Policy
              </a>
              .
            </p>
          }
        />
        <div className="space-y-3">
          <Button asChild className="w-full text-white">
            <a href={`/signup?from=${encodeURIComponent(callbackUrl)}`}>Create account</a>
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <a
              href={`/login?from=${encodeURIComponent(callbackUrl)}`}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Sign in
            </a>
          </p>
        </div>
      </div>
    </AuthShell>
  );
}

function CodeLine({ code }: { code: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      Code from your terminal:{" "}
      <span className="font-mono font-medium tracking-[0.14em] text-foreground">{code}</span>
    </p>
  );
}

function NoticeSummary({ notice }: { notice: CollectionNoticeCopy }) {
  return (
    <div className="rounded-lg border border-border p-4 text-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">Collected</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 leading-5 text-muted-foreground">
            {notice.collects.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">Never collected</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 leading-5 text-muted-foreground">
            {notice.neverCollects.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
        {notice.whoSees} {notice.retention}
      </p>
    </div>
  );
}

function Approve({
  request,
  email,
  onDone,
}: {
  request: DeviceRequest;
  email: string | null;
  onDone: (outcome: Exclude<Outcome, null>) => void;
}) {
  const [orgId, setOrgId] = useState(
    () => (request.workspaces.find((workspace) => workspace.current) ?? request.workspaces[0])?.id ?? null,
  );
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const workspace = request.workspaces.find((candidate) => candidate.id === orgId) ?? null;
  const blocked = workspace?.blocked ?? null;

  async function decide(decision: "approve" | "deny") {
    setBusy(decision);
    setError(null);
    try {
      const response = await fetch(
        "/api/device-auth/approve",
        browserMutationInit("POST", { code: request.code, decision, ...(orgId ? { orgId } : {}) }),
      );
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(
          data.error === "verify your email to continue"
            ? "Check your email for a verification link, then come back to this page."
            : userFacingError(data.error, "Could not connect this device. Try again."),
        );
        return;
      }
      onDone(decision === "approve" ? "connected" : "refused");
    } catch {
      setError("Could not reach UseJunction. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthShell
      {...shell}
      title="Connect this device?"
      description="Only connect a machine you just ran the install command on."
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-lg border border-border p-4">
          <Laptop className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="truncate font-medium">{request.device.hostname}</p>
            <p className="text-sm text-muted-foreground">{request.device.os}</p>
            <div className="mt-2">
              <CodeLine code={request.code} />
            </div>
          </div>
        </div>

        {request.workspaces.length > 1 ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Workspace</legend>
            {request.workspaces.map((candidate) => (
              <label
                key={candidate.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm",
                  candidate.id === orgId ? "border-primary" : "border-border",
                )}
              >
                <input
                  type="radio"
                  name="workspace"
                  className="size-4 accent-[#08a8c4]"
                  checked={candidate.id === orgId}
                  onChange={() => setOrgId(candidate.id)}
                />
                <span className="min-w-0 truncate">{candidate.name}</span>
              </label>
            ))}
          </fieldset>
        ) : workspace ? (
          <p className="text-sm text-muted-foreground">
            Usage from this device goes to <span className="font-medium text-foreground">{workspace.name}</span>
            {email ? <> as {email}</> : null}.
          </p>
        ) : null}

        {blocked ? (
          <Alert>
            <AlertDescription>
              {blocked === "This user already has a device enrolled."
                ? "You already have a device connected in this workspace. Remove it under My devices first, or pick another workspace."
                : blocked}
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-3">
          <Button className="w-full" disabled={busy !== null || Boolean(blocked)} onClick={() => void decide("approve")}>
            {busy === "approve" ? "Connecting…" : "Connect this device"}
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            disabled={busy !== null}
            onClick={() => void decide("deny")}
          >
            {busy === "deny" ? "Refusing…" : "This isn’t my device"}
          </Button>
        </div>
        {/* The action stays in view; what it agrees to sits directly under it. */}
        <div className="space-y-3 pt-1">
          <p className="text-xs leading-5 text-muted-foreground">
            Connecting confirms you’ve read what is collected from this device (notice {request.notice.version}):
          </p>
          <NoticeSummary notice={request.notice} />
        </div>
      </div>
    </AuthShell>
  );
}

function Connected() {
  return (
    <AuthShell
      {...shell}
      title="Device connected."
      description="Go back to your terminal. It’s uploading your usage now, and the dashboard fills in as it arrives."
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 text-sm">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-4" aria-hidden />
          </span>
          You can close this tab or open your dashboard.
        </div>
        <Button asChild className="w-full">
          <a href="/auth/continue">Open dashboard</a>
        </Button>
      </div>
    </AuthShell>
  );
}

function Unavailable({ title, message }: { title: string; message: string }) {
  return (
    <AuthShell {...shell} title={title} description={message}>
      <p className="text-sm text-muted-foreground">
        Run the install command again to get a new code. Codes last 15 minutes.
      </p>
    </AuthShell>
  );
}

export function ConnectDeviceClient() {
  const params = useSearchParams();
  const rawCode = params.get("code");
  const normalized = normalizeUserCode(rawCode);
  const code = normalized ? formatUserCode(normalized) : null;

  const session = useRawQuery<Session>(["auth", "session"], "/api/auth/session");
  const signedIn = Boolean(session.data?.user?.id);
  const [lookup, setLookup] = useState<Lookup>({ kind: "loading" });
  const [outcome, setOutcome] = useState<Outcome>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    if (!code) return;
    try {
      const response = await fetch(`/api/device-auth/request?code=${encodeURIComponent(code)}`, {
        signal,
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) return setLookup({ kind: "signed_out" });
      if (response.status === 404) return setLookup({ kind: "not_found" });
      const data = (await response.json().catch(() => null)) as (DeviceRequest & { error?: string }) | null;
      if (!response.ok || !data) {
        return setLookup({
          kind: "error",
          message: userFacingError(data?.error, "Could not load this device. Refresh to try again."),
        });
      }
      setLookup({ kind: "ready", request: data });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLookup({ kind: "error", message: "Could not reach UseJunction. Check your connection and refresh." });
    }
  }, [code]);

  useEffect(() => {
    if (!code || !signedIn) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [code, signedIn, load]);

  if (!code) return <EnterCode invalid={Boolean(rawCode)} />;

  if (session.isPending) {
    return (
      <AuthShell {...shell} title="Connect this device." description="Checking your code…">
        <Waiting label="One moment…" />
      </AuthShell>
    );
  }
  if (!signedIn || lookup.kind === "signed_out") return <SignInToConnect code={code} />;

  if (outcome === "connected") return <Connected />;
  if (outcome === "refused") {
    return (
      <AuthShell
        {...shell}
        title="Request refused."
        description="Nothing was connected. If you didn’t run the install command yourself, no further action is needed."
      >
        <Button asChild variant="outline" className="w-full">
          <a href="/auth/continue">Open dashboard</a>
        </Button>
      </AuthShell>
    );
  }

  if (lookup.kind === "loading") {
    return (
      <AuthShell {...shell} title="Connect this device." description="Finding the machine that asked…">
        <Waiting label="One moment…" />
      </AuthShell>
    );
  }
  if (lookup.kind === "not_found") {
    return <Unavailable title="This code isn’t valid." message="It may have been mistyped or already replaced by a newer one." />;
  }
  if (lookup.kind === "error") {
    return (
      <AuthShell {...shell} title="Connect this device." description={lookup.message}>
        <Button className="w-full" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </AuthShell>
    );
  }

  const { request } = lookup;
  if (request.status === "approved" || request.status === "consumed") return <Connected />;
  if (request.status === "denied") {
    return <Unavailable title="This request was refused." message="Nothing was connected." />;
  }
  if (request.status === "expired") {
    return <Unavailable title="This code has expired." message="The terminal stopped waiting for it." />;
  }
  return <Approve request={request} email={session.data?.user?.email ?? null} onDone={setOutcome} />;
}
