// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const motion = vi.hoisted(() => ({ reduce: false }));

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>();
  return { ...actual, useReducedMotion: () => motion.reduce };
});

import { HeroSection } from "../../components/public/hero-section";

beforeEach(() => {
  motion.reduce = false;
  // happy-dom has no media playback; the hero only needs play/pause to exist.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("hero says one thing above the film: the headline, a free sign-up, self-hosting and the price", () => {
  render(<HeroSection />);

  expect(screen.getByRole("heading", { level: 1, name: /See where your AI coding spend goes\./ })).toBeTruthy();
  // The film carries the detail, so the static copy has no eyebrow and no paragraph competing with it.
  expect(screen.queryByText("For engineering and platform teams")).toBeNull();
  expect(screen.queryByText(/each show only their own seats/)).toBeNull();
  expect(screen.getByRole("link", { name: "Self-host from GitHub" })).toBeTruthy();

  const cta = screen.getByRole("link", { name: "Start free" });
  expect(cta.getAttribute("href")).toBe(`/signup?from=${encodeURIComponent("/onboarding?mode=solo")}`);
  expect(screen.getByText("Free for 5 seats, then $1 per active developer a month. No card.")).toBeTruthy();
});

test("hero plays the product loop muted, inline and on repeat, with a smaller encode for phones", () => {
  render(<HeroSection />);

  const video = screen.getByLabelText(/UseJunction product video/) as HTMLVideoElement;
  expect(video.muted).toBe(true);
  expect(video.loop).toBe(true);
  // happy-dom has no playsInline property; the attribute is what iOS Safari reads.
  expect(video.hasAttribute("playsinline")).toBe(true);
  expect(video.controls).toBe(false);
  expect(video.getAttribute("poster")).toBe("/video/hero-loop-poster.jpg");
  // Phones match the first source; everyone else falls through to the full-size encode. VP9 comes last, for
  // browsers that cannot play H.264.
  expect(
    [...video.querySelectorAll("source")].map((source) => [source.getAttribute("src"), source.getAttribute("media")]),
  ).toEqual([
    ["/video/hero-loop-mobile.mp4", "(max-width: 767px)"],
    ["/video/hero-loop.mp4", null],
    ["/video/hero-loop-mobile.webm", "(max-width: 767px)"],
    ["/video/hero-loop.webm", null],
  ]);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
});

test("hero video shows controls when the browser refuses autoplay, so a tap starts it", async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
  render(<HeroSection />);

  const video = screen.getByLabelText(/UseJunction product video/) as HTMLVideoElement;
  await waitFor(() => expect(video.controls).toBe(true));
});

test("hero video stays still with controls when reduced motion is on", () => {
  motion.reduce = true;
  render(<HeroSection />);

  const video = screen.getByLabelText(/UseJunction product video/) as HTMLVideoElement;
  expect(video.controls).toBe(true);
  expect(video.autoplay).toBe(false);
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
});

test("hero film names its four chapters and jumps to the one a visitor picks", () => {
  render(<HeroSection />);

  const video = screen.getByLabelText(/UseJunction product video/) as HTMLVideoElement;
  const chapters = within(screen.getByRole("group", { name: "Video chapters" }));
  expect(chapters.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "WorkWhat a feature costs",
    "ForecastWhere the month lands",
    "SeeWho is near a limit",
    "PrivacyWhat is never collected",
    "",
  ]);

  vi.mocked(HTMLMediaElement.prototype.play).mockClear();
  fireEvent.click(chapters.getByRole("button", { name: /^Forecast/ }));
  expect(video.currentTime).toBe(11.1);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  expect(chapters.getByRole("button", { name: /^Forecast/ }).getAttribute("aria-current")).toBe("true");
  expect(chapters.getByRole("button", { name: /^Work/ }).getAttribute("aria-current")).toBeNull();
});

test("hero film can be paused and started again, as autoplaying motion must allow", () => {
  render(<HeroSection />);

  fireEvent.click(screen.getByRole("button", { name: "Pause video" }));
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();

  vi.mocked(HTMLMediaElement.prototype.play).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Play video" }));
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Pause video" })).toBeTruthy();
});

test("with reduced motion a chapter shows as a still frame instead of playing", () => {
  motion.reduce = true;
  render(<HeroSection />);

  const video = screen.getByLabelText(/UseJunction product video/) as HTMLVideoElement;
  fireEvent.click(screen.getByRole("button", { name: /^See/ }));
  expect(video.currentTime).toBe(16.2);
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
});
