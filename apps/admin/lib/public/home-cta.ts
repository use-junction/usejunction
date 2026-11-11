import { TEAM_PRICE_PER_DEV_USD, USER_LIMIT_FREE } from "@/lib/saas-billing/entitlements";
import { siteConfig } from "@/lib/public/config";

/** One sign-up label and destination for every homepage button, so they read as the same action. */
export const HOME_SIGNUP_LABEL = "Start free";
/** Solo onboarding: connect your own machine first, invite the team later. */
export const HOME_SIGNUP_HREF = `${siteConfig.signupUrl}?from=${encodeURIComponent("/onboarding?mode=solo")}`;

/** Price reassurance shown under the hero and closing buttons. */
export const HOME_PRICE_LINE = `Free for ${USER_LIMIT_FREE} seats, then $${TEAM_PRICE_PER_DEV_USD} per active developer a month. No card.`;

/**
 * The 21.2s hero loop, rendered from video/hero-loop/hero-loop.html by video/hero-loop/render.mjs.
 * Phones get a smaller encode; the poster is the hook frame ("One feature. $6,930 in AI.").
 * Sources are listed phone first, H.264 before VP9: the browser plays the first one whose media and codec it
 * supports, so most get the smaller MP4 and browsers without H.264 still get the loop as WebM.
 */
export const HERO_VIDEO = {
  poster: "/video/hero-loop-poster.jpg",
  width: 1280,
  height: 800,
  sources: [
    { src: "/video/hero-loop-mobile.mp4", type: 'video/mp4; codecs="avc1.64001F"', media: "(max-width: 767px)" },
    { src: "/video/hero-loop.mp4", type: 'video/mp4; codecs="avc1.640020"' },
    { src: "/video/hero-loop-mobile.webm", type: 'video/webm; codecs="vp9"', media: "(max-width: 767px)" },
    { src: "/video/hero-loop.webm", type: 'video/webm; codecs="vp9"' },
  ],
} as const;
