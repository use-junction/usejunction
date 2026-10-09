import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Provider = "github" | "jira" | "atlassian" | "linear";

const PROVIDERS: Provider[] = ["jira", "atlassian", "github"];

const PROVIDER_MARKS: Record<Provider, { fill: string; path: string }> = {
  jira: {
    fill: "#2684FF",
    path: "M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.758a1.001 1.001 0 0 0-1.001-1.001zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0Z",
  },
  atlassian: {
    fill: "#0052CC",
    path: "M7.12 11.084a.683.683 0 00-1.16.126L.075 22.974a.703.703 0 00.63 1.018h8.19a.678.678 0 00.63-.39c1.767-3.65.696-9.203-2.406-12.52zM11.434.386a15.515 15.515 0 00-.906 15.317l3.95 7.9a.703.703 0 00.628.388h8.19a.703.703 0 00.63-1.017L12.63.38a.664.664 0 00-1.196.006z",
  },
  linear: {
    fill: "#5E6AD2",
    path: "M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z",
  },
  github: {
    fill: "#181717",
    path: "M12 0c6.63 0 12 5.276 12 11.79-.001 5.067-3.29 9.567-8.175 11.187-.6.118-.825-.25-.825-.56 0-.398.015-1.665.015-3.242 0-1.105-.375-1.813-.81-2.181 2.67-.295 5.475-1.297 5.475-5.822 0-1.297-.465-2.344-1.23-3.169.12-.295.54-1.503-.12-3.125 0 0-1.005-.324-3.3 1.209a11.32 11.32 0 00-3-.398c-1.02 0-2.04.133-3 .398-2.295-1.518-3.3-1.209-3.3-1.209-.66 1.622-.24 2.83-.12 3.125-.765.825-1.23 1.887-1.23 3.169 0 4.51 2.79 5.527 5.46 5.822-.345.294-.66.81-.765 1.577-.69.31-2.415.81-3.495-.973-.225-.354-.9-1.223-1.845-1.209-1.005.015-.405.56.015.781.51.28 1.095 1.327 1.23 1.666.24.663 1.02 1.93 4.035 1.385 0 .988.015 1.916.015 2.196 0 .31-.225.664-.825.56C3.303 21.374-.003 16.867 0 11.791 0 5.276 5.37 0 12 0z",
  },
};

export function IntegrationProviderMark({
  provider,
  size = 14,
  className,
}: {
  provider: Provider;
  size?: number;
  className?: string;
}) {
  const mark = PROVIDER_MARKS[provider];
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      fill={mark.fill}
    >
      <path d={mark.path} />
    </svg>
  );
}

function ProviderIcon({ provider, size }: { provider: Provider; size: number }) {
  return <IntegrationProviderMark provider={provider} size={size} />;
}

export function GitHubProjectsBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-2 border border-border/80 bg-white px-2.5 py-1.5 text-sm font-semibold text-foreground shadow-sm",
        className,
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center border border-border/50 bg-white" aria-hidden>
        <IntegrationProviderMark provider="github" size={15} />
      </span>
      GitHub Projects
    </span>
  );
}

export function GitHubProjectsButtonLabel({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="flex size-5 shrink-0 items-center justify-center border border-border/50 bg-white" aria-hidden>
        <IntegrationProviderMark provider="github" size={13} />
      </span>
      {children}
    </>
  );
}

export function IntegrationProviderLogoStack({
  size = "sm",
  className,
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const box = size === "sm" ? "size-5" : "size-6";
  const iconSize = size === "sm" ? 12 : 14;

  return (
    <span className={cn("flex items-center -space-x-1", className)} aria-hidden>
      {PROVIDERS.map((provider) => (
        <span
          key={provider}
          className={cn(
            "flex shrink-0 items-center justify-center border border-background bg-white shadow-sm",
            box,
          )}
        >
          <ProviderIcon provider={provider} size={iconSize} />
        </span>
      ))}
    </span>
  );
}
