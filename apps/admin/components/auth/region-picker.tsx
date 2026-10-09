"use client";

import { useMemo, useState } from "react";
import {
  DEPLOYMENT_REGIONS,
  deploymentRegion,
  regionSwitchUrl,
  type DeploymentRegion,
} from "@/lib/region";

const LABELS: Record<DeploymentRegion, string> = {
  us: "US",
  eu: "EU",
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
    <fieldset className="flex items-center justify-between gap-3">
      <legend className="float-left text-xs font-medium text-muted-foreground">Data region</legend>
      <div className="inline-flex border border-input text-xs">
        {DEPLOYMENT_REGIONS.map((region) => (
          <label
            key={region}
            className="cursor-pointer px-2.5 py-1 text-muted-foreground has-[:checked]:bg-foreground has-[:checked]:text-background has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
          >
            <input
              type="radio"
              name="data-region"
              value={region}
              checked={selected === region}
              onChange={() => choose(region)}
              className="sr-only"
            />
            {LABELS[region]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
