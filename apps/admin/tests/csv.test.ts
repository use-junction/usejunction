import { expect, test } from "vitest";
import { microsToDollarsCell, toCsv } from "@/lib/csv";

test("csv quotes commas and quotes, and neutralises spreadsheet formulas", () => {
  const csv = toCsv(["Name", "Value"], [
    ['Ada, "the" first', 1],
    ["=HYPERLINK(\"http://x\")", -2],
    ["+cmd", null],
  ]);
  expect(csv).toBe('Name,Value\r\n"Ada, ""the"" first",1\r\n"\'=HYPERLINK(""http://x"")",-2\r\n\'+cmd,\r\n');
});

test("micros become dollars with two decimals", () => {
  expect(microsToDollarsCell("20000000")).toBe("20.00");
  expect(microsToDollarsCell(null)).toBe("");
});
