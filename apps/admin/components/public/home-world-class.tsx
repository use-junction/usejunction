import { HomeProductStory } from "@/components/public/home-product-story";
import { HomeTeamProfiles } from "@/components/public/home-team-profiles";

const privacySteps = [
  {
    label: "AI coding tools",
    detail: "Cursor, Claude Code, Codex, Copilot, and local runtimes",
  },
  {
    label: "Local agent",
    detail: "Detects tools and reports usage signals you choose to enable",
  },
  {
    label: "You control the detail",
    detail: "Each login has its own usage switch",
  },
  {
    label: "Your infrastructure",
    detail: "Run the control plane on infrastructure you trust",
  },
] as const;

export function HomeWorldClass() {
  return (
    <>
      <HomeProductStory />

      <HomeTeamProfiles />

      <section className=" bg-white py-20 sm:py-24 lg:py-32">
        <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10 xl:px-12">
          <div className="mx-auto flex max-w-6xl flex-col gap-12 lg:flex-row lg:items-start lg:justify-center lg:gap-24 xl:gap-28">
            <div className="w-full max-w-md shrink-0">
              <h2 className="text-3xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl lg:text-[2.5rem]">
                Observe the stack without{" "}
                <span className="text-[#e09a5a]">watching developers</span>.
              </h2>
              <p className="mt-4 text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                Privacy first. Observability second. No keystroke surveillance, browser capture, or
                network interception. Usage collection can be turned off per login.
              </p>
              <p className="mt-8 text-xs leading-5 text-muted-foreground/80">
                Open source you can audit. Data stays on infrastructure your team controls.
              </p>
            </div>

            <ol className="flex w-full max-w-md flex-col lg:w-[22rem] lg:shrink-0 xl:w-[26rem]">
              {privacySteps.map((step, index) => (
                <li
                  key={step.label}
                  className="relative border-b border-border py-5 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-start gap-5">
                    <span className="min-w-[2.5ch] text-4xl font-semibold tabular-nums tracking-tight text-muted-foreground/35 sm:text-5xl">
                      0{index + 1}
                    </span>
                    <div>
                      <p className="text-lg font-semibold sm:text-xl">{step.label}</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.detail}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </>
  );
}
