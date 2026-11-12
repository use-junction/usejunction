import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { siteOgImage } from "../lib/public/seo-metadata";

function pngSize(path: string) {
  const bytes = readFileSync(path);
  assert.equal(bytes.toString("ascii", 1, 4), "PNG", `${path} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("link-preview image exists at the size the metadata declares", () => {
  const file = join(__dirname, "..", "public", siteOgImage.url);
  assert.deepEqual(pngSize(file), { width: siteOgImage.width, height: siteOgImage.height });
});

test("link-preview image is the 1200x630 card chat and social apps expect", () => {
  // The old 1404x907 homepage screenshot got cropped in WhatsApp and Slack previews.
  assert.equal(siteOgImage.width, 1200);
  assert.equal(siteOgImage.height, 630);
  // Must stay under WhatsApp's ~600 KB limit or the preview drops to text-only.
  const file = join(__dirname, "..", "public", siteOgImage.url);
  assert.ok(readFileSync(file).length < 600 * 1024);
});
