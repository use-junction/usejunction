"use client";

import dynamic from "next/dynamic";
import { useMemberClientData } from "@/components/developers/member-client-layout";

const AiCodingPanel = dynamic(() => import("@/components/dashboard/ai-coding-panel").then((mod) => mod.AiCodingPanel), { ssr: false });

export default function MemberCodingClientScreen() {
  const { personal, selectedPeriodLabel } = useMemberClientData();

  return (
    <section>
      <div className="mb-6">
        <h2 className="text-lg font-semibold tracking-tight">AI coding.</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Acceptance, commits, tokens, and every model for {selectedPeriodLabel}. Prompt text is
          never collected.
        </p>
      </div>

      <AiCodingPanel
        metrics={personal.aiCoding30d}
        models={personal.modelUsage30d}
        embedded
      />
    </section>
  );
}
