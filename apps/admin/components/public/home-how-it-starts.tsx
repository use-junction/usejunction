import { BarChart3, GitPullRequest, Laptop, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS: { icon: LucideIcon; title: string; line: string; phase?: string }[] = [
  { icon: Laptop, title: "Connect your laptop", line: "One command. No card.", phase: "Just you" },
  { icon: BarChart3, title: "Look at your own usage", line: "Just yours, at first." },
  { icon: Users, title: "Invite the team", line: "Everyone has their own switch.", phase: "Your team" },
  { icon: GitPullRequest, title: "Connect GitHub", line: "See where the spend landed." },
];

export function HomeHowItStarts() {
  return (
    <section aria-labelledby="home-start-heading" className="bg-white pt-24 sm:pt-32 lg:pt-44">
      <div className="mx-auto w-full max-w-[75rem] px-4 sm:px-6">
        <h2
          id="home-start-heading"
          className="max-w-md text-[1.6rem] font-medium leading-tight tracking-[-0.02em] text-[#3a3b37] sm:text-[1.95rem]"
        >
          Try it on your own laptop before you tell the team.
        </h2>

        <ol className="mt-8 grid md:mt-14 md:grid-cols-4">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className={cn(
                "relative px-5 pb-7 pt-5 md:px-7 md:pb-9",
                index < 2 ? "bg-brand-yellow-pale" : "bg-[#e6f3f5]",
              )}
            >
              <span aria-hidden className="absolute inset-x-0 top-[78px] hidden h-0.5 bg-foreground md:block" />
              <p className="h-[22px] text-[0.8125rem] font-semibold">{step.phase ?? ""}</p>
              <span className="relative mt-3.5 flex size-10 items-center justify-center border-2 !border-foreground bg-brand-yellow text-lg font-bold">
                {index + 1}
              </span>
              <step.icon className="mt-6 size-[30px] text-primary" strokeWidth={1.7} aria-hidden />
              <h3 className="mt-3.5 text-[1.2rem] font-semibold leading-snug tracking-[-0.015em]">{step.title}</h3>
              <p className="mt-2 text-[0.9375rem] text-[#3a3b37]">{step.line}</p>
            </li>
          ))}
        </ol>

      </div>
    </section>
  );
}
