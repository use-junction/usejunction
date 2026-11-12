import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildVerificationUrl,
  describeDeviceOs,
  formatUserCode,
  generateUserCode,
  normalizeUserCode,
} from "@/lib/device-auth";

test("user codes are eight consonants and survive how people type them", () => {
  for (let index = 0; index < 50; index += 1) {
    const code = generateUserCode();
    assert.match(code, /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/);
    assert.equal(normalizeUserCode(formatUserCode(code)), code);
    assert.equal(normalizeUserCode(` ${formatUserCode(code).toLowerCase()} `), code);
  }
  assert.equal(formatUserCode("KQRTBXWM"), "KQRT-BXWM");
  assert.equal(normalizeUserCode("kqrt bxwm"), "KQRTBXWM");
});

test("anything that is not a complete code is rejected", () => {
  assert.equal(normalizeUserCode(null), null);
  assert.equal(normalizeUserCode(""), null);
  assert.equal(normalizeUserCode("KQRT"), null);
  assert.equal(normalizeUserCode("KQRT-BXWM-ZZ"), null);
  // Vowels are never issued, so a code containing one cannot be real.
  assert.equal(normalizeUserCode("KQRT-AXWM"), null);
});

test("the link the terminal prints opens the approval page with the code filled in", () => {
  assert.equal(
    buildVerificationUrl("KQRTBXWM", "https://usejunction.dev/"),
    "https://usejunction.dev/connect?code=KQRT-BXWM",
  );
});

test("the approval page names the operating system the way people do", () => {
  assert.equal(describeDeviceOs("darwin"), "macOS");
  assert.equal(describeDeviceOs("windows"), "Windows");
  assert.equal(describeDeviceOs("linux"), "Linux");
  assert.equal(describeDeviceOs("freebsd"), "freebsd");
});
