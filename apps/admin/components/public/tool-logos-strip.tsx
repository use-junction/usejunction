import Image from "next/image";
import { Code2 } from "lucide-react";
import { SUPPORTED_TOOLS } from "@/lib/public/config";
import { Marquee } from "@/components/shadcn-space/animations/marquee";

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
        width={28}
        height={28}
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
        width={28}
        height={28}
        className="shrink-0"
      />
    );
  }

  return (
    <Code2
      size={28}
      aria-hidden="true"
      focusable="false"
      className="shrink-0 text-[#1D4ED8]"
    />
  );
}

export function ToolLogosStrip() {
  return (
    <section aria-label="Supported AI coding tools" className="border-border bg-white py-10 sm:py-12">
      <Marquee className="[--duration:40s] [--gap:2.5rem] p-0 sm:[--gap:3.5rem]" pauseOnHover>
        {SUPPORTED_TOOLS.map((tool) => {
          return (
            <div key={tool.name} className="flex items-center gap-3">
              <DecorativeToolIcon name={tool.name} />
              <span className="whitespace-nowrap text-sm font-medium text-foreground">{tool.name}</span>
            </div>
          );
        })}
      </Marquee>
    </section>
  );
}
