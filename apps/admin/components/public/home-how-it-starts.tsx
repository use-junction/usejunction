import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Check, Eye, Plus } from "lucide-react";
import { HOME_H2, HOME_SECTION, Meter, MiniWindow, Muted, ResultNote, StatusDot } from "@/components/public/home-bits";
import { HOME_SIGNUP_HREF, HOME_SIGNUP_LABEL } from "@/lib/public/home-cta";
import { TEAM_PRICE_PER_DEV_USD, USER_LIMIT_FREE } from "@/lib/saas-billing/entitlements";
import { cn } from "@/lib/utils";

type Step = {
  title: string;
  muted: string;
  text: string;
  window: { title: string; rows: ReactNode[] };
  note: { icon: ReactNode; title: string; detail: string };
};

const STEPS: Step[] = [
  {
    title: "Connect.",
    muted: "One laptop.",
    text: "Sign up and connect your own machine. No card and no sales call.",
    window: {
      title: "Devices",
      rows: [
        <>
          <span className="font-semibold">
            <StatusDot />
            MacBook Pro
          </span>
          <span className="text-muted-foreground">Cursor, Claude Code</span>
        </>,
        <span className="text-[#b4b6ae]">Add another machine</span>,
      ],
    },
    note: { icon: <Check />, title: "Connected", detail: "MacBook Pro is reporting" },
  },
  {
    title: "Look.",
    muted: "Your own numbers first.",
    text: "See your own usage by tool and model. Nobody else is involved yet.",
    window: {
      title: "Your usage, last 30 days",
      rows: [
        <>
          <span className="font-semibold">Claude Code</span>
          <Meter percent={64} />
        </>,
        <>
          <span className="font-semibold">Cursor</span>
          <Meter percent={38} />
        </>,
        <>
          <span className="font-semibold">Codex</span>
          <span className="text-muted-foreground">Not used</span>
        </>,
      ],
    },
    note: { icon: <Eye />, title: "Your usage is in", detail: "3 tools found on this machine" },
  },
  {
    title: "Invite.",
    muted: "The team, when you’re ready.",
    text: "Teammates connect their own machines. Each login has its own usage switch.",
    window: {
      title: "Team",
      rows: [
        <>
          <span className="font-semibold">
            <StatusDot />
            Priya N.
          </span>
          <span className="text-muted-foreground">Reporting</span>
        </>,
        <>
          <span className="font-semibold">
            <StatusDot />
            Marco D.
          </span>
          <span className="text-muted-foreground">Reporting</span>
        </>,
        <>
          <span className="font-semibold">
            <StatusDot waiting />
            Sam O.
          </span>
          <span className="text-muted-foreground">Invited</span>
        </>,
      ],
    },
    note: { icon: <Plus />, title: "8 of 12 machines reporting", detail: "4 invites still open" },
  },
  {
    title: "Act.",
    muted: "Before the renewal.",
    text: "Drop the idle seats and move people to the plan that fits.",
    window: {
      title: "Before 3 Dec",
      rows: [
        <>
          <span className="font-semibold">Cursor Teams</span>
          <span className="text-muted-foreground">
            4 idle <span className="ml-1.5 font-semibold tabular-nums text-foreground">$120</span>
          </span>
        </>,
        <>
          <span className="font-semibold">Copilot Business</span>
          <span className="text-muted-foreground">
            3 idle <span className="ml-1.5 font-semibold tabular-nums text-foreground">$57</span>
          </span>
        </>,
        <>
          <span className="font-semibold">Claude Team</span>
          <span className="text-muted-foreground">3 Premium barely used</span>
        </>,
      ],
    },
    note: { icon: "$", title: "$177 a month in idle seats", detail: "Renews in 23 days" },
  },
];

export function HomeHowItStarts() {
  return (
    <section aria-labelledby="home-start-heading" className={HOME_SECTION}>
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        <div className="mx-auto max-w-2xl md:text-center">
          <h2 id="home-start-heading" className={HOME_H2}>
            Start with one laptop. <Muted>Add the team when you’ve seen enough.</Muted>
          </h2>
          <p className="mt-6 text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            You don’t need the whole team on day one.
          </p>
        </div>

        <ol className="mx-auto max-w-5xl">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="mt-20 grid items-center gap-8 md:mt-28 md:grid-cols-2 md:gap-24"
            >
              <div className={cn(index % 2 === 1 && "md:order-2")}>
                <span className="text-sm font-semibold tabular-nums text-primary">0{index + 1}</span>
                <h3 className="mt-3 text-[1.65rem] font-semibold leading-[1.12] tracking-[-0.03em] sm:text-[2rem]">
                  {step.title} <Muted>{step.muted}</Muted>
                </h3>
                <p className="mt-4 max-w-sm text-base leading-7 text-muted-foreground sm:text-[1.0625rem]">{step.text}</p>
              </div>
              <div className="relative pr-2 pt-7 sm:pr-7">
                <MiniWindow title={step.window.title} rows={step.window.rows} />
                <ResultNote {...step.note} className="right-0 top-0" />
              </div>
            </li>
          ))}
        </ol>

        <div className="mx-auto mt-24 flex max-w-5xl flex-col items-start gap-7 border border-border bg-[var(--public-bg)] px-6 py-8 sm:px-12 sm:py-12 md:mt-32 md:flex-row md:items-center md:justify-between md:gap-14">
          <div>
            <h3 className="text-[1.65rem] font-semibold leading-[1.12] tracking-[-0.03em] sm:text-[1.9rem]">
              Free for your first {USER_LIMIT_FREE} seats. <Muted>No card.</Muted>
            </h3>
            <p className="mt-2.5 text-[0.9375rem] text-muted-foreground">
              Then ${TEAM_PRICE_PER_DEV_USD} per active developer a month.
            </p>
          </div>
          <Link
            href={HOME_SIGNUP_HREF}
            className="public-btn public-btn-teal w-full shrink-0 rounded-none px-8 py-3 text-base font-semibold md:w-auto"
          >
            {HOME_SIGNUP_LABEL}
            <ArrowRight className="h-5 w-5" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
