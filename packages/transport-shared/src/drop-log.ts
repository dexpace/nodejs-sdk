// SPDX-License-Identifier: MIT
// packages/transport-shared/src/drop-log.ts
import {getGlobalLogger} from '@dexpace/core';

/**
 * Logging mode for dropped headers (TRANSPORT-13).
 *
 * @internal
 */
export type HeaderDropLogging = 'all' | 'first-per-name' | 'quiet';

/** Bound on the dedup set so an attacker synthesising distinct names cannot grow it (TRANSPORT-13, XCUT-14). */
const MAX_LOGGED_DROP_NAMES = 128;

function emitDropLog(key: string): void {
  try {
    getGlobalLogger()
      .atLevel('verbose')
      .event('http.header.dropped')
      .field('header', key)
      .emit();
  } catch {
    // OBS-20: logger failure must never fail the request
  }
}

/**
 * Evicts the oldest name once the set has outgrown its bound. One eviction per insert is enough
 * precisely because this runs on every insert -- the set can only ever be one over the cap.
 */
function trimSeen(seen: Set<string>): void {
  if (seen.size > MAX_LOGGED_DROP_NAMES) {
    const first = seen.values().next().value;
    if (first !== undefined) {
      seen.delete(first);
    }
  }
}

/**
 * Creates a drop logger function adhering to the requested logging mode and bounded dedup policy.
 *
 * @internal
 */
export function createDropLogger(
  mode: HeaderDropLogging,
): (dropped: readonly string[]) => void {
  if (mode === 'quiet') {
    return () => undefined;
  }
  const seen = new Set<string>();
  return (dropped: readonly string[]) => {
    for (const name of dropped) {
      const key = name.toLowerCase();
      if (mode === 'first-per-name' && seen.has(key)) {
        continue;
      }
      if (mode === 'first-per-name') {
        seen.add(key);
        trimSeen(seen);
      }
      emitDropLog(key);
    }
  };
}
