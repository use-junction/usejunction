"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  const [blocked, setBlocked] = useState(false);

  // Muted autoplay on repeat; people who ask for less motion get the still frame and the controls.
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (reduceMotion) {
      video.pause();
      return;
    }
    const play = () =>
      video.play().catch(() => {
        // Autoplay can be refused (low-power mode, data saver); show controls so a tap starts it.
        setBlocked(true);
      });
    play();

    // Pause while scrolled out of view so phones do not decode a loop nobody sees.
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) play();
      else video.pause();
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, [reduceMotion]);

  return (
    // No frame: the film is drawn on white, so it sits straight on the page. Edge to edge on phones, where every
    // pixel of width makes the board text easier to read.
    <div className="-mx-4 sm:mx-0">
      <video
        ref={ref}
        className="hero-video-edge block aspect-[8/5] h-auto w-full bg-white"
        width={HERO_VIDEO.width}
        height={HERO_VIDEO.height}
        poster={HERO_VIDEO.poster}
        muted
        loop
        playsInline
        autoPlay={!reduceMotion}
        controls={reduceMotion || blocked}
        preload="auto"
        onPlaying={() => setBlocked(false)}
        aria-label="UseJunction product video: what one feature cost in AI and an estimate for the next, the month's forecast, who is near a limit, and what is never collected"
      >
        {HERO_VIDEO.sources.map((source) => (
          <source key={source.src} src={source.src} type={source.type} media={"media" in source ? source.media : undefined} />
        ))}
      </video>
    </div>
  );
}

export function HeroSection() {
  const reduceMotion = useReducedMotion() === true;

  return (
    <section className="hero-atmosphere relative overflow-x-clip bg-white">
      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        <div className="grid w-full grid-cols-1 items-center gap-10 pb-20 pt-24 md:gap-12 md:pt-28 lg:min-h-[74svh] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-12 lg:pb-28 lg:pt-28">
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
              className="mt-4 text-[2rem] font-bold leading-[1.06] tracking-[-0.03em] text-[var(--public-fg)] [text-wrap:balance] sm:text-[2.75rem] lg:text-[2.25rem] xl:text-[2.5rem]"
            >
              See who{" "}
              <mark className="home-highlight whitespace-nowrap">actually uses</mark> the AI coding seats you pay for.
            </motion.h1>

            <motion.p
              variants={item}
              className="mt-5 max-w-lg text-[0.9375rem] leading-relaxed text-[#3a3b37] sm:text-base sm:leading-7"
            >
              Claude, Cursor, Codex and Copilot each show only their own seats. UseJunction shows every person across
              all of them: who uses AI day by day, who is near a limit, and where the spend landed in GitHub.
            </motion.p>

            <motion.div variants={item} className="mt-7 flex w-full flex-col items-start">
              <div className="flex w-full flex-col items-stretch gap-4 sm:w-auto sm:flex-row sm:items-center sm:gap-6">
                <Link
                  href={HOME_SIGNUP_HREF}
                  className="public-btn public-btn-teal rounded-none px-7 py-2.5 text-[0.9375rem] font-semibold"
                >
                  {HOME_SIGNUP_LABEL}
                  <ArrowRight className="h-4 w-4" aria-hidden />
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
