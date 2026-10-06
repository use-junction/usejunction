import Link from "next/link";
import type { ContentPage } from "@/content/types";
import { buildContentJsonLd } from "@/lib/public/json-ld";
import { SiteFooter } from "@/components/public/site-footer";
import { cn } from "@/lib/utils";

export function LegalDocument({ page }: { page: ContentPage }) {
  const jsonLd = buildContentJsonLd(page);
  const legalNav = [
    { href: "/privacy", label: "Privacy", slug: "privacy" },
    { href: "/terms", label: "Terms", slug: "terms" },
    { href: "/dpa", label: "DPA", slug: "dpa" },
    { href: "/subprocessors", label: "Subprocessors", slug: "subprocessors" },
    { href: "/gdpr", label: "GDPR", slug: "gdpr" },
    { href: "/security", label: "Security", slug: "security" },
    { href: "/cookies", label: "Cookies", slug: "cookies" },
  ] as const;

  return (
    <main className="bg-white">
      {jsonLd.map((data, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
        />
      ))}

      <article className="mx-auto w-full max-w-3xl px-4 pb-20 pt-28 sm:px-6 lg:px-8 lg:pb-28 lg:pt-32">
        <nav aria-label="Legal documents" className="flex flex-wrap gap-2">
          {(
            legalNav
          ).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "text-sm font-medium transition-colors",
                item.slug === page.slug ? "text-[#08a8c4]" : "text-[#5c5e56] hover:text-[#08a8c4]",
              )}
              aria-current={item.slug === page.slug ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <h1 className="mt-6 text-3xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl lg:text-[2.5rem]">
          {page.title}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">Updated {page.updatedAt}</p>

        <p className="mt-8 text-base leading-7 text-[#5c5e56] sm:text-lg sm:leading-8">{page.answer}</p>

        {page.sections.map((section) => (
          <section key={section.heading} className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p
                key={paragraph.slice(0, 64)}
                className="mt-4 text-base leading-7 text-muted-foreground md:leading-8"
              >
                {paragraph}
              </p>
            ))}
          </section>
        ))}

        {page.faq.length ? (
          <section className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">FAQ</h2>
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

        <p className="mt-14 border-t border-border pt-8 text-sm text-muted-foreground">
          Also see{" "}
          <Link href="/privacy" className="font-medium text-[#08a8c4] hover:text-[#08758a]">
            Privacy
          </Link>
          {", "}
          <Link href="/dpa" className="font-medium text-[#08a8c4] hover:text-[#08758a]">
            DPA
          </Link>
          {", and "}
          <Link href="/gdpr" className="font-medium text-[#08a8c4] hover:text-[#08758a]">
            GDPR
          </Link>
          .
        </p>
      </article>

      <SiteFooter />
    </main>
  );
}
