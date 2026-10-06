import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { BlogPost } from "@/content/types";
import { buildHubJsonLd } from "@/lib/public/json-ld";
import { BlogChip, blogChips } from "@/components/public/blog-card";
import { BlogIndexGrid } from "@/components/public/blog-index-grid";
import { SiteFooter } from "@/components/public/site-footer";

export function BlogIndex({ posts }: { posts: BlogPost[] }) {
  const sorted = [...posts].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  const featured = sorted.find((post) => post.featured) ?? sorted[0];
  const jsonLd = buildHubJsonLd({
    name: "UseJunction Blog",
    description: "Articles on AI coding observability, spend, seat utilization, and usage limits for engineering teams.",
    path: "/blog",
    items: sorted.map((post) => ({ name: post.title, path: post.path })),
  });

  return (
    <>
      {jsonLd.map((data, index) => <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />)}
      <main className="min-h-[70vh] bg-background pt-28 lg:pt-32">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10">
          <h1 className="font-display text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">Blog &amp; Articles</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
            AI coding observability, spend, seats, and usage limits for engineering teams.
          </p>

          {featured ? (
            <article className="group mt-10 grid overflow-hidden rounded-md border border-border bg-white lg:grid-cols-[0.95fr_1.05fr]">
              <div className="flex flex-col justify-center p-6 sm:p-8 lg:p-10">
                <div className="flex flex-wrap gap-2">{blogChips(featured).map((chip) => <BlogChip key={chip}>{chip}</BlogChip>)}</div>
                <h2 className="mt-5 font-display text-3xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
                  <Link href={featured.path} className="hover:text-primary">{featured.title}</Link>
                </h2>
                <p className="mt-4 leading-7 text-muted-foreground">{featured.description}</p>
                <Link href={featured.path} className="public-btn public-btn-yellow mt-7 w-fit rounded-none font-semibold">
                  Read more <ArrowRight className="size-4" />
                </Link>
              </div>
              <Link href={featured.path} tabIndex={-1} aria-hidden className="flex items-center overflow-hidden border-t border-border bg-[#f3f2ea] lg:border-l lg:border-t-0">
                <Image src={featured.heroImage.src} alt="" width={featured.heroImage.width} height={featured.heroImage.height} priority sizes="(max-width: 1024px) 100vw, 600px" className="h-auto w-full transition-transform duration-300 group-hover:scale-[1.015]" />
              </Link>
            </article>
          ) : null}

          <section aria-labelledby="latest" className="py-14 lg:py-20">
            <h2 id="latest" className="font-display text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Latest articles</h2>
            <BlogIndexGrid posts={sorted} featuredPath={featured?.path} />
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
