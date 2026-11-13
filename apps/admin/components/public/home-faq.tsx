import { DecorativeToolIcon } from "@/components/public/tool-logos-strip";
import { SUPPORTED_TOOLS } from "@/lib/public/config";
import { HOME_FAQ_VISIBLE, HOME_FAQS } from "@/lib/public/home-faqs";

const SUMMARY =
  "flex cursor-pointer list-none items-baseline justify-between gap-6 py-6 text-left font-semibold tracking-[-0.01em] [&::-webkit-details-marker]:hidden";

function Toggle() {
  return (
    <span
      aria-hidden
      className="inline-flex size-7 shrink-0 items-center justify-center border-[1.5px] !border-primary text-lg font-normal leading-none text-primary"
    >
      <span className="group-open:hidden">+</span>
      <span className="hidden group-open:inline">−</span>
    </span>
  );
}

export function HomeFaq() {
  const visible = HOME_FAQS.slice(0, HOME_FAQ_VISIBLE);
  const more = HOME_FAQS.slice(HOME_FAQ_VISIBLE);

  return (
    <section id="faq" aria-labelledby="home-faq-heading" className="scroll-mt-20 bg-white pb-24 pt-24 sm:pb-32 sm:pt-32 lg:pb-44 lg:pt-44">
      <div className="mx-auto grid w-full max-w-[75rem] gap-12 px-4 sm:px-6 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-24 xl:grid-cols-[26rem_minmax(0,1fr)]">
        <div>
          <h2 id="home-faq-heading" className="text-[1.6rem] font-medium leading-tight tracking-[-0.02em] text-[#3a3b37] sm:text-[1.95rem]">
            Before you install.
          </h2>
          <p id="tools" className="mt-8 scroll-mt-24 text-[0.8125rem] font-semibold text-muted-foreground">
            Works with
          </p>
          <ul aria-label="Supported tools" className="mt-3.5 grid grid-cols-2 gap-x-5 gap-y-3.5">
            {SUPPORTED_TOOLS.map((tool) => (
              <li key={tool.name} className="flex items-center gap-2.5 text-[0.9375rem] font-medium">
                <DecorativeToolIcon name={tool.name} size={24} />
                {tool.name}
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t-2 !border-foreground">
          {visible.map((faq, index) => (
            <details
              key={faq.question}
              className="group border-b border-border open:border-l-[3px] open:!border-l-brand-yellow open:pl-5"
              open={index === 0}
            >
              <summary className={`${SUMMARY} text-base md:text-lg`}>
                {faq.question}
                <Toggle />
              </summary>
              <p className="max-w-2xl pb-7 text-[0.9375rem] leading-7 text-[#3a3b37] md:pr-10 md:text-base">{faq.answer}</p>
            </details>
          ))}
          <details className="group border-b border-border">
            <summary className={`${SUMMARY} text-[0.9375rem] text-muted-foreground`}>
              More questions
              <Toggle />
            </summary>
            <dl className="pb-4">
              {more.map((faq) => (
                <div key={faq.question} className="mb-5">
                  <dt className="font-semibold">{faq.question}</dt>
                  <dd className="mt-1.5 max-w-2xl text-[0.9375rem] leading-7 text-[#3a3b37]">{faq.answer}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
      </div>
    </section>
  );
}
