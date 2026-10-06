"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { browserMutationInit } from "@/lib/api/client";
import { myDataKey } from "@/lib/app-pages/query-keys";
import { userFacingError } from "@/lib/errors/user-facing";
import type { CollectionNoticeCopy } from "@/lib/privacy/collection-notice";

export function MyDataNoticeBanner({
  notice,
  acknowledged,
  acknowledgedAt,
}: {
  notice: CollectionNoticeCopy;
  acknowledged: boolean;
  acknowledgedAt: string | null;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function acknowledge() {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/me/collection-notice", browserMutationInit("POST", { accept: true }));
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(userFacingError(body.error, "Could not save that you read this notice."));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: myDataKey });
    });
  }

  if (acknowledged) {
    return (
      <p className="text-xs text-muted-foreground">
        Collection notice read
        {acknowledgedAt ? ` on ${new Date(acknowledgedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}` : ""}.
        This records that the notice was shown, not that you consented to monitoring.
      </p>
    );
  }

  return (
    <section aria-labelledby="collection-notice-heading" className="border-l-2 border-primary bg-muted/40 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="collection-notice-heading" className="text-sm font-medium">
            Please review the collection notice
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            It explains what your devices upload. Marking it read is for transparency, not consent to workplace monitoring.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setExpanded((open) => !open)}>
            {expanded ? "Hide notice" : "Read full notice"}
          </Button>
          <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => acknowledge()}>
            I have read this
          </Button>
        </div>
      </div>
      {expanded ? (
        <div className="mt-3 space-y-2 border-t pt-3 text-sm text-muted-foreground">
          <p>{notice.summary}</p>
          <p className="font-medium text-foreground">Collected</p>
          <ul className="list-disc space-y-1 pl-5">
            {notice.collects.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="font-medium text-foreground">Never collected</p>
          <ul className="list-disc space-y-1 pl-5">
            {notice.neverCollects.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>{notice.whoSees}</p>
          <p>{notice.retention}</p>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
