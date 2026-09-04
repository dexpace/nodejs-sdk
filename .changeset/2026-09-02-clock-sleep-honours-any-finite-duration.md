---
"@dexpace/core": patch
---

`Clock.sleep` now honors any finite, non-negative duration by chaining timers, instead of rejecting
a duration longer than one `setTimeout` delay can carry.

`setTimeout` clamps a delay above 2^31 − 1 ms and *silently* rewrites it to `1`, so an oversized
sleep used to return in about a millisecond — an overflowed retry backoff became no backoff at all.
Phase 7a repaired that by **rejecting** any such duration with an `InvariantViolation`. That fixed
the silent clamp but created a second problem: `RETRY-18`/`RECOV-26` require a server pacing hint to
be clamped to a 365-day ceiling, roughly fourteen times what one timer can carry, so a conformant
retry could produce a delay the clock refused. `Clock.sleep` sliced into `MAX_SLEEP_MS` chunks keeps
the original intent — never a silent clamp — and honors `RETRY-18` exactly.

**Consumer-visible changes:**

- A duration above 2^31 − 1 ms now waits, where it previously rejected. Nothing that worked before
  stops working.
- A negative or non-finite duration now rejects with `RangeError` rather than the internal
  `InvariantViolation`, which was never exported and so could not be caught by class.
- A cancelled sleep now rejects with `CancellationError` carrying the caller's abort reason as
  `cause`, rather than the raw reason — the same mapping the transports and the retry engine already
  apply, so one cancellation type surfaces wherever the abort was observed. A timeout-aborted signal
  yields `TransportFailureError`, keeping `XCUT-3`'s distinction. `CFG-17`'s "re-assert the
  cancellation status" clause is unaffected: `AbortSignal.aborted` is latched, so a downstream
  handler observes the cancelled state whatever object is thrown.

**If you implement `Clock` yourself**, honor long durations too — passing `durationMs` straight to
`setTimeout` reintroduces the silent clamp. The interface's `@remarks` now says so.

Closes `docs/open-items.md` V13.
