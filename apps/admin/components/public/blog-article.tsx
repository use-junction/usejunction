import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarDays, Clock, Tag } from "lucide-react";
import type { BlogPost } from "@/content/types";
import { BLOG_POSTS } from "@/content/blog";
import { getContentByPath } from "@/content/registry";
import { buildBlogPostJsonLd } from "@/lib/public/json-ld";
import { siteConfig } from "@/lib/public/config";
import { BlogInlineContent } from "@/components/public/blog-inline";
import { BlogCard, BlogChip, blogChips, formatBlogDate, headingId } from "@/components/public/blog-card";
import { SiteFooter } from "@/components/public/site-footer";

export function BlogArticle({ post }: { post: BlogPost }) {
  const jsonLd = buildBlogPostJsonLd(post);
  const relatedPages = post.relatedPaths.map(getContentByPath).filter((page) => page !== undefined);
  const morePosts = BLOG_POSTS.filter((item) => item.path !== post.path).slice(0, 2);
  const updated = post.updatedAt !== post.publishedAt;

  return (
    <>
      {jsonLd.map((data, index) => (
        <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
      ))}
      <main className="bg-background pt-28 lg:pt-32">
        <article className="mx-auto w-full max-w-[800px] px-4 pb-16 sm:px-6 lg:pb-24">
          <Link href="/blog" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" /> Back to blog
          </Link>

          <h1 className="mt-8 font-display text-3xl font-semibold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-4xl lg:text-[2.75rem]">
            {post.title}
          </h1>

          <dl className="mt-7 flex flex-wrap gap-x-10 gap-y-5 text-sm">
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Tag className="size-3.5" /> Category</dt>
              <dd className="mt-2 flex flex-wrap gap-2">{blogChips(post).map((chip) => <BlogChip key={chip}>{chip}</BlogChip>)}</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" /> {updated ? "Updated" : "Published"}</dt>
              <dd className="mt-2 font-medium text-foreground">
                <time dateTime={post.updatedAt}>{formatBlogDate(post.updatedAt)}</time>
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="size-3.5" /> Read time</dt>
              <dd className="mt-2 font-medium text-foreground">{post.readingMinutes} min</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Written by</dt>
              <dd className="mt-2 font-medium"><Link href={post.author.path} rel="author" className="text-foreground hover:text-primary">{post.author.name}</Link></dd>
            </div>
          </dl>

          <figure className="mt-9 overflow-hidden rounded-md border border-border bg-[#f3f2ea]">
            <Image src={post.heroImage.src} alt={post.heroImage.alt} width={post.heroImage.width} height={post.heroImage.height} priority sizes="(max-width: 840px) 100vw, 800px" className="h-auto w-full" />
          </figure>

          <p className="mt-10 text-lg font-semibold leading-8 text-foreground">{post.answer}</p>

          {post.takeaways.length ? (
            <section aria-labelledby="key-takeaways" className="mt-10">
              <h2 id="key-takeaways" className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">Key takeaways</h2>
              <ul className="mt-4 grid list-disc gap-2 pl-5 text-[1.0625rem] leading-7 text-muted-foreground marker:text-primary">
                {post.takeaways.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          ) : null}

          {post.blocks.map((block, index) => {
            if (block.type === "heading") {
              const id = headingId(block.text);
              return (
                <h2 key={`${block.text}-${index}`} id={id} className="group mt-14 scroll-mt-28 font-display text-2xl font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[1.75rem]">
                  <a href={`#${id}`} className="hover:text-primary">{block.text}</a>
                </h2>
              );
            }
            if (block.type === "paragraph") {
              return <p key={index} className="mt-5 text-[1.0625rem] leading-8 text-muted-foreground"><BlogInlineContent content={block.content} /></p>;
            }
            if (block.type === "list") {
              return (
                <ul key={index} className="mt-5 grid list-disc gap-2 pl-5 text-[1.0625rem] leading-8 text-muted-foreground marker:text-primary">
                  {block.items.map((item, itemIndex) => <li key={itemIndex}><BlogInlineContent content={item} /></li>)}
                </ul>
              );
            }
            if (block.type === "quote") {
              return <blockquote key={index} className="my-10 border-l-4 border-brand-yellow bg-brand-yellow-pale px-6 py-6 font-display text-xl font-medium leading-8 text-foreground"><BlogInlineContent content={block.content} /></blockquote>;
            }
            return (
              <figure key={index} className="my-10 overflow-hidden rounded-md border border-border bg-white p-2 sm:p-3">
                <Image src={block.image.src} alt={block.image.alt} width={block.image.width} height={block.image.height} sizes="(max-width: 840px) 92vw, 800px" className="h-auto w-full" />
                {block.image.caption ? <figcaption className="px-2 pb-1 pt-3 text-sm text-muted-foreground">{block.image.caption}</figcaption> : null}
              </figure>
            );
          })}

          {post.faq?.length ? (
            <section aria-labelledby="faq" className="mt-16">
              <h2 id="faq" className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-[1.75rem]">Frequently asked questions</h2>
              <div className="mt-6 divide-y divide-border border-y border-border">
                {post.faq.map((item) => (
                  <details key={item.question} className="group py-5" open>
                    <summary className="cursor-pointer list-none font-semibold text-foreground">{item.question}</summary>
                    <p className="mt-3 text-[1.0625rem] leading-8 text-muted-foreground">{item.answer}</p>
                  </details>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-16 rounded-md border border-primary/25 bg-primary-pale p-6 sm:p-8">
            <h2 className="font-display text-2xl font-semibold tracking-tight">See your AI coding stack as one system.</h2>
            <p className="mt-3 leading-7 text-muted-foreground">Usage, cost, plans, and seats for every developer and every tool. Self-host it or use the managed version.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={siteConfig.signupUrl} className="public-btn public-btn-yellow rounded-none font-semibold">Get started <ArrowRight className="size-4" /></Link>
              <Link href={siteConfig.githubUrl} target="_blank" rel="noopener noreferrer" className="public-btn public-btn-outline rounded-none font-semibold">View on GitHub</Link>
            </div>
          </section>

          <section className="mt-14 flex gap-4 border-t border-border pt-10">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary-pale font-mono text-sm font-semibold text-primary">{post.author.initials}</span>
            <div>
              <Link href={post.author.path} rel="author" className="font-semibold hover:text-primary">{post.author.name}</Link>
              <p className="text-sm text-muted-foreground">{post.author.role}</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{post.author.bio}</p>
            </div>
          </section>

          {relatedPages.length ? (
            <nav className="mt-12 border-t border-border pt-10" aria-label="Related guides">
              <p className="text-sm font-semibold text-foreground">Related guides</p>
              <ul className="mt-4 grid gap-2">
                {relatedPages.map((page) => <li key={page.path}><Link href={page.path} className="text-primary hover:underline">{page.title}</Link></li>)}
              </ul>
            </nav>
          ) : null}
        </article>

        {morePosts.length ? (
          <section aria-labelledby="more-articles" className="border-t border-border">
            <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
              <h2 id="more-articles" className="font-display text-3xl font-semibold tracking-[-0.03em]">More articles</h2>
              <div className="mt-8 grid gap-6 md:grid-cols-2">
                {morePosts.map((item) => <BlogCard key={item.path} post={item} />)}
              </div>
            </div>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </>
  );
}
