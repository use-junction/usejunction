"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { OAuthProviderButtons, getEnabledOAuthProviders } from "@/components/auth/oauth-provider-buttons";
import { RegionPicker } from "@/components/auth/region-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { userFacingError } from "@/lib/errors/user-facing";

export function SignupForm() {
  const params = useSearchParams();
  const intent = params.get("intent") === "team" ? "team" : "community";
  const soloMode = params.get("mode") === "solo";
  const from = params.get("from") || (soloMode ? "/onboarding?mode=solo" : "/onboarding");
  const oauthCallbackUrl =
    from === "/dashboard" || from === "/" || from === "/onboarding"
      ? "/onboarding"
      : from;
  const emailPrefill = params.get("email") ?? "";
  const joiningInvite =
    from.startsWith("/i/") || from.startsWith("/join/");
  const hasOAuth = getEnabledOAuthProviders().length > 0;

  const [name, setName] = useState("");
  const [email, setEmail] = useState(emailPrefill);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    if (!acceptedTerms) {
      setError("Accept the Terms of Service and Privacy Policy to create an account.");
      setLoading(false);
      return;
    }
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        password,
        confirmPassword,
        intent,
        from,
        acceptTerms: true,
      }),
    });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setError(userFacingError(data.error, "Unable to create your account."));
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <Alert>
        <AlertDescription>
          {joiningInvite
            ? "Check your email for a verification link. After verifying, sign in — you'll return to your invite to install UseJunction."
            : soloMode
              ? "Check your email for a verification link. Once verified, sign in to analyze your own AI coding usage."
              : "Check your email for a verification link. Once verified, sign in to open your dashboard."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      {joiningInvite && (
        <Alert>
          <AlertDescription>
            {hasOAuth
              ? "Continue with Google or GitHub, or create an account with your work email. After signup you'll return to the invite to install UseJunction."
              : "Create an account with your work email. After signup you'll return to the invite to install UseJunction."}
          </AlertDescription>
        </Alert>
      )}
      <RegionPicker />
      <OAuthProviderButtons
        callbackUrl={oauthCallbackUrl}
        showEmailDivider
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
      <form onSubmit={submit} className="space-y-4" aria-busy={loading}>
        <div className="space-y-2">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            minLength={12}
            aria-describedby="password-hint"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="new-password"
          />
          <p id="password-hint" className="text-xs text-muted-foreground">
            At least 12 characters.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            minLength={12}
            autoComplete="new-password"
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <label className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[#08a8c4]"
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
            required
          />
          <span>
            I agree to the{" "}
            <a href="/terms" className="font-medium text-foreground underline underline-offset-4">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" className="font-medium text-foreground underline underline-offset-4">
              Privacy Policy
            </a>
            .
          </span>
        </label>
        <Button type="submit" className="w-full" disabled={loading || !acceptedTerms}>
          {loading ? "Creating account…" : joiningInvite ? "Create account & continue" : "Create account"}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <a
          href={`/login?from=${encodeURIComponent(from)}${email ? `&email=${encodeURIComponent(email)}` : ""}`}
          className="text-foreground !underline underline-offset-4"
        >
          Sign in
        </a>
      </p>
    </div>
  );
}
