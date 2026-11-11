"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Github, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * The product film beside the headline. It is drawn on white with no frame, captions or controls, so it reads as
 * the product moving, not as a video player. The pause button that autoplaying motion needs stays out of sight
 * until the pointer or keyboard reaches the film, and stays up whenever the film is paused.
 */
function HeroFilm({ reduceMotion }: { reduceMotion: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Set when the visitor pauses, so scrolling the film back into view does not restart it against their wish.
  const userPaused = useRef(false);
  const offscreen = useRef(false);
  const [paused, setPaused] = useState(reduceMotion);

  const play = useCallback(() => {
    videoRef.current?.play().catch(() => {
      // Autoplay can be refused (low-power mode, data saver); the play button stays up so a tap starts it.
      setPaused(true);
    });
  }, []);

  // Muted autoplay on repeat; people who ask for less motion get the still frame and the play button.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (reduceMotion) {
      video.pause();
      return;
    }
    play();

    // Pause while scrolled out of view so phones do not decode a loop nobody sees.
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      offscreen.current = !entry?.isIntersecting;
      if (offscreen.current) video.pause();
      else if (!userPaused.current) play();
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, [reduceMotion, play]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) {
      userPaused.current = false;
      setPaused(false);
      play();
    } else {
      userPaused.current = true;
      setPaused(true);
      video.pause();
    }
  };

  return (
    // Edge to edge on phones, where every pixel of width makes the board text easier to read.
    <div className="group relative -mx-4 sm:mx-0">
      <video
        ref={videoRef}
        className="hero-video-edge block aspect-[8/5] h-auto w-full bg-white"
        width={HERO_VIDEO.width}
        height={HERO_VIDEO.height}
        poster={HERO_VIDEO.poster}
        muted
        loop
        playsInline
        autoPlay={!reduceMotion}
        preload="auto"
        // On a touch screen there is no hover to reveal the button, so a tap on the film pauses it.
        onClick={toggle}
        onPlay={() => {
          userPaused.current = false;
          setPaused(false);
        }}
        onPause={() => {
          // Pausing because the film left the screen is not the visitor's choice; anything else is.
          if (!offscreen.current) userPaused.current = true;
          setPaused(true);
        }}
        aria-label="UseJunction product video: what one feature cost in AI and an estimate for the next, the month's forecast, who is near a limit, and what is never collected"
      >
        {HERO_VIDEO.sources.map((source) => (
          <source key={source.src} src={source.src} type={source.type} media={"media" in source ? source.media : undefined} />
        ))}
      </video>
      <button
        type="button"
        onClick={toggle}
        aria-label={paused ? "Play video" : "Pause video"}
        className={`absolute right-4 top-3 grid size-11 place-items-center border border-[var(--public-border)] bg-white text-[var(--public-fg)] transition-opacity duration-200 hover:border-[var(--public-fg)] focus-visible:opacity-100 group-hover:opacity-100 sm:right-3 sm:size-9 ${
          paused ? "opacity-100" : "opacity-0"
        }`}
      >
        {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

export function HeroSection() {
  const reduceMotion = useReducedMotion() === true;
  const group = reduceMotion ? undefined : container;

  return (
    <section className="hero-atmosphere relative overflow-x-clip bg-white">
      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        {/* The headline is the only headline-sized type; the film shows the product at its own scale.
            Phones read top to bottom: headline, one line of detail, the film, then the actions. From lg up the
            text and actions share the left column and the film takes the right. */}
        <motion.div
          className="grid w-full grid-cols-1 content-center gap-y-4 pb-14 pt-24 sm:gap-y-8 md:pt-28 lg:min-h-[70svh] lg:grid-cols-2 lg:gap-x-12 lg:gap-y-7 lg:pb-24"
          variants={group}
          initial={reduceMotion ? false : "hidden"}
          animate="show"
        >
          <motion.div variants={group} className="min-w-0 lg:col-start-1 lg:row-start-1 lg:self-end">
            <motion.h1
              variants={item}
              className="text-[2.125rem] font-semibold leading-[1.06] tracking-[-0.035em] text-[var(--public-fg)] [text-wrap:balance] sm:text-5xl lg:text-[2.75rem] xl:text-[3.25rem]"
            >
              See where your <mark className="home-highlight whitespace-nowrap">AI coding spend</mark> goes.
            </motion.h1>

            <motion.p variants={item} className="mt-4 max-w-md text-base leading-relaxed text-[#3a3b37] sm:text-lg lg:mt-5">
              What each feature costs, where the month will land, and who is near a limit.
            </motion.p>
          </motion.div>

          <motion.div variants={item} className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
            <HeroFilm reduceMotion={reduceMotion} />
          </motion.div>

          <motion.div variants={group} className="min-w-0 lg:col-start-1 lg:row-start-2 lg:self-start">
            <motion.div
              variants={item}
              className="flex w-full flex-col items-stretch gap-5 sm:w-auto sm:flex-row sm:items-center sm:gap-6"
            >
              <Link
                href={HOME_SIGNUP_HREF}
                className="public-btn public-btn-teal rounded-none px-7 py-3 text-base font-semibold"
              >
                {HOME_SIGNUP_LABEL}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <a
                href={siteConfig.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 self-center border-b border-current pb-px text-[0.9375rem] font-semibold text-[var(--public-fg)] transition-colors hover:text-[var(--public-accent)] sm:self-auto"
              >
                <Github className="size-4" aria-hidden />
                Self-host from GitHub
              </a>
            </motion.div>

            <motion.p variants={item} className="mt-5 text-center text-sm text-[#5c5e56] sm:mt-4 sm:text-left">
              {HOME_PRICE_LINE}
            </motion.p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
