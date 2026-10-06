import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { siteConfig } from "@/lib/public/config";

export function HomeTeamProfiles() {
  return (
    <section className="bg-white py-20 sm:py-24 lg:py-32">
      <div className="mx-auto grid w-full max-w-[1440px] gap-12 px-4 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-16 lg:px-10 xl:px-12">
        <div className="min-w-0">
          <Image
            src="/elements/signals.png"
            alt="Signals dashboard — work sessions, tools, and recent work"
            width={1600}
            height={1000}
            className="h-auto w-full rounded-2xl"
            sizes="(max-width: 1024px) 100vw, 55vw"
            priority
          />
        </div>

        <div className="flex max-w-md flex-col lg:justify-self-end">
          <p className="font-display text-sm font-medium tracking-[0.02em] text-muted-foreground sm:text-[0.9375rem]">
            Privacy first. Observability second.
          </p>
          <h2 className="mt-3 text-3xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl lg:text-[2.5rem]">
            The whole company gets smarter, together.
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Surface what works, validate it with your experts, and turn it into playbooks the whole team can use.
          </p>
          <Link
            href={siteConfig.signupUrl}
            className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-primary"
          >
            See how great work spreads
            <ArrowRight className="size-4" />
          </Link>
          <p className="mt-4 text-xs leading-5 text-muted-foreground/80">
            Usage collection can be turned off per login.
          </p>
        </div>
      </div>
    </section>
  );
}
