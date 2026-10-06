"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { browserMutationInit } from "@/lib/api/client";
import { myDataKey } from "@/lib/app-pages/query-keys";
import { persistAnalyticsConsent } from "@/lib/consent/analytics-consent";
import { userFacingError } from "@/lib/errors/user-facing";
import { ERASURE_GRACE_DAYS } from "@/lib/legal/versions";
import type { MyDataRights } from "@/lib/privacy/my-data-types";

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  );
}

export function MyDataRights({
  rights,
  analyticsEnabled,
  onAnalyticsChange,
}: {
  rights: MyDataRights;
  analyticsEnabled: boolean;
  onAnalyticsChange: (next: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scheduled = rights.erasure.scheduledFor
    ? new Date(rights.erasure.scheduledFor).toLocaleDateString(undefined, { dateStyle: "long" })
    : null;

  function requestErasure() {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/app/me/privacy/erasure-request", browserMutationInit("POST"));
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setConfirmOpen(false);
      if (!response.ok) {
        setError(userFacingError(body.error, "Could not request erasure."));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: myDataKey });
    });
  }

  function setAnalytics(next: boolean) {
    persistAnalyticsConsent(next);
    onAnalyticsChange(next);
  }

  return (
    <Panel as="section" padded={false} aria-labelledby="my-data-rights-heading">
      <div className="p-4 sm:p-5">
        <h2 id="my-data-rights-heading" className="text-lg font-semibold tracking-tight">
          Your rights
        </h2>
        <p className="mt-1.5 text-xs text-muted-foreground">Export, erase, and cookie choices for this workspace.</p>
      </div>
      <ul className="divide-y border-t">
        <Row title="Download your data" description="A complete machine-readable copy, including usage history and setting changes.">
          <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-8">
            <a href={rights.exportHref}>Download export</a>
          </Button>
        </Row>
        <Row
          title="Request erasure"
          description={
            rights.erasure.pending && scheduled
              ? `Erasure scheduled for ${scheduled}. Ask an admin if you need to cancel.`
              : `Deletes or anonymises your personal data after a ${ERASURE_GRACE_DAYS}-day grace period.`
          }
        >
          {rights.erasure.pending ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-8"
              onClick={() => setConfirmOpen(true)}
            >
              Request erasure
            </Button>
          )}
        </Row>
        <Row title="Analytics cookies" description="Optional website analytics. This does not change what your devices upload.">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            {analyticsEnabled ? "On" : "Off"}
            <Switch
              checked={analyticsEnabled}
              aria-label="Analytics cookies"
              onChange={(event) => setAnalytics(event.target.checked)}
            />
          </label>
        </Row>
      </ul>
      {error ? <p role="alert" className="border-t px-4 py-3 text-sm text-destructive sm:px-5">{error}</p> : null}
      <nav aria-label="Privacy documents" className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-3 text-xs text-muted-foreground sm:px-5">
        {rights.legalLinks.map((link) => {
          const external = link.href.startsWith("http");
          return (
            <a
              key={link.href}
              href={link.href}
              className="hover:text-foreground hover:underline"
              {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
            >
              {link.label}
            </a>
          );
        })}
      </nav>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request erasure?</DialogTitle>
            <DialogDescription>
              Your personal data will be deleted or anonymised in {ERASURE_GRACE_DAYS} days. Usage the workspace
              needs for reporting is anonymised rather than deleted, and collection from your devices stops. Ask an
              admin if you need to cancel before then.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={() => requestErasure()}>
              Schedule erasure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
