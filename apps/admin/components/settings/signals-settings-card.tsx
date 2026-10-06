"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AccelerateOrgAgentRolloutResult } from "@/lib/agent-updates/service";
import type { EffectiveSignalsPolicy } from "@/lib/signals/service";
import { Panel } from "@/components/panel";
import { SignalsMark } from "@/components/signals/signals-mark";
import { cn } from "@/lib/utils";
import { userFacingError } from "@/lib/errors/user-facing";
import { signalsAllowed } from "@/lib/region";

export function SignalsSettingsCard({
  initialPolicy,
}: {
  initialPolicy: EffectiveSignalsPolicy;
}) {
  const [policy, setPolicy] = useState(initialPolicy);
  const [rolloutNote, setRolloutNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workConfirmOpen, setWorkConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function rolloutMessage(result: AccelerateOrgAgentRolloutResult | null | undefined) {
    if (!result) return null;
    if (result.reason === "no_active_release") {
      return "No active agent release yet. Promote an agent release that includes work extraction, then enrolled devices can update.";
    }
    if (result.reason === "none_pending") {
      return result.targetVersion
        ? `No pending agent updates for this workspace (target ${result.targetVersion}). Compatible devices will start extracting on their next sync.`
        : "No pending agent updates for this workspace.";
    }
    return `Accelerated ${result.accelerated} enrolled device${result.accelerated === 1 ? "" : "s"} onto agent ${result.targetVersion}. After updating, they will collect only work observed since Signals was enabled.`;
  }

  function save(patch: { workExtractionEnabled?: boolean }) {
    setError(null);
    setRolloutNote(null);
    startTransition(async () => {
      const response = await fetch("/api/signals/policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        policy?: EffectiveSignalsPolicy;
        agentRollout?: AccelerateOrgAgentRolloutResult | null;
      };
      if (!response.ok || !body.policy) {
        setError(userFacingError(body.error, "Could not update Signals"));
        return;
      }
      setPolicy(body.policy);
      const note = rolloutMessage(body.agentRollout);
      if (note) setRolloutNote(note);
      setWorkConfirmOpen(false);
    });
  }

  return (
    <>
      <Panel as="section" className="sm:p-6">
        <div className="mb-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <SignalsMark className="size-5" />
            Signals
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {signalsAllowed()
              ? "Structured work from local AI coding tools (Cursor, Claude, Codex). Fine-tune retention and exclusions under "
              : "Not available in the EU hosted region. Usage, cost, seats, and device health remain available. Fine-tune unrelated retention under "}
            <Link href="/signals/settings" className="underline underline-offset-2 hover:text-foreground">
              Signals boundaries
              <ArrowUpRight className="ml-0.5 inline size-3.5 align-text-top" />
            </Link>
            .
          </p>
        </div>

        {error ? (
          <Alert variant="destructive" className="mb-4 rounded-none">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {rolloutNote ? (
          <Alert className="mb-4 rounded-none">
            <AlertDescription>{rolloutNote}</AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-base font-semibold tracking-tight">Work extraction</h3>
              <Badge
                variant="outline"
                className={cn(
                  "rounded-none text-[0.65rem] uppercase tracking-[0.08em]",
                  policy.workExtractionEnabled
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                {policy.workExtractionEnabled ? "On" : "Off"}
              </Badge>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Agents upload structured work from local AI tools: asks, clipped change summaries when
              available, models, modes, tools, and file touches. Raw prompts, full chat transcripts,
              and file contents stay on the device. Turning this on accelerates agent updates for
              your workspace. Existing local history is not imported; devices may upload work they
              observe after this enablement boundary on a future heartbeat.
            </p>
          </div>
          <div className="shrink-0">
            {policy.workExtractionEnabled ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-none gap-2"
                disabled={pending || !signalsAllowed()}
                onClick={() => save({ workExtractionEnabled: false })}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Turn off
              </Button>
            ) : (
              <Button
                type="button"
                className="rounded-none"
                disabled={pending || !signalsAllowed()}
                onClick={() => setWorkConfirmOpen(true)}
              >
                {signalsAllowed() ? "Turn on" : "Not available in EU region"}
              </Button>
            )}
          </div>
        </div>
      </Panel>

      <Dialog open={workConfirmOpen} onOpenChange={setWorkConfirmOpen}>
        <DialogContent className="rounded-none">
          <DialogHeader>
            <DialogTitle>Turn on Signals work extraction?</DialogTitle>
            <DialogDescription>
              Enrolled UseJunction agents will be accelerated onto the latest agent release so they
              can collect structured coding-tool work (asks, change summaries, models, modes, tools,
              file touches) from this point forward. Existing local history is not imported. Prompts,
              full chat transcripts, and file contents stay on the device.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="rounded-none"
              disabled={pending}
              onClick={() => setWorkConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-none gap-2"
              disabled={pending}
              onClick={() => save({ workExtractionEnabled: true })}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Turn on and update agents
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
