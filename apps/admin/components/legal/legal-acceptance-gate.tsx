"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { browserMutationInit } from "@/lib/api/client";
import { userFacingError } from "@/lib/errors/user-facing";

export function LegalAcceptanceGate({ children }: { children: React.ReactNode }) {
  const [needed, setNeeded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/app/me/legal", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { accepted?: boolean };
        if (!cancelled) setNeeded(body.accepted === false);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function accept() {
    setSaving(true);
    setError(null);
    const response = await fetch("/api/app/me/legal", browserMutationInit("POST", { accept: true }));
    const body = (await response.json().catch(() => ({}))) as { accepted?: boolean; error?: string };
    setSaving(false);
    if (!response.ok || body.accepted !== true) {
      setError(userFacingError(body.error, "Could not record acceptance."));
      return;
    }
    setNeeded(false);
  }

  if (loading) return children;
  if (!needed) return children;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md border border-border bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold tracking-tight">Accept Terms and Privacy Policy</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          To continue, confirm you agree to the{" "}
          <Link href="/terms" className="font-medium text-[#08a8c4] underline-offset-4 hover:underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="font-medium text-[#08a8c4] underline-offset-4 hover:underline">
            Privacy Policy
          </Link>
          . Employee telemetry is controlled by your organization.
        </p>
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        <Button type="button" className="mt-5 w-full" disabled={saving} onClick={() => void accept()}>
          {saving ? "Saving…" : "I agree"}
        </Button>
      </div>
    </div>
  );
}
