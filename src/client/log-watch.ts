import { DEFAULT_PAGE_LIMIT } from './pager.js';

export const INCREMENTAL_CATCH_UP_WAIT_MS = 5000;

export const INCREMENTAL_EMPTY_BACKOFF_MS = [1000, 2000, 3000, 5000] as const;

export function emptyBackoffWait(streak: number): number {
  const steps = INCREMENTAL_EMPTY_BACKOFF_MS;
  if (streak >= steps.length) {
    return steps[steps.length - 1] ?? 1000;
  }
  return steps[streak] ?? 1000;
}

export function incrementalNextCursor(
  cursor: number | string,
  limitLastID: number | string | undefined,
  count: number,
  idAt: (index: number) => number | string | undefined,
): number | string {
  if (count === 0) {
    return cursor;
  }
  const cursorNum = toNumber(cursor);
  const limitNum = limitLastID === undefined ? cursorNum : toNumber(limitLastID);
  if (limitNum > cursorNum) {
    return limitLastID ?? cursor;
  }
  const last = idAt(count - 1);
  if (last === undefined) {
    return cursor;
  }
  const lastNum = toNumber(last);
  if (lastNum > cursorNum) {
    return last;
  }
  return cursor;
}

export async function sleepWithSignal(signal: AbortSignal | undefined, ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  if (signal?.aborted) {
    throw signal.reason ?? new Error('aborted');
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new Error('aborted'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export type IncrementalFetch = (
  cursor: number | string,
) => Promise<{ count: number; nextCursor: number | string }>;

export async function watchIncremental(
  signal: AbortSignal | undefined,
  startLastID: number | string,
  pageSize: number,
  fetch: IncrementalFetch,
): Promise<void> {
  let cursor = startLastID;
  let emptyStreak = 0;

  for (;;) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('aborted');
    }

    const { count, nextCursor } = await fetch(cursor);
    cursor = nextCursor;

    if (count === 0) {
      await sleepWithSignal(signal, emptyBackoffWait(emptyStreak));
      emptyStreak += 1;
      continue;
    }

    emptyStreak = 0;
    if (count >= pageSize) {
      continue;
    }
    await sleepWithSignal(signal, INCREMENTAL_CATCH_UP_WAIT_MS);
  }
}

function toNumber(value: number | string): number {
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export { DEFAULT_PAGE_LIMIT as INCREMENTAL_PAGE_SIZE };
