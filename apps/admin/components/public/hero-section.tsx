"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Github, Pause, Play } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { siteConfig } from "@/lib/public/config";
import {
  HERO_CHAPTERS,
  HERO_VIDEO,
  HOME_PRICE_LINE,
  HOME_SIGNUP_HREF,
  HOME_SIGNUP_LABEL,
} from "@/lib/public/home-cta";

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
 * The product film with a chapter strip under it. The strip says what the film covers before it gets there, shows
 * how far along it is, jumps to a chapter on click, and carries the pause button that autoplaying motion needs.
 */
function HeroFilm({ reduceMotion }: { reduceMotion: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  // Set when the visitor pauses, so scrolling the film back into view does not restart it against their wish.
  const userPaused = useRef(false);
  const offscreen = useRef(false);
  const [blocked, setBlocked] = useState(false);
  const [paused, setPaused] = useState(reduceMotion);
  const [active, setActive] = useState(0);

  const play = useCallback(() => {
    videoRef.current?.play().catch(() => {
      // Autoplay can be refused (low-power mode, data saver); show controls so a tap starts it.
      setBlocked(true);
      setPaused(true);
    });
  }, []);

  // Fill each chapter's bar from the film's clock. Written straight to the DOM: it runs every frame.
  const paint = useCallback(() => {
    const time = videoRef.current?.currentTime ?? 0;
    let current = 0;
    HERO_CHAPTERS.forEach((chapter, index) => {
      const end = HERO_CHAPTERS[index + 1]?.start ?? HERO_VIDEO.duration;
      const done = Math.min(1, Math.max(0, (time - chapter.start) / (end - chapter.start)));
      if (time >= chapter.start) current = index;
      const fill = fills.current[index];
      if (fill) fill.style.transform = `scaleX(${done})`;
    });
    setActive(current);
  }, []);

  // Muted autoplay on repeat; people who ask for less motion get the still frame and the controls.
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.addEventListener("timeupdate", paint);
    video.addEventListener("seeked", paint);
    let frame = 0;
    const tick = () => {
      paint();
      frame = requestAnimationFrame(tick);
    };
    if (!paused) frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener("timeupdate", paint);
      video.removeEventListener("seeked", paint);
    };
  }, [paused, paint]);

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

  const jump = (index: number) => {
    const video = videoRef.current;
    const chapter = HERO_CHAPTERS[index];
    if (!video || !chapter) return;
    // With reduced motion a chapter shows as one settled frame instead of playing.
    video.currentTime = reduceMotion ? chapter.still : chapter.start;
    paint();
    if (reduceMotion) return;
    userPaused.current = false;
    setPaused(false);
    play();
  };

  return (
    <div className="hero-film">
      {/* No frame: the film is drawn on white, so it sits straight on the page. */}
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
        controls={reduceMotion || blocked}
        preload="auto"
        onPlay={() => {
          userPaused.current = false;
          setBlocked(false);
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

      <div
        role="group"
        aria-label="Video chapters"
        className="mt-1 grid grid-cols-[repeat(4,minmax(0,1fr))_auto] items-start gap-x-2 px-4 sm:gap-x-3 sm:px-0"
      >
        {HERO_CHAPTERS.map((chapter, index) => (
          <button
            key={chapter.label}
            type="button"
            onClick={() => jump(index)}
            aria-current={active === index ? "true" : undefined}
            className="group min-h-11 pb-1 pt-2.5 text-left"
          >
            <span className="block h-[3px] overflow-hidden bg-[#e4e2da]" aria-hidden>
              <span
                ref={(element) => {
                  fills.current[index] = element;
                }}
                className="block h-full origin-left bg-[var(--primary)]"
                style={{ transform: "scaleX(0)" }}
              />
            </span>
            <span
              className={`mt-2 block text-[0.8125rem] font-semibold leading-tight transition-colors group-hover:text-[var(--public-fg)] sm:text-sm ${
                active === index ? "text-[var(--public-fg)]" : "text-[#6b6d64]"
              }`}
            >
              {chapter.label}
            </span>
            <span className="mt-0.5 hidden text-[0.8125rem] leading-snug text-[#6b6d64] md:block">{chapter.detail}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={toggle}
          aria-label={paused ? "Play video" : "Pause video"}
          className="mt-1 grid size-11 place-items-center border border-[var(--public-border)] text-[var(--public-fg)] transition-colors hover:border-[var(--public-fg)] sm:size-9"
        >
          {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

export function HeroSection() {
  const reduceMotion = useReducedMotion() === true;

  return (
    <section className="hero-atmosphere relative overflow-x-clip bg-white">
      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-14 pt-24 sm:px-6 sm:pb-16 lg:px-0">
        {/* One column, read top to bottom: the claim, the action, then the film that proves it. */}
        <motion.div
          className="flex flex-col items-center text-center"
          variants={reduceMotion ? undefined : container}
          initial={reduceMotion ? false : "hidden"}
          animate="show"
        >
          <motion.h1
            variants={item}
            className="text-[2rem] font-bold leading-[1.08] tracking-[-0.03em] text-[var(--public-fg)] [text-wrap:balance] sm:text-[2.5rem] lg:text-[2.75rem]"
          >
            See where your <mark className="home-highlight whitespace-nowrap">AI coding spend</mark> goes.
          </motion.h1>

          <motion.div
            variants={item}
            className="mt-6 flex w-full flex-col items-stretch gap-4 sm:w-auto sm:flex-row sm:items-center sm:gap-6"
          >
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
              className="inline-flex items-center gap-2 self-center border-b border-current pb-px text-[0.9375rem] font-semibold text-[var(--public-fg)] transition-colors hover:text-[var(--public-accent)]"
            >
              <Github className="size-4" aria-hidden />
              Self-host from GitHub
            </a>
          </motion.div>

          <motion.p variants={item} className="mt-3 text-sm text-[#5c5e56]">
            {HOME_PRICE_LINE}
          </motion.p>
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
          className="mt-8"
        >
          <HeroFilm reduceMotion={reduceMotion} />
        </motion.div>
      </div>
    </section>
  );
}
