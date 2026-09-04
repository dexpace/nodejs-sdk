---
"@dexpace/core": patch
---

Close the public numeric range checks that guarded only their lower bound, completing the sweep
`docs/work/mvp/2026-09-04-open-items-dissolution.md` P2 asked for.

- `RequestOptionsBuilder.timeoutMs` now rejects `Infinity` and `NaN`. It previously rejected only
  `<= 0`, so a non-finite deadline degraded silently to "no deadline" instead of failing at the call
  site that supplied it (HTTP-35). Fractional milliseconds are still accepted — a timeout is a
  duration, not a count.
- `retrySettings`'s `multiplier` now rejects a non-finite value. `Infinity >= 1` passed, and made
  the second backoff delay `Infinity`.
- `retrySettings`'s `maxAttempts` now requires an integer. `2.5` passed a `Number.isFinite` check
  and is not a count of wire sends.
Retry durations are deliberately **not** given an upper bound. An earlier revision of this change
bounded `initialDelayMs`/`maxDelayMs`/`fixedDelayMs` at `Clock`'s `MAX_SLEEP_MS`, because
`Clock.sleep` rejected anything longer; `Clock.sleep` now chains timers to honor any finite duration
(see the separate clock changeset), so such a bound would reject a wait the platform can perform —
and would make `RETRY-18`'s 365-day pacing ceiling unconfigurable.

The sweep's full result, including the surfaces found already whole (`HttpRange`,
`redirectSettings.maxHops`, the auth margins, `Paginator.maxPages`, `ContextStore`'s cap), is
recorded in P2's note.
