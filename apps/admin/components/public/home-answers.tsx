import Image from "next/image";
import Link from "next/link";

/** Each row pairs a question with a real crop from the example team's screens. */
const ANSWERS = [
  {
    term: "Quiet seats",
    line: "Barely touched this cycle.",
    image: { src: "/home/crop-quiet.png", width: 835, height: 129, display: 380, alt: "A weekly limit at 6%, marked Quiet seat" },
    link: { href: "/guides/see-plan-usage-and-waste", label: "Seat waste" },
  },
  {
    term: "Outside company plans",
    line: "Personal logins the company can’t see.",
    image: { src: "/home/crop-seven.png", width: 698, height: 237, display: 300, alt: "Outside company plans: 7 personal logins with no company seat" },
    link: { href: "/guides/personal-vs-company-api-keys", label: "Personal logins" },
  },
  {
    term: "Active machines",
    line: "Who has connected, and who hasn’t.",
    image: { src: "/home/crop-machines.png", width: 563, height: 321, display: 250, alt: "Active machines: 3 of 4" },
    link: { href: "/guides/see-team-ai-coding-usage", label: "Team usage" },
  },
  {
    term: "Usage at API prices",
    line: "What the same usage would cost pay-per-use.",
    image: { src: "/home/crop-api.png", width: 558, height: 308, display: 250, alt: "Usage at API prices: $6,466.70, 18 times what you pay, not a bill" },
    link: { href: "/solutions/ai-coding-spend-management", label: "Spend" },
  },
] as const;

export function HomeAnswers() {
  return (
    <section aria-labelledby="home-answers-heading" className="bg-white pt-24 sm:pt-32 lg:pt-44">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        <h2 id="home-answers-heading" className="text-[1.6rem] font-semibold leading-tight tracking-[-0.025em] sm:text-[1.95rem]">
          It also answers these.
        </h2>
        <dl className="mt-10 border-t-2 !border-foreground lg:mt-14">
          {ANSWERS.map((answer) => (
            <div
              key={answer.term}
              className="grid gap-4 border-b border-border py-6 md:grid-cols-[17rem_minmax(0,1fr)_auto] md:items-center md:gap-12"
            >
              <div>
                <dt className="text-[1.25rem] font-semibold tracking-[-0.015em]">{answer.term}</dt>
                <dd className="mt-1.5 text-[0.9375rem] text-muted-foreground">{answer.line}</dd>
              </div>
              <Image
                src={answer.image.src}
                alt={answer.image.alt}
                width={answer.image.width}
                height={answer.image.height}
                sizes={`${answer.image.display}px`}
                className="h-auto max-w-full border border-border"
                style={{ width: answer.image.display }}
              />
              <Link
                href={answer.link.href}
                className="justify-self-start border-b !border-current pb-px text-sm font-semibold transition-colors hover:text-primary"
              >
                {answer.link.label}
              </Link>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
