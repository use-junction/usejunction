import Image from "next/image";
import {
  Calendar,
  Coins,
  Cpu,
  Globe,
  KeyRound,
  Keyboard,
  MonitorCheck,
  Network,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { siteConfig } from "@/lib/public/config";

/** Mirrors "What UseJunction measures" / "What it does not measure" in llms.txt. */
const SENT: { icon: LucideIcon; label: string }[] = [
  { icon: Cpu, label: "Tools and models used" },
  { icon: Coins, label: "Tokens and estimated cost" },
  { icon: Calendar, label: "Plan cycle and seat usage" },
  { icon: KeyRound, label: "Personal or company login" },
  { icon: MonitorCheck, label: "Device health" },
];

const STAYS: { icon: LucideIcon; label: string }[] = [
  { icon: Keyboard, label: "Keystrokes or screenshots" },
  { icon: Globe, label: "Browser activity" },
  { icon: Network, label: "Network traffic" },
  { icon: Timer, label: "Time in the editor" },
];

const MACHINE_TOOLS = ["claude.svg", "cursor.svg", "chatgpt.svg", "copilot.svg"];

/** What stays on a developer's machine, what the local agent sends, and where it lands. */
export function HomePrivacyFlow() {
  return (
    <section aria-labelledby="home-privacy-heading" className="bg-white pt-24 sm:pt-32 lg:pt-44">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
          <h2 id="home-privacy-heading" className="text-[1.6rem] font-semibold leading-tight tracking-[-0.025em] sm:text-[1.95rem]">
            Your developers will ask what it collects.
          </h2>
          <a
            href={siteConfig.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start border-b !border-current pb-px text-[0.9375rem] font-semibold transition-colors hover:text-primary sm:self-auto"
          >
            Read the code on GitHub
          </a>
        </div>

        <div className="mt-8 grid lg:mt-[3.25rem] lg:grid-cols-[25rem_minmax(0,1fr)_17.5rem]">
          <div className="border-[1.5px] !border-foreground bg-[var(--public-bg)] p-6 sm:p-7">
            <p className="text-[1.0625rem] font-semibold">A developer’s machine</p>
            <p className="mt-3.5 flex gap-3 border-b border-border pb-5">
              {MACHINE_TOOLS.map((file) => (
                <Image key={file} src={`/tool-logos/${file}`} alt="" width={24} height={24} aria-hidden />
              ))}
            </p>
            <p className="mt-[18px] text-[0.8125rem] font-semibold text-muted-foreground">Never leaves the machine</p>
            <ul aria-label="Never collected">
              {STAYS.map((item) => (
                <li key={item.label} className="flex items-center gap-3 py-2 text-[0.9375rem] text-[#8b8d85]">
                  <span className="relative inline-flex text-[#a3a59d]" aria-hidden>
                    <item.icon className="size-5" strokeWidth={1.7} />
                    <span className="absolute -inset-x-0.5 top-1/2 h-0.5 -rotate-[38deg] bg-foreground" />
                  </span>
                  {item.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative ml-6 flex flex-col justify-center border-l-2 !border-primary py-7 pl-6 lg:ml-0 lg:border-l-0 lg:px-11">
            <span aria-hidden className="absolute left-0 right-2.5 top-1/2 hidden h-0.5 bg-primary lg:block" />
            <span
              aria-hidden
              className="absolute right-0 top-1/2 -mt-2 hidden border-y-8 border-l-[12px] !border-y-transparent !border-l-primary lg:block"
            />
            <p className="relative mb-2.5 self-start bg-white pr-2 text-[0.8125rem] font-semibold text-muted-foreground">
              The local agent sends
            </p>
            <ul aria-label="Collected" className="relative grid gap-2">
              {SENT.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center gap-3 border !border-[#bfe0e5] bg-[#e6f3f5] px-3.5 py-2.5 text-[0.9375rem] font-medium"
                >
                  <item.icon className="size-5 shrink-0 text-primary" strokeWidth={1.7} aria-hidden />
                  {item.label}
                </li>
              ))}
            </ul>
            <p className="relative mt-2.5 border-[1.5px] border-dashed !border-[var(--public-warning)] bg-white px-3.5 py-2.5 text-sm leading-snug">
              Each person can switch off sharing for any of their logins.
            </p>
          </div>

          <div className="flex flex-col justify-center border-[1.5px] !border-foreground bg-brand-yellow-pale p-6 sm:p-7">
            <Image src="/usejunction.png" alt="UseJunction" width={170} height={41} className="h-auto w-[170px]" />
            <p className="mt-3.5 text-[0.9375rem] leading-relaxed">Hosted by us, or on your own server.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
