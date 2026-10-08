import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Faded, non-interactive sample content shown where a page has nothing to show yet, so people
 * can see what will appear there. `fade` also fades it out downwards, for lists that trail off.
 */
export function Ghost({ children, fade = false, className }: { children: ReactNode; fade?: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      inert
      className={cn(
        "pointer-events-none select-none opacity-45",
        fade && "[mask-image:linear-gradient(to_bottom,black_30%,transparent)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
