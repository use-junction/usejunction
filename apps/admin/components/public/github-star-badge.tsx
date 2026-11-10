"use client";

import { useEffect, useState } from "react";
import { Github, Star } from "lucide-react";

interface GithubStarBadgeProps {
  href: string;
  /** Optional override for the repo path (owner/repo). If omitted it is parsed from href. */
  repo?: string;
  className?: string;
  /** Show the star count next to the icon. Off while the count is too small to help. */
  showCount?: boolean;
}

function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const trimmed = (value / 1000).toFixed(1).replace(/\.0$/, "");
    return `${trimmed}K`;
  }
  const trimmed = (value / 1_000_000).toFixed(1).replace(/\.0$/, "");
  return `${trimmed}M`;
}

function parseRepo(href: string): string | null {
  try {
    const url = new URL(href);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  } catch {
    // not a URL
  }
  return null;
}

export function GithubStarBadge({ href, repo, className, showCount = true }: GithubStarBadgeProps) {
  const [stars, setStars] = useState<number | null>(null);

  const repoPath = repo ?? parseRepo(href);

  useEffect(() => {
    if (!repoPath || !showCount) return;
    let cancelled = false;

    const cacheKey = `uj:github:stars:${repoPath}`;
    const cached = typeof window !== "undefined" ? window.sessionStorage.getItem(cacheKey) : null;
    if (cached) {
      const parsed = Number(cached);
      if (!Number.isNaN(parsed)) setStars(parsed);
      return;
    }

    fetch(`https://api.github.com/repos/${repoPath}`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { stargazers_count?: number } | null) => {
        if (cancelled || !data || typeof data.stargazers_count !== "number") return;
        setStars(data.stargazers_count);
        try {
          window.sessionStorage.setItem(cacheKey, String(data.stargazers_count));
        } catch {
          // ignore storage failures
        }
      })
      .catch(() => {
        // network or rate-limit failure; leave as null
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath, showCount]);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="View UseJunction on GitHub"
      className={`public-github-star-badge ${className ?? ""}`}
    >
      <span className="public-github-star-badge__icon">
        <Github className="h-4 w-4" />
      </span>
      {showCount ? (
        <>
          <span className="public-github-star-badge__divider" aria-hidden="true" />
          <span className="public-github-star-badge__count">
            <Star className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{stars === null ? "—" : formatCount(stars)}</span>
          </span>
        </>
      ) : null}
    </a>
  );
}
