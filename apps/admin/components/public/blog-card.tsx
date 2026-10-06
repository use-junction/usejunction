import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import type { BlogPost } from "@/content/types";

export const formatBlogDate = (value: string) =>
  new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );

/** Stable anchor id for an article heading, so answer engines and readers can deep-link sections. */
export const headingId = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’'"“”]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Category first, then up to two distinct topics. */
export const blogChips = (post: Pick<BlogPost, "category" | "topics">) =>
  [post.category, ...post.topics.filter((topic) => topic !== post.category)].slice(0, 3);

export function BlogChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-primary/40 bg-white px-2 py-0.5 text-xs font-medium text-primary-dark">
      {children}
    </span>
  );
}

export function BlogCard({ post }: { post: BlogPost }) {
  return (
    <article className="group flex flex-col rounded-md border border-border bg-white p-4 transition-colors hover:border-primary/40 sm:p-5">
      <div className="flex flex-wrap gap-2">{blogChips(post).map((chip) => <BlogChip key={chip}>{chip}</BlogChip>)}</div>
      <Link href={post.path} className="mt-4 block overflow-hidden rounded-sm bg-[#f3f2ea]" tabIndex={-1} aria-hidden>
        <Image src={post.heroImage.src} alt="" width={post.heroImage.width} height={post.heroImage.height} sizes="(max-width: 768px) 92vw, 540px" className="h-auto w-full transition-transform duration-300 group-hover:scale-[1.015]" />
      </Link>
      <h3 className="mt-5 font-display text-xl font-semibold leading-snug tracking-[-0.015em] text-foreground sm:text-2xl">
        <Link href={post.path} className="hover:text-primary">{post.title}</Link>
      </h3>
      <p className="mt-3 flex-1 leading-7 text-muted-foreground">{post.description}</p>
      <p className="mt-5 text-sm text-muted-foreground">
        <time dateTime={post.publishedAt}>{formatBlogDate(post.publishedAt)}</time> · {post.readingMinutes} min read
      </p>
    </article>
  );
}
