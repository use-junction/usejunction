// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
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

test("hero leads with per-person seat usage, a free sign-up and the price", () => {
  render(<HeroSection />);

  expect(
    screen.getByRole("heading", { level: 1, name: /See who actually uses the AI coding seats you pay for\./ }),
  ).toBeTruthy();

  const cta = screen.getByRole("link", { name: "Start free" });
  expect(cta.getAttribute("href")).toBe(`/signup?from=${encodeURIComponent("/onboarding?mode=solo")}`);
  expect(screen.getByText("Free for 5 seats. Then $1 per active developer a month. No card.")).toBeTruthy();
});

test("hero video plays muted and loops without controls", () => {
  render(<HeroSection />);

  const video = screen.getByLabelText(/UseJunction product video/) as HTMLVideoElement;
  expect(video.muted).toBe(true);
  expect(video.loop).toBe(true);
  expect(video.controls).toBe(false);
  expect(video.getAttribute("poster")).toBe("/video/hero-poster.jpg");
  expect([...video.querySelectorAll("source")].map((source) => source.getAttribute("src"))).toEqual([
    "/video/hero.webm",
    "/video/hero.mp4",
  ]);
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
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
