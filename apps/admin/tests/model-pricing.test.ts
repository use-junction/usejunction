import { describe, expect, test } from "vitest";
import { estimateCost, rateForModel } from "@/lib/metrics/estimate-cost";

describe("current model rate card", () => {
  const generic = rateForModel("claude");

  test("claude-opus-5-5 uses Opus 5.5 rates, not the generic claude row", () => {
    const rate = rateForModel("claude-opus-5-5");
    expect(rate).toEqual({ inputPer1M: 4, outputPer1M: 20, cacheReadPer1M: 0.2, cacheWritePer1M: 5 });
    expect(rate).not.toEqual(generic);
    expect(rateForModel("claude-opus-5")).toEqual({ inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25 });
  });

  test("claude-sonnet-5-5 and claude-sonnet-5 use Sonnet 5 rates", () => {
    const sonnet55 = rateForModel("claude-sonnet-5-5");
    expect(sonnet55).toEqual({ inputPer1M: 2, outputPer1M: 10, cacheReadPer1M: 0.2, cacheWritePer1M: 2.5 });
    expect(sonnet55).not.toEqual(generic);
    expect(rateForModel("claude-sonnet-5")).toEqual(sonnet55);
  });

  test("claude-fable-5-1 cache read is $0.25/M", () => {
    expect(rateForModel("claude-fable-5-1").cacheReadPer1M).toBe(0.25);
    expect(rateForModel("claude-fable-5-1")).toEqual({ inputPer1M: 10, outputPer1M: 50, cacheReadPer1M: 0.25, cacheWritePer1M: 12.5 });
  });

  test("claude-haiku-5-5 and previous-generation ids keep their own rows", () => {
    expect(rateForModel("claude-haiku-5-5")).toEqual({ inputPer1M: 0.1, outputPer1M: 0.5, cacheReadPer1M: 0.01, cacheWritePer1M: 0.125 });
    expect(rateForModel("claude-opus-4-8")).toEqual({ inputPer1M: 5, outputPer1M: 25, cacheReadPer1M: 0.5, cacheWritePer1M: 6.25 });
    expect(rateForModel("claude-sonnet-4-5-20250929")).toEqual(generic);
  });

  test("gpt-6 family uses OpenAI published rates", () => {
    expect(rateForModel("gpt-6-astra")).toEqual({ inputPer1M: 10, outputPer1M: 50, cacheReadPer1M: 1, cacheWritePer1M: 0 });
    expect(rateForModel("gpt-6-sol")).toEqual({ inputPer1M: 2, outputPer1M: 10, cacheReadPer1M: 0.2, cacheWritePer1M: 0 });
    expect(rateForModel("gpt-6.1-sol")).toEqual({ inputPer1M: 2, outputPer1M: 10, cacheReadPer1M: 0.1, cacheWritePer1M: 0 });
    expect(rateForModel("gpt-6-luna")).toEqual({ inputPer1M: 0.1, outputPer1M: 0.5, cacheReadPer1M: 0.01, cacheWritePer1M: 0 });
  });

  test("claude cost uses full input plus cache buckets at the model's rates", () => {
    // 1M input + 1M output + 1M cache read + 1M cache write on Opus 5.5 = 4 + 20 + 0.2 + 5.
    expect(estimateCost("claude-opus-5-5", 1_000_000, 1_000_000, 1_000_000, 1_000_000, "claude")).toBeCloseTo(29.2, 9);
  });
});
