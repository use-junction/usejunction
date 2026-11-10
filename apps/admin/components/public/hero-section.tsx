"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { siteConfig } from "@/lib/public/config";
import { HERO_VIDEO, HOME_PRICE_LINE, HOME_SIGNUP_HREF, HOME_SIGNUP_LABEL } from "@/lib/public/home-cta";

const EASE = [0.22, 1, 0.36, 1] as const;

const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

const item = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: EASE },
  },
};

function HeroVideo({ reduceMotion }: { reduceMotion: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);

  // Muted autoplay only; people who ask for less motion get the still frame and the controls.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (reduceMotion) {
      video.pause();
      return;
    }
    video.play().catch(() => {
      // Autoplay can be refused (low-power mode); the poster stays up.
    });
  }, [reduceMotion]);

  return (
    <div className="overflow-hidden border border-[var(--public-border)] bg-[#111210]">
      <video
        ref={ref}
        className="block aspect-video h-auto w-full"
        poster={HERO_VIDEO.poster}
        muted
        loop
        playsInline
        autoPlay={!reduceMotion}
        controls={reduceMotion}
        preload="metadata"
        aria-label="UseJunction product video: usage, cost and models across every AI coding tool, then one developer's detail"
      >
        <source src={HERO_VIDEO.webm} type="video/webm" />
        <source src={HERO_VIDEO.mp4} type="video/mp4" />
      </video>
    </div>
  );
}

export function HeroSection() {
  const reduceMotion = useReducedMotion() === true;

  return (
    <section className="hero-atmosphere relative overflow-x-clip bg-white">
      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        <div className="grid w-full grid-cols-1 items-center gap-10 pb-20 pt-24 md:gap-12 md:pt-28 lg:min-h-[74svh] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16 lg:pb-28 lg:pt-28">
          <motion.div
            className="relative isolate flex min-w-0 flex-col items-start text-left"
            variants={reduceMotion ? undefined : container}
            initial={reduceMotion ? false : "hidden"}
            animate="show"
          >
            <motion.p variants={item} className="text-sm font-medium text-[#1688a1] sm:text-[0.9375rem]">
              For engineering and platform teams
            </motion.p>

            <motion.h1
              variants={item}
              className="mt-4 text-[2rem] font-bold leading-[1.05] tracking-[-0.03em] text-[var(--public-fg)] sm:text-5xl lg:text-[2.85rem] xl:text-[3.1rem]"
            >
              See who actually uses{" "}
              <span className="block font-semibold text-[#08a8c4] [text-wrap:balance]">
                the AI coding seats you pay for.
              </span>
            </motion.h1>

            <motion.p
              variants={item}
              className="mt-5 max-w-lg text-base leading-relaxed text-[#6b6d66] sm:text-lg sm:leading-8"
            >
              Per-person usage and plan limits across Claude, Cursor, Codex and Copilot. Find idle seats and
              wrong plans before you renew.
            </motion.p>

            <motion.div variants={item} className="mt-8 flex w-full flex-col items-start">
              <div className="flex w-full flex-col items-stretch gap-4 sm:w-auto sm:flex-row sm:items-center sm:gap-6">
                <Link
                  href={HOME_SIGNUP_HREF}
                  className="public-btn public-btn-teal rounded-none px-8 py-3 text-base font-semibold"
                >
                  {HOME_SIGNUP_LABEL}
                  <ArrowRight className="h-5 w-5" aria-hidden />
                </Link>
                <a
                  href={siteConfig.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="self-start border-b border-current pb-px text-[0.9375rem] font-semibold text-[var(--public-fg)] transition-colors hover:text-[var(--public-accent)] sm:self-auto"
                >
                  Self-host from GitHub
                </a>
              </div>
              <p className="mt-4 text-sm text-[#5c5e56]">{HOME_PRICE_LINE}</p>
            </motion.div>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
            className="relative w-full min-w-0"
          >
            <HeroVideo reduceMotion={reduceMotion} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
