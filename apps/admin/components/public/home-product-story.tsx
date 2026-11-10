"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

const AUTO_ADVANCE_MS = 5000;

const workflows = [
  {
    id: "seats",
    label: "Which seats are idle?",
    title: "Every seat you pay for, next to whether anyone used it this cycle.",
    image: "/elements/see-it.png",
    alt: "Seat coverage — team seats with idle seats flagged",
  },
  {
    id: "spend",
    label: "Who is on the wrong plan?",
    title: "Each person's plan use and pace, so you can see who needs more and who needs less.",
    image: "/elements/understand-it.png",
    alt: "Spend and plan pace — developer spend watch and plan runway",
  },
  {
    id: "signals",
    label: "What needs a look this week?",
    title: "Spend spikes, personal API keys, and machines that stopped reporting, each with a name on it.",
    image: "/elements/control-it.png",
    alt: "Action queue — signals with owners and next steps",
  },
] as const;

type WorkflowId = (typeof workflows)[number]["id"];

const EASE = [0.22, 1, 0.36, 1] as const;

export function HomeProductStory() {
  const [activeId, setActiveId] = useState<WorkflowId>("seats");
  const [paused, setPaused] = useState(false);
  const [progressKey, setProgressKey] = useState(0);
  const reduceMotion = useReducedMotion();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = workflows.findIndex((w) => w.id === activeId);
  const active = workflows[activeIndex];
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  useEffect(() => {
    if (paused || reduceMotion) return;
    const id = window.setInterval(() => {
      const next = (activeIndexRef.current + 1) % workflows.length;
      setActiveId(workflows[next].id);
      setProgressKey((k) => k + 1);
    }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [paused, reduceMotion, activeId]);

  function selectWorkflow(id: WorkflowId) {
    setActiveId(id);
    setProgressKey((k) => k + 1);
  }

  function selectAndFocus(index: number) {
    const nextIndex = (index + workflows.length) % workflows.length;
    selectWorkflow(workflows[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectAndFocus(index + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectAndFocus(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectAndFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectAndFocus(workflows.length - 1);
    }
  }

  return (
    <section
      id="product"
      className="scroll-mt-20 bg-white py-20 sm:py-24 lg:py-32"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10 xl:px-12">
        <motion.h2
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5, ease: EASE }}
          className="mx-auto max-w-6xl text-3xl font-semibold leading-[1.1] tracking-[-0.03em] [text-wrap:balance] sm:text-4xl lg:text-[2.5rem]"
        >
          Three things to check before you renew.
        </motion.h2>

        <div className="mx-auto mt-12 flex max-w-6xl flex-col items-center gap-10 lg:mt-16 lg:flex-row lg:items-center lg:justify-center lg:gap-24 xl:gap-28">
          <div role="tablist" aria-label="Product workflows" className="flex w-full max-w-md flex-col lg:w-[22rem] lg:shrink-0 xl:w-[26rem]">
            {workflows.map((workflow, index) => {
              const selected = workflow.id === activeId;
              return (
                <motion.button
                  key={workflow.id}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  id={`home-product-tab-${workflow.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`home-product-panel-${workflow.id}`}
                  tabIndex={selected ? 0 : -1}
                  initial={reduceMotion ? false : { opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.08, ease: EASE }}
                  onClick={() => selectWorkflow(workflow.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                  className={cn(
                    "group relative w-full py-5 text-left first:pt-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border after:content-['']",
                    "last:after:hidden",
                    selected ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span className={cn("block text-lg sm:text-xl", selected ? "font-semibold" : "font-normal")}>
                    {workflow.label}
                  </span>
                  <AnimatePresence initial={false}>
                    {selected ? (
                      <motion.span
                        key={`${workflow.id}-desc`}
                        initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
                        transition={{ duration: 0.28, ease: EASE }}
                        className="mt-2 block max-w-md overflow-hidden text-sm leading-6 text-muted-foreground"
                      >
                        {workflow.title}
                      </motion.span>
                    ) : null}
                  </AnimatePresence>
                  {selected && !reduceMotion ? (
                    <motion.span
                      key={progressKey}
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 z-10 h-px origin-left bg-foreground"
                      initial={{ scaleX: 0 }}
                      animate={paused ? undefined : { scaleX: 1 }}
                      transition={{ duration: AUTO_ADVANCE_MS / 1000, ease: "linear" }}
                    />
                  ) : selected ? (
                    <span aria-hidden className="absolute inset-x-0 bottom-0 z-10 h-px bg-foreground" />
                  ) : null}
                </motion.button>
              );
            })}
          </div>

          <div className="w-full max-w-md shrink-0 sm:max-w-lg lg:max-w-xl">
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl">
              <AnimatePresence initial={false}>
                <motion.div
                  key={active.id}
                  id={`home-product-panel-${active.id}`}
                  role="tabpanel"
                  aria-labelledby={`home-product-tab-${active.id}`}
                  tabIndex={0}
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="absolute inset-0"
                >
                  <Image
                    src={active.image}
                    alt={active.alt}
                    fill
                    className="object-contain object-center"
                    sizes="(max-width: 640px) 90vw, 36rem"
                    priority={active.id === "seats"}
                  />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
