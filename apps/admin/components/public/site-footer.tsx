import Link from "next/link";
import { Github } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { siteConfig, FOOTER_COLUMNS } from "@/lib/public/config";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10 xl:px-12">
        <div className="mx-auto grid max-w-6xl gap-10 py-12 sm:py-14 lg:grid-cols-[1fr_2fr]">
          <div>
            <BrandLogo className="h-9" />
            <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">
              {siteConfig.tagline}. Self-host it, or let us host it.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3">
            {(
              [
                ["Product", FOOTER_COLUMNS.product],
                ["Community", FOOTER_COLUMNS.community],
                ["Legal", FOOTER_COLUMNS.license],
              ] as const
            ).map(([title, links]) => (
              <div key={title}>
                <p className="text-sm font-semibold text-muted-foreground">{title}</p>
                <div className="mt-4 grid gap-3 text-sm">
                  {links.map((link) => (
                    <Link
                      key={link.href + link.label}
                      href={link.href}
                      className="flex w-fit items-center gap-2 hover:text-primary"
                      {...(link.href.startsWith("http")
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                    >
                      {link.label === "GitHub" ? <Github className="size-4" /> : null}
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-3 border-t border-border py-5 text-[0.8125rem] text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} {siteConfig.name}
          </span>
          <Link href="/llms.txt" className="hover:text-primary">
            llms.txt
          </Link>
        </div>
      </div>
    </footer>
  );
}
