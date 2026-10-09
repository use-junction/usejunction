"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { csvFilename, toCsv, type CsvCell } from "@/lib/csv";
import { cn } from "@/lib/utils";

/** Downloads what the page already shows as CSV; nothing extra is fetched or sent anywhere. */
export function ExportCsvButton({
  name,
  header,
  rows,
  label = "Export CSV",
  className,
}: {
  name: string;
  header: string[];
  rows: () => CsvCell[][];
  label?: string;
  className?: string;
}) {
  function download() {
    const blob = new Blob([toCsv(header, rows())], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = csvFilename(name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Button type="button" variant="outline" size="sm" className={cn("h-9 gap-2 rounded-none text-xs font-semibold", className)} onClick={download}>
      <Download className="size-3.5" aria-hidden />
      {label}
    </Button>
  );
}
