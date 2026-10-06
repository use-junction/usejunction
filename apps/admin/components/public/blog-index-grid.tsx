"use client";

import { useState } from "react";
import type { BlogPost } from "@/content/types";
import { BlogCard } from "@/components/public/blog-card";

export function BlogIndexGrid({ posts, featuredPath }: { posts: BlogPost[]; featuredPath?: string }) {
  const [active, setActive] = useState<string | null>(null);
  const categories = [...new Set(posts.map((post) => post.category))];
  // The featured post already leads the page, so "All" lists the rest.
  const visible = active ? posts.filter((post) => post.category === active) : posts.filter((post) => post.path !== featuredPath);

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        {[null, ...categories].map((category) => (
          <button
            key={category ?? "all"}
            type="button"
            aria-pressed={active === category}
            onClick={() => setActive(category)}
            className={`rounded-sm border px-3 py-1 text-sm transition-colors ${
              active === category ? "border-primary bg-primary text-primary-foreground" : "border-border bg-white text-foreground hover:border-primary/50"
            }`}
          >
            {category ?? "All"}
          </button>
        ))}
      </div>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {visible.map((post) => <BlogCard key={post.path} post={post} />)}
      </div>
    </>
  );
}
