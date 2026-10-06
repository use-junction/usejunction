"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { OAuthProviderButtons, getEnabledOAuthProviders } from "@/components/auth/oauth-provider-buttons";
import { RegionPicker } from "@/components/auth/region-picker";
import { Button } from "@/components/ui/button";
import { userFacingError } from "@/lib/errors/user-facing";
import { activateWorkspace } from "@/lib/api/client";
import { resetPostHogIdentity } from "@/lib/posthog/client";

type Props = {
  token: string;
  organizationName: string;
  signedIn: boolean;
  sessionEmail: string | null;
};

type RedeemState =
  | { kind: "idle"; note?: string }
  | { kind: "redeeming" }
  | { kind: "error"; message: string };

type RedeemResult = {
  orgId: string;
};

const redeemInFlight = new Map<string, Promise<RedeemResult>>();

async function redeemInvite(token: string): Promise<RedeemResult> {
  const existing = redeemInFlight.get(token);
  if (existing) return existing;

  const pending = (async () => {
    try {
      const response = await fetch(`/api/i/${encodeURIComponent(token)}/redeem`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(userFacingError(data.error, "Could not redeem invite.")) as Error & {
          status?: number;
        };
        error.status = response.status;
        throw error;
      }
      if (typeof data.orgId !== "string") {
        throw new Error("Could not activate the invited workspace.");
      }
      try {
        await activateWorkspace(data.orgId);
      } catch {
        throw new Error("Could not activate the invited workspace.");
      }
      return { orgId: data.orgId };
    } finally {
      redeemInFlight.delete(token);
    }
  })();

  redeemInFlight.set(token, pending);
  return pending;
}

function InviteSignIn({
  organizationName,
  callbackUrl,
  note,
}: {
  organizationName: string;
  callbackUrl: string;
  note?: string;
}) {
  const hasOAuth = getEnabledOAuthProviders().length > 0;

  return (
    <AuthShell
      size="md"
      accent="cyan"
      contentAlign="top"
      title={`Join ${organizationName}.`}
      description="Sign in with your work email, then finish setup."
      statement="Visibility before control."
    >
      <div className="space-y-4">
        <RegionPicker />
        <OAuthProviderButtons callbackUrl={callbackUrl} showEmailDivider={hasOAuth} emailDividerLabel="or use email" />
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
        {note ? (
          <p className="pt-1 text-center text-sm text-amber-800 dark:text-amber-200">{note}</p>
        ) : null}
      </div>
    </AuthShell>
  );
}

export function TeamInviteClient({ token, organizationName, signedIn, sessionEmail }: Props) {
  const [state, setState] = useState<RedeemState>(signedIn ? { kind: "redeeming" } : { kind: "idle" });
  const callbackUrl = `/i/${token}`;

  useEffect(() => {
    if (!signedIn) return;

    let cancelled = false;

    void (async () => {
      setState({ kind: "redeeming" });
      try {
        await redeemInvite(token);
        if (cancelled) return;
        // Role-based connect vs manage choice lives on /onboarding.
        window.location.href = "/onboarding";
      } catch (error) {
        if (cancelled) return;
        const status =
          typeof error === "object" && error && "status" in error ? Number(error.status) : undefined;
        const message = error instanceof Error ? error.message : "Could not redeem invite.";

        if (status === 401) {
          // Stale JWT / wiped DB — clear quietly. Do not claim the visitor is
          // "already signed in"; that reads as a false positive for new joiners.
          resetPostHogIdentity();
          await signOut({ redirect: false });
          if (cancelled) return;
          setState({ kind: "idle" });
          return;
        }

        if (message === "verify your email to continue") {
          setState({
            kind: "idle",
            note: "Check your email for a verification link, then sign in to join.",
          });
          return;
        }

        setState({ kind: "error", message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signedIn, token, sessionEmail]);

  if (state.kind === "redeeming") {
    return (
      <AuthShell
        size="md"
        accent="cyan"
        contentAlign="top"
        title={`Join ${organizationName}.`}
        description="Confirming your invite…"
        statement="Visibility before control."
      >
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          Taking you to setup…
        </div>
      </AuthShell>
    );
  }

  if (state.kind === "error") {
    return (
      <AuthShell
        size="md"
        accent="cyan"
        contentAlign="top"
        title={`Join ${organizationName}.`}
        description="Something went wrong accepting this invite."
        statement="Visibility before control."
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{state.message}</p>
          <Button asChild className="w-full">
            <a href={callbackUrl}>Try again</a>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <InviteSignIn
      organizationName={organizationName}
      callbackUrl={callbackUrl}
      note={state.note}
    />
  );
}
