import { TEAM_PRICE_PER_DEV_USD, USER_LIMIT_FREE } from "@/lib/saas-billing/entitlements";
import { siteConfig } from "@/lib/public/config";

/** One sign-up label and destination for every homepage button, so they read as the same action. */
export const HOME_SIGNUP_LABEL = "Start free";
/** Solo onboarding: connect your own machine first, invite the team later. */
export const HOME_SIGNUP_HREF = `${siteConfig.signupUrl}?from=${encodeURIComponent("/onboarding?mode=solo")}`;

/** Price reassurance shown under the hero and closing buttons. */
export const HOME_PRICE_LINE = `Free for ${USER_LIMIT_FREE} seats. Then $${TEAM_PRICE_PER_DEV_USD} per active developer a month. No card.`;

/** First 16s of the launch video (video/renders), muted. The end card is cut because it shows the wrong domain. */
export const HERO_VIDEO = {
  poster: "/video/hero-poster.jpg",
  webm: "/video/hero.webm",
  mp4: "/video/hero.mp4",
} as const;
