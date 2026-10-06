"use client";

import { useMemo, useState } from "react";
import {
  DEPLOYMENT_REGIONS,
  deploymentRegion,
  regionSwitchUrl,
  type DeploymentRegion,
} from "@/lib/region";

const LABELS: Record<DeploymentRegion, string> = {
  us: "United States",
  eu: "European Union",
};

export function RegionPicker() {
  const current = useMemo(() => deploymentRegion(), []);
  const [selected, setSelected] = useState<DeploymentRegion>(current);

  function choose(region: DeploymentRegion) {
    setSelected(region);
    if (typeof window === "undefined") return;
    const next = regionSwitchUrl(region, window.location.href);
    if (next) window.location.assign(next);
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Data region</legend>
      <p className="text-xs leading-5 text-muted-foreground">
        Workspaces stay in the region you pick. EU hosts at eu.usejunction.dev with Signals work
        extraction off.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {DEPLOYMENT_REGIONS.map((region) => (
          <label
            key={region}
            className="flex cursor-pointer items-center gap-2 border border-input px-3 py-2 text-sm"
          >
            <input
              type="radio"
              name="data-region"
              value={region}
              checked={selected === region}
              onChange={() => choose(region)}
            />
            {LABELS[region]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
