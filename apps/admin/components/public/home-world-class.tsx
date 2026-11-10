import { Check, X } from "lucide-react";
import { HomeHowItStarts } from "@/components/public/home-how-it-starts";
import { HomeProductStory } from "@/components/public/home-product-story";
import { siteConfig } from "@/lib/public/config";

/** Mirrors "What UseJunction measures" / "What it does not measure" in llms.txt. */
const collected = [
  "Which tools and models are used",
  "Tokens and estimated cost, by person, tool and model",
  "Plan cycle and seat usage",
  "Whether a personal or a company API key was used",
  "Device and agent health",
] as const;

const neverCollected = [
  "Keystrokes or screenshots",
  "Browser activity",
  "Network traffic",
  "Hours spent in the editor",
] as const;

export function HomeWorldClass() {
  return (
    <>
      <HomeProductStory />

      <HomeHowItStarts />

      <section aria-labelledby="home-privacy-heading" className="bg-white pt-28 sm:pt-32 lg:pt-44">
        <div className="mx-auto grid w-full max-w-6xl gap-14 px-4 sm:px-6 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-28 lg:px-0 xl:grid-cols-[26rem_minmax(0,1fr)]">
          <div className="min-w-0">
            <h2
              id="home-privacy-heading"
              className="text-3xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl lg:text-[2.5rem]"
            >
              Observe the stack without watching developers.
            </h2>
            <p className="mt-6 text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              The agent reads usage from the tools themselves. It doesn’t sit between a developer and their work.
            </p>
            <a
              href={siteConfig.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-block border-b border-current pb-px text-sm font-semibold transition-colors hover:text-primary"
            >
              Read the code on GitHub
            </a>
          </div>

          <div className="min-w-0">
            <div className="grid gap-12 sm:grid-cols-2 sm:gap-16">
              <div>
                <h3 className="border-b border-foreground pb-4 text-base font-semibold sm:text-lg">Collected</h3>
                <ul>
                  {collected.map((entry) => (
                    <li key={entry} className="flex gap-3 border-b border-border py-4 text-sm leading-6 sm:text-base">
                      <Check className="mt-1 size-4 shrink-0 text-primary" strokeWidth={2.25} aria-hidden />
                      {entry}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="border-b border-foreground pb-4 text-base font-semibold sm:text-lg">Never collected</h3>
                <ul>
                  {neverCollected.map((entry) => (
                    <li key={entry} className="flex gap-3 border-b border-border py-4 text-sm leading-6 sm:text-base">
                      <X className="mt-1 size-4 shrink-0 text-muted-foreground" strokeWidth={2.25} aria-hidden />
                      {entry}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-8 text-sm leading-6 text-[#5c5e56]">
              <span className="font-semibold text-foreground">Optional:</span> work-session detail, such as asks and
              change summaries. Each login has its own switch for it.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
