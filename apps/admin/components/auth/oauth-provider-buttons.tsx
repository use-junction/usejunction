"use client";

import { useState } from "react";
import { startOAuthSignIn } from "@/lib/auth/oauth-sign-in";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export type OAuthProviderId = "google" | "github" | "microsoft-entra-id";

type Provider = {
  id: OAuthProviderId;
  label: string;
  enabled: boolean;
};

export function getEnabledOAuthProviders(): Provider[] {
  const providers: Provider[] = [
    { id: "google", label: "Google", enabled: process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true" },
    { id: "github", label: "GitHub", enabled: process.env.NEXT_PUBLIC_GITHUB_AUTH_ENABLED === "true" },
    {
      id: "microsoft-entra-id",
      label: "Microsoft",
      enabled: process.env.NEXT_PUBLIC_MICROSOFT_AUTH_ENABLED === "true",
    },
  ];
  return providers.filter((provider) => provider.enabled);
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function GitHubLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 1.27a11 11 0 0 0-3.48 21.46c.55.1.73-.24.73-.53v-1.84c-3.03.66-3.67-1.46-3.67-1.46-.5-1.26-1.21-1.6-1.21-1.6-.99-.68.08-.66.08-.66 1.1.08 1.68 1.13 1.68 1.13.98 1.68 2.56 1.2 3.18.91.1-.7.38-1.2.69-1.47-2.42-.28-4.96-1.21-4.96-5.4 0-1.19.42-2.17 1.12-2.93-.11-.28-.49-1.4.11-2.91 0 0 .92-.3 3.01 1.12a10.4 10.4 0 0 1 5.48 0c2.09-1.42 3.01-1.12 3.01-1.12.6 1.51.22 2.63.11 2.91.7.76 1.12 1.74 1.12 2.93 0 4.2-2.55 5.12-4.98 5.39.39.34.74 1.01.74 2.04v3.02c0 .29.18.63.74.53A11 11 0 0 0 12 1.27z" />
    </svg>
  );
}

function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M13 1h10v10H13z" />
      <path fill="#00A4EF" d="M1 13h10v10H1z" />
      <path fill="#FFB900" d="M13 13h10v10H13z" />
    </svg>
  );
}

function ProviderLogo({ id, className }: { id: OAuthProviderId; className?: string }) {
  const iconClass = cn("size-4 shrink-0", className);
  if (id === "google") return <GoogleLogo className={iconClass} />;
  if (id === "github") return <GitHubLogo className={iconClass} />;
  return <MicrosoftLogo className={iconClass} />;
}

type OAuthProviderButtonsProps = {
  callbackUrl: string;
  className?: string;
  /** Shown under the provider buttons when an email form follows. */
  showEmailDivider?: boolean;
  emailDividerLabel?: string;
  /** Rendered directly under the provider buttons, above the email divider. */
  notice?: React.ReactNode;
};

export function OAuthProviderButtons({
  callbackUrl,
  className,
  showEmailDivider = false,
  emailDividerLabel = "or continue with email",
  notice,
}: OAuthProviderButtonsProps) {
  const providers = getEnabledOAuthProviders();
  const [pendingProvider, setPendingProvider] = useState<OAuthProviderId | null>(null);
  if (providers.length === 0) return null;

  async function handleSignIn(providerId: OAuthProviderId) {
    if (pendingProvider) return;
    setPendingProvider(providerId);
    const started = await startOAuthSignIn(providerId, callbackUrl);
    if (!started) setPendingProvider(null);
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div className="grid gap-2">
        {providers.map((provider) => (
          <Button
            key={provider.id}
            type="button"
            variant="outline"
            className="w-full justify-center gap-2.5"
            disabled={pendingProvider !== null}
            aria-busy={pendingProvider === provider.id}
            onClick={() => void handleSignIn(provider.id)}
          >
            <ProviderLogo id={provider.id} />
            {pendingProvider === provider.id
              ? `Continuing with ${provider.label}…`
              : `Continue with ${provider.label}`}
          </Button>
        ))}
      </div>
      {notice}
      {showEmailDivider ? (
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
            {emailDividerLabel}
          </span>
          <Separator className="flex-1" />
        </div>
      ) : null}
    </div>
  );
}
