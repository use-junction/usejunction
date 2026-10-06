"use client";

import type { WorkSpendPayload } from "@/components/features/work-spend-types";

export function WorkSpendSetupStrip({
  data,
  onAuthors,
  onConnections,
}: {
  data: WorkSpendPayload;
  onAuthors: () => void;
  onConnections: () => void;
}) {
  const unmatched = data.attention.unmappedAuthors.length;
  const failed = data.repositories.filter((repo) => repo.lastError || ["error", "failed"].includes(repo.syncStatus)).length;
  if (!unmatched && !failed && !["permission_required", "partial"].includes(data.connection.state)) return null;
  const parts: Array<{ text: string; action: string; onClick: () => void }> = [];
  if (unmatched) parts.push({ text: `${unmatched} GitHub ${unmatched === 1 ? "author" : "authors"} unmatched`, action: "Match authors", onClick: onAuthors });
  if (failed) parts.push({ text: `${failed} ${failed === 1 ? "repository" : "repositories"} failed to sync`, action: "Review", onClick: onConnections });
  else if (["permission_required", "partial"].includes(data.connection.state)) parts.push({ text: "GitHub connection needs attention", action: "Review", onClick: onConnections });
  return (
    <aside className="mt-10 space-y-2">
      {parts.map((part) => (
        <div key={part.text} className="flex flex-wrap items-center justify-between gap-2 border bg-card px-4 py-3 text-sm">
          <p>
            <span className="mr-2 inline-block size-2 align-middle bg-brand-orange" aria-hidden />
            {part.text}
          </p>
          <button type="button" onClick={part.onClick} className="font-medium text-primary underline-offset-4 hover:underline">{part.action} →</button>
        </div>
      ))}
    </aside>
  );
}
