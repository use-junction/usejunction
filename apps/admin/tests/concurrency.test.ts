import assert from "node:assert/strict";
import { test } from "vitest";
import { chunkRows, mapWithConcurrency, serialize } from "@/lib/concurrency";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("mapWithConcurrency keeps at most `limit` items in flight and returns results in order", async () => {
  const gates = [0, 1, 2, 3, 4].map(() => deferred<void>());
  let inFlight = 0;
  let highWater = 0;
  const started: number[] = [];
  const run = mapWithConcurrency([10, 20, 30, 40, 50], 2, async (item, index) => {
    started.push(index);
    inFlight += 1;
    highWater = Math.max(highWater, inFlight);
    await gates[index]!.promise;
    inFlight -= 1;
    return item * 2;
  });
  await Promise.resolve();
  assert.deepEqual(started, [0, 1], "only two items start before any finishes");
  gates[1]!.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started, [0, 1, 2], "finishing one item starts the next in order");
  gates[0]!.resolve();
  gates[2]!.resolve();
  gates[3]!.resolve();
  gates[4]!.resolve();
  const results = await run;
  assert.deepEqual(results, [20, 40, 60, 80, 100]);
  assert.equal(highWater, 2);
});

test("mapWithConcurrency handles a limit above the item count, empty input, and rejections", async () => {
  assert.deepEqual(await mapWithConcurrency([1, 2], 10, async (item) => item + 1), [2, 3]);
  assert.deepEqual(await mapWithConcurrency([], 3, async () => 1), []);
  await assert.rejects(
    mapWithConcurrency([1, 2, 3], 2, async (item) => {
      if (item === 2) throw new Error("boom");
      return item;
    }),
    /boom/,
  );
});

test("serialize runs callbacks one at a time in call order, even after a failure", async () => {
  const gate = serialize();
  const order: string[] = [];
  const first = deferred<void>();
  const a = gate(async () => { order.push("a:start"); await first.promise; order.push("a:end"); return "a"; });
  const b = gate(async () => { order.push("b"); return "b"; });
  const failed = gate(async () => { throw new Error("nope"); });
  const c = gate(async () => { order.push("c"); return "c"; });
  await Promise.resolve();
  assert.deepEqual(order, ["a:start"], "b waits for a");
  first.resolve();
  assert.equal(await a, "a");
  assert.equal(await b, "b");
  await assert.rejects(failed, /nope/);
  assert.equal(await c, "c", "a rejection does not block later work");
  assert.deepEqual(order, ["a:start", "a:end", "b", "c"]);
});

test("chunkRows splits into consecutive chunks of at most the given size", () => {
  assert.deepEqual(chunkRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkRows([1, 2], 5), [[1, 2]]);
  assert.deepEqual(chunkRows([], 3), []);
  assert.deepEqual(chunkRows([1, 2, 3], 0), [[1], [2], [3]], "a size below one falls back to single rows");
});
