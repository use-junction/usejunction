/**
 * Small async helpers for work that is bound by network round trips rather than CPU.
 * Node runs one thread; running independent awaits side by side is what cuts wall time.
 */

/**
 * Run `fn` over `items` with at most `limit` in flight. Items start in array order
 * (workers pull the next index from a shared cursor), results come back in array
 * order, and a rejection from `fn` rejects the whole call.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;
  const workers = Math.max(1, Math.min(Math.floor(limit), items.length));
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;
      results[index] = await fn(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export type SerialGate = <R>(work: () => Promise<R>) => Promise<R>;

/** Run callbacks one at a time, in call order, even when callers do not await each other. */
export function serialize(): SerialGate {
  let tail: Promise<unknown> = Promise.resolve();
  return (work) => {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  };
}

/** Split rows into consecutive chunks of at most `size`. */
export function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  const width = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += width) {
    chunks.push(rows.slice(index, index + width));
  }
  return chunks;
}
