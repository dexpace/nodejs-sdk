// SPDX-License-Identifier: MIT
// packages/transport-shared/src/drop-log.ts
import {getGlobalLogger, type LogLevel} from '@dexpace/core';

/**
 * Logging mode for dropped headers (TRANSPORT-13, OBS-19).
 *
 * @internal
 */
export type HeaderDropLogging = 'all' | 'first-per-name' | 'quiet';

/** Bound on the dedup set so an attacker synthesising distinct names cannot grow it (TRANSPORT-13, XCUT-14). */
const MAX_LOGGED_DROP_NAMES = 128;

function emitDropLog(key: string, level: LogLevel): void {
  try {
    getGlobalLogger()
      .atLevel(level)
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
 * **The mode selects a LEVEL, not merely whether a line is written** (OBS-19). `'all'` warns on
 * every occurrence; `'first-per-name'` warns the first drop of each header name and drops the rest
 * to `verbose`, which is OBS-19's default and the mode whose conformance text reads "repeatedly
 * drop the same name and assert exactly one WARN then verbose lines"; `'quiet'` writes nothing at
 * all, which is TRANSPORT-13's own third mode ("all quiet").
 *
 * Until 2026-09-02 every mode emitted at `verbose`, so the policy was configurable in name only --
 * a caller-set header vanishing before it reached the wire was indistinguishable, at any level a
 * production logger enables, from nothing having happened.
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
      if (mode === 'all') {
        emitDropLog(key, 'warning');
        continue;
      }
      const firstOfThisName = !seen.has(key);
      if (firstOfThisName) {
        seen.add(key);
        trimSeen(seen);
      }
      emitDropLog(key, firstOfThisName ? 'warning' : 'verbose');
    }
  };
}
