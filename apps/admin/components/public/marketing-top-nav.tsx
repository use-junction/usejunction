"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X } from "lucide-react";
import usejunctionLogo from "@/public/usejunction.png";
import { navAnchors, navLinks, siteConfig } from "@/lib/public/config";
import { GithubStarBadge } from "@/components/public/github-star-badge";
import { HOME_SIGNUP_HREF, HOME_SIGNUP_LABEL } from "@/lib/public/home-cta";

interface MarketingTopNavProps {
  isAuthenticated: boolean;
}

export function MarketingTopNav({ isAuthenticated }: MarketingTopNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const scrollToAnchor = useCallback(
    (id: string) => {
      setMobileOpen(false);

      function attemptScroll(retries = 0) {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: "smooth" });
          return;
        }
        if (retries < 20) {
          setTimeout(() => attemptScroll(retries + 1), 50);
        }
      }

      if (pathname !== "/") {
        router.push(`/#${id}`);
        setTimeout(() => attemptScroll(), 100);
      } else {
        attemptScroll();
      }
    },
    [pathname, router]
  );

  useEffect(() => {
    if (pathname === "/" && window.location.hash) {
      const id = window.location.hash.slice(1);
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileOpen]);

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 w-full transition-colors duration-200"
      style={{
        background: "var(--public-surface)",
      }}
    >
      <div className="public-container flex h-16 items-center justify-between md:grid md:grid-cols-[1fr_auto_1fr]">
        <Link
          href="/"
          className="inline-flex h-10 items-center md:col-start-2 md:row-start-1 md:justify-self-center"
          aria-label="UseJunction home"
        >
          <Image
            src={usejunctionLogo}
            alt={siteConfig.name}
            width={usejunctionLogo.width}
            height={usejunctionLogo.height}
            priority
            className="h-10 w-auto sm:h-12"
          />
        </Link>

        <nav
          className="hidden h-10 items-center gap-8 md:col-start-1 md:row-start-1 md:flex md:justify-self-start"
          aria-label="Primary navigation"
        >
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex h-10 items-center text-sm leading-none text-[var(--public-muted)] transition-colors hover:text-[var(--public-fg)]"
            >
              {link.label}
            </Link>
          ))}
          {navAnchors.map((anchor) => (
            <button
              key={anchor.id}
              type="button"
              onClick={() => scrollToAnchor(anchor.id)}
              className="inline-flex h-10 items-center text-sm leading-none text-[var(--public-muted)] transition-colors hover:text-[var(--public-fg)]"
            >
              {anchor.label}
            </button>
          ))}
        </nav>

        <div className="hidden h-10 items-center gap-3 md:col-start-3 md:row-start-1 md:flex md:justify-self-end">
          <GithubStarBadge href={siteConfig.githubUrl} showCount={false} />
          {isAuthenticated ? (
            <Link href="/dashboard" className="public-btn public-btn-yellow rounded-none font-semibold">
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="inline-flex h-10 items-center px-1 text-sm leading-none text-[var(--public-fg)] transition-colors hover:text-[var(--public-accent)]"
              >
                Sign in
              </Link>
              <Link href={HOME_SIGNUP_HREF} className="public-btn public-btn-yellow rounded-none font-semibold">
                {HOME_SIGNUP_LABEL}
              </Link>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 md:hidden">
          {isAuthenticated ? (
            <Link href="/dashboard" className="public-btn public-btn-yellow rounded-none px-4 font-semibold">
              Dashboard
            </Link>
          ) : (
            <Link href={HOME_SIGNUP_HREF} className="public-btn public-btn-yellow rounded-none px-4 font-semibold">
              {HOME_SIGNUP_LABEL}
            </Link>
          )}
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-primary-navigation"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        </div>
      </div>

      {mobileOpen && (
        <div
          id="mobile-primary-navigation"
          className="max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-t md:hidden"
          style={{ borderColor: "var(--public-border)", background: "var(--public-surface)" }}
        >
          <nav className="public-container flex flex-col gap-1 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" aria-label="Mobile navigation">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex min-h-11 items-center px-1 text-left text-sm"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            {navAnchors.map((anchor) => (
              <button
                key={anchor.id}
                type="button"
                onClick={() => scrollToAnchor(anchor.id)}
                className="flex min-h-11 items-center px-1 text-left text-sm"
              >
                {anchor.label}
              </button>
            ))}
            <div className="mt-2 flex justify-center">
              <GithubStarBadge href={siteConfig.githubUrl} showCount={false} />
            </div>
            {isAuthenticated ? (
              <Link href="/dashboard" className="public-btn public-btn-yellow w-full rounded-none text-center text-sm font-semibold">
                Dashboard
              </Link>
            ) : (
              <Link
                href="/login"
                className="public-btn public-btn-outline mt-1 w-full rounded-none text-center text-sm font-semibold"
                onClick={() => setMobileOpen(false)}
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
