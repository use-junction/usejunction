"use client";

import { OAuthProviderButtons, getEnabledOAuthProviders } from "@/components/auth/oauth-provider-buttons";
import { RegionPicker } from "@/components/auth/region-picker";
import { Button } from "@/components/ui/button";

export function InviteAuthActions({ token }: { token: string }) {
  const callbackUrl = `/join/${token}`;
  const hasOAuth = getEnabledOAuthProviders().length > 0;

  return (
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
    </div>
  );
}
