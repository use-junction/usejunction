export type CsvCell = string | number | bigint | boolean | null | undefined;

/**
 * Cells a spreadsheet would run as a formula (=, +, -, @, tab, CR) get a leading quote so an
 * exported name or tool label can never execute in Excel or Sheets. Plain numbers stay numeric.
 */
function cell(value: CsvCell) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: CsvCell[][]) {
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Dollars with two decimals from micros, for spreadsheet columns. */
export function microsToDollarsCell(micros: string | bigint | null | undefined) {
  if (micros === null || micros === undefined) return "";
  return (Number(BigInt(micros)) / 1_000_000).toFixed(2);
}

export function csvFilename(base: string, date = new Date()) {
  return `usejunction-${base}-${date.toISOString().slice(0, 10)}.csv`;
}
