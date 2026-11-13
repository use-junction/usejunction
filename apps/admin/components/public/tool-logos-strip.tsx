import Image from "next/image";
import { Code2 } from "lucide-react";
import { SUPPORTED_TOOLS } from "@/lib/public/config";

const TOOL_LOGO_FILES: Record<string, string> = {
  Codex: "chatgpt.svg",
  "Claude Code": "claude.svg",
  Cursor: "cursor.svg",
  Antigravity: "antigravity.svg",
  Cline: "cline.svg",
  "Roo Code": "roo-code.svg",
  OpenCode: "opencode.svg",
  "GitHub Copilot": "copilot.svg",
  Ollama: "ollama.svg",
  "LM Studio": "lm-studio.svg",
};

export function DecorativeToolIcon({ name, size = 22 }: { name: string; size?: number }) {
  if (name === "Continue") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
        className="shrink-0 text-[#1D4ED8]"
      >
        <path
          d="m9 7-5 5 5 5m6-10 5 5-5 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  const logoFile = TOOL_LOGO_FILES[name];
  if (logoFile) {
    return (
      <Image
        src={`/tool-logos/${logoFile}`}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className="shrink-0"
      />
    );
  }

  return <Code2 size={size} aria-hidden="true" focusable="false" className="shrink-0 text-[#1D4ED8]" />;
}

/** The paid tools most teams ask about. The full list sits next to the FAQ (#tools). */
const STRIP_TOOLS = ["Claude Code", "Cursor", "Codex", "GitHub Copilot"] as const;

export function ToolLogosStrip() {
  const more = SUPPORTED_TOOLS.length - STRIP_TOOLS.length;
  return (
    <section aria-label="Supported AI coding tools" className="border-y border-border bg-white">
      <div className="mx-auto flex w-full max-w-[75rem] flex-wrap items-center gap-x-9 gap-y-3.5 px-4 py-6 text-[0.9375rem] sm:px-6">
        <p className="text-muted-foreground">Works with</p>
        <ul className="flex flex-wrap gap-x-9 gap-y-3.5">
          {STRIP_TOOLS.map((name) => (
            <li key={name} className="flex items-center gap-2.5 font-medium">
              <DecorativeToolIcon name={name} />
              <span className="whitespace-nowrap">{name}</span>
            </li>
          ))}
        </ul>
        <a href="#tools" className="border-b !border-current pb-px font-semibold transition-colors hover:text-primary">
          and {more} more
        </a>
      </div>
    </section>
  );
}
