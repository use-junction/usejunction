"use client";

import Link from "next/link";
import Image from "next/image";
import type { ContentPage } from "@/content/types";
import { contentBreadcrumbs, getRelatedPages } from "@/content/registry";
import { buildContentJsonLd } from "@/lib/public/json-ld";
import { siteConfig } from "@/lib/public/config";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { Breadcrumbs } from "@/components/public/breadcrumbs";
import { SiteFooter } from "@/components/public/site-footer";

export function ContentArticle({ page }: { page: ContentPage }) {
  const jsonLd = buildContentJsonLd(page);
  const related = getRelatedPages(page);

  return (
    <>
      {jsonLd.map((data, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
        />
      ))}
      <article className="mx-auto w-full max-w-3xl px-4 pb-16 pt-28 sm:px-5 lg:px-8 lg:pb-24 lg:pt-32">
        <Breadcrumbs items={contentBreadcrumbs(page)} />
        <p className="mt-6 font-mono text-xs uppercase tracking-[0.16em] text-primary">
          {page.kind === "for" ? "Tool guide" : page.kind === "solution" ? "Solution" : page.kind}
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl lg:text-[2.5rem] lg:leading-[1.1]">
          {page.title}
        </h1>
        <p className="mt-3 font-mono text-xs text-muted-foreground">
          Updated {page.updatedAt} · {page.primaryKeyword}
        </p>

        <div className="mt-8 rounded-lg border border-border bg-card p-5 text-base leading-7 text-foreground md:text-lg md:leading-8">
          {page.answer}
        </div>

        {page.images?.map((image) => (
          <figure key={image.src} className="mt-10 overflow-hidden border border-border bg-white p-2 shadow-[0_18px_42px_-34px_rgba(17,18,16,0.45)] sm:p-3">
            <Image src={image.src} alt={image.alt} width={image.width} height={image.height} sizes="(max-width: 800px) 92vw, 760px" className="h-auto w-full" />
            {image.caption ? <figcaption className="px-2 pb-1 pt-3 font-mono text-xs text-muted-foreground">{image.caption}</figcaption> : null}
          </figure>
        ))}

        {page.compareRows && page.compareOtherName ? (
          <div className="mt-12 overflow-x-auto overscroll-x-contain" role="region" aria-label="Feature comparison" tabIndex={0}>
            <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{page.compareHeading ?? "Feature comparison"}</h2>
            <table className="mt-4 w-full min-w-[32rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-3 pr-4 font-medium">Feature</th>
                  <th className="py-3 pr-4 font-medium">{page.compareOwnName ?? siteConfig.name}</th>
                  <th className="py-3 font-medium">{page.compareOtherName}</th>
                </tr>
              </thead>
              <tbody>
                {page.compareRows.map((row) => (
                  <tr key={row.feature} className="border-b border-border align-top">
                    <td className="py-3 pr-4 font-medium">{row.feature}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{row.usejunction}</td>
                    <td className="py-3 text-muted-foreground">{row.other}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {page.sections.map((section) => (
          <section key={section.heading} className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph.slice(0, 48)} className="mt-4 text-base leading-7 text-muted-foreground md:leading-8">
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        {page.howTo ? (
          <section className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight md:text-2xl">{page.howTo.name}</h2>
            <ol className="mt-4 list-decimal space-y-4 pl-5 text-base leading-7 text-muted-foreground">
              {page.howTo.steps.map((step) => (
                <li key={step.name}>
                  <span className="font-medium text-foreground">{step.name}.</span> {step.text}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {page.faq.length ? (
          <section className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight md:text-2xl">FAQ</h2>
            <dl className="mt-6 space-y-6">
              {page.faq.map((item) => (
                <div key={item.question}>
                  <dt className="font-medium text-foreground">{item.question}</dt>
                  <dd className="mt-2 text-base leading-7 text-muted-foreground">{item.answer}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <section className="mt-14 flex flex-col gap-4 border-t border-border pt-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-primary">Get started</p>
            <p className="mt-2 text-base text-muted-foreground">
              Deploy open-source or upgrade to Managed.
            </p>
          </div>
          <Button asChild>
            <Link href={siteConfig.signupUrl}>
              Create organization <ArrowRight className="size-4" />
            </Link>
          </Button>
        </section>

        {related.length ? (
          <nav className="mt-14 border-t border-border pt-10" aria-label="Related pages">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">Related</p>
            <ul className="mt-4 grid gap-3">
              {related.map((item) => (
                <li key={item.path}>
                  <Link href={item.path} className="text-sm font-medium text-primary hover:underline">
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </article>
      <SiteFooter />
    </>
  );
}
