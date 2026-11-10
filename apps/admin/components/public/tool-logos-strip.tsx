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

function DecorativeToolIcon({ name }: { name: string }) {
  if (name === "Continue") {
    return (
      <svg
        width={22}
        height={22}
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
        width={22}
        height={22}
        className="shrink-0"
      />
    );
  }

  return (
    <Code2
      size={22}
      aria-hidden="true"
      focusable="false"
      className="shrink-0 text-[#1D4ED8]"
    />
  );
}

export function ToolLogosStrip() {
  return (
    <section aria-label="Supported AI coding tools" className="border-y border-border bg-white">
      <div className="mx-auto grid w-full max-w-6xl gap-3 px-4 py-6 sm:px-6 lg:grid-cols-[9rem_minmax(0,1fr)] lg:gap-6 lg:px-0 lg:py-7">
        <p className="text-sm text-muted-foreground lg:pt-0.5">Works with</p>
        <ul className="flex flex-wrap gap-x-8 gap-y-3.5">
          {SUPPORTED_TOOLS.map((tool) => (
            <li key={tool.name} className="flex items-center gap-2.5">
              <DecorativeToolIcon name={tool.name} />
              <span className="whitespace-nowrap text-[0.9375rem] font-medium text-foreground">{tool.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
