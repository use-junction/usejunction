// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

test("hero says one thing beside the film: the headline, one line of detail, a free sign-up and the price", () => {
  render(<HeroSection />);

  expect(screen.getByRole("heading", { level: 1, name: /See where your AI coding spend goes\./ })).toBeTruthy();
  expect(screen.getByText("What each feature costs, where the month will land, and who is near a limit.")).toBeTruthy();
  // No eyebrow and no long paragraph: the film shows the detail.
  expect(screen.queryByText("For engineering and platform teams")).toBeNull();
  expect(screen.queryByText(/each show only their own seats/)).toBeNull();
  expect(screen.getByRole("link", { name: "Self-host from GitHub" })).toBeTruthy();

  const cta = screen.getByRole("link", { name: "Start free" });
  expect(cta.getAttribute("href")).toBe(`/signup?from=${encodeURIComponent("/onboarding?mode=solo")}`);
  expect(screen.getByText("Free for 5 seats, then $1 per active developer a month. No card.")).toBeTruthy();
});

test("hero reads headline, detail, film, then the actions, which is the order a phone shows them in", () => {
  render(<HeroSection />);

  const follows = (later: Element, earlier: Element) =>
    Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
  const detail = screen.getByText("What each feature costs, where the month will land, and who is near a limit.");
  const video = screen.getByLabelText(/UseJunction product video/);

  expect(follows(detail, screen.getByRole("heading", { level: 1 }))).toBe(true);
  expect(follows(video, detail)).toBe(true);
  expect(follows(screen.getByRole("link", { name: "Start free" }), video)).toBe(true);
  expect(follows(screen.getByRole("link", { name: "Self-host from GitHub" }), video)).toBe(true);
  expect(follows(screen.getByText(/Free for 5 seats/), video)).toBe(true);
});

test("hero plays the product loop muted, inline and on repeat, with a smaller encode for phones", () => {
  render(<HeroSection />);

  const video = screen.getByLabelText(/UseJunction product video/) as HTMLVideoElement;
  expect(video.muted).toBe(true);
  expect(video.loop).toBe(true);
  // happy-dom has no playsInline property; the attribute is what iOS Safari reads.
  expect(video.hasAttribute("playsinline")).toBe(true);
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

test("hero film does not look like a video player: no player controls and no chapter strip", () => {
  render(<HeroSection />);

  const video = screen.getByLabelText(/UseJunction product video/) as HTMLVideoElement;
  expect(video.controls).toBe(false);
  expect(screen.queryByRole("group", { name: "Video chapters" })).toBeNull();
  // The one control is the pause button, which is see-through until the film is hovered, focused or paused.
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Pause video" }).className).toContain("opacity-0");
});

test("hero film can be paused and started again, as autoplaying motion must allow", () => {
  render(<HeroSection />);

  fireEvent.click(screen.getByRole("button", { name: "Pause video" }));
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  // While paused the button stays visible, so there is always a way to start the film again.
  expect(screen.getByRole("button", { name: "Play video" }).className).toContain("opacity-100");

  vi.mocked(HTMLMediaElement.prototype.play).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Play video" }));
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Pause video" })).toBeTruthy();
});

test("a tap on the film pauses it, for touch screens where the button cannot be hovered into view", () => {
  render(<HeroSection />);

  fireEvent.click(screen.getByLabelText(/UseJunction product video/));
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
});

test("hero film shows a play button when the browser refuses autoplay, so a tap starts it", async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
  render(<HeroSection />);

  await waitFor(() => expect(screen.getByRole("button", { name: "Play video" }).className).toContain("opacity-100"));
});

test("hero film stays still with a play button when reduced motion is on", () => {
  motion.reduce = true;
  render(<HeroSection />);

  const video = screen.getByLabelText(/UseJunction product video/) as HTMLVideoElement;
  expect(video.autoplay).toBe(false);
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Play video" }).className).toContain("opacity-100");
});
