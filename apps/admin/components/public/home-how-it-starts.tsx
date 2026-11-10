import { USER_LIMIT_FREE } from "@/lib/saas-billing/entitlements";
import { getSiteUrl } from "@/lib/public/site-url";

const steps = [
  {
    title: "Sign up",
    detail: `No card and no sales call. The first ${USER_LIMIT_FREE} seats are free.`,
  },
  {
    title: "Run one command on your own machine",
    detail: "Your own usage shows up first. Nobody else is involved yet.",
  },
  {
    title: "Invite the team when you’ve seen enough",
    detail: "Idle seats and plan pressure fill in as their machines report.",
  },
] as const;

export function HomeHowItStarts() {
  const base = getSiteUrl();
  const command = `curl -fsSL ${base}/install.sh | sh -s -- --token <your-token> --url ${base}`;

  return (
    <section aria-labelledby="home-start-heading" className="bg-white py-16 sm:py-20 lg:py-24">
      <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-24 lg:px-0 xl:grid-cols-[26rem_minmax(0,1fr)]">
        <div className="min-w-0">
          <h2
            id="home-start-heading"
            className="text-3xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl lg:text-[2.5rem]"
          >
            Start with one laptop.
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            You don’t need the whole team on day one. Connect your own machine, look at your own numbers, then
            decide.
          </p>
          <figure className="mt-8 border border-border bg-[var(--public-bg)]">
            <figcaption className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
              After sign-up you get a command like this, with your token in it
            </figcaption>
            <pre className="overflow-x-auto px-4 py-4 font-mono text-xs leading-6 whitespace-pre-wrap break-all text-foreground">
              <code>{command}</code>
            </pre>
          </figure>
        </div>

        <ol className="flex min-w-0 flex-col">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="grid grid-cols-[4rem_minmax(0,1fr)] border-b border-border py-6 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[5.5rem_minmax(0,1fr)]"
            >
              <span
                aria-hidden
                className="text-4xl font-semibold leading-none tabular-nums tracking-tight text-muted-foreground/35 sm:text-5xl"
              >
                0{index + 1}
              </span>
              <div>
                <h3 className="text-lg font-semibold leading-snug tracking-[-0.01em] sm:text-xl">{step.title}</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                  {step.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
