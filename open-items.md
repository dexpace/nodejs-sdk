# Open Items — Phase 5a (Retry)

Findings from the Phase 5a code review (passes 1–3, 2026-08-26) that were **deliberately not fixed**,
each with the reason and the owner. Everything here is either correct-but-surprising behavior worth
pinning down, a limitation the platform imposes, or a defect whose fix belongs to another phase.

Findings that *were* fixed are not listed — they are in the code and its tests. This file is only for
what is still open.

**Status legend:** 🔴 defect, owner named — 🟡 accepted limitation — 🟢 correct, documented to stop a
future "fix" — 📄 documentation drift.

---

## 🔴 `toHttpError`'s `finally` can let a teardown failure mask the drain failure

**Where:** `packages/core/src/body/http-status-error.ts:106-109` (Phase 3b)

```ts
} finally {
  reader?.releaseLock();
  await response.close();
}
```

`Response.close()` documents `@throws Whatever cancelling the body stream raises, other than the
TypeError a locked stream reports`. Awaiting it in a bare `finally` means a teardown failure replaces
whatever the `try` was propagating — the inversion `RECOV-12` forbids and `suppress()` exists to
prevent (`packages/core/src/suppress.ts` says so in its own doc comment, about native `using`).

**Why it is not urgent:** cancelling an *errored* `ReadableStream` rejects with the stream's stored
error rather than invoking the source's `cancel` hook, so on the common path `close()` rethrows the
very error already propagating and the masking is unobservable. It becomes observable only for a
stream whose `cancel` hook fails independently of the read that failed.

**Why it is not fixed here:** shipped Phase 3b code with its own tests, outside 5a's scope. Phase 5a
fixed the same shape at its own call site (`retry/engine.ts`'s `releaseQuietly` /
`withReleaseFailure`), which is what made the upstream instance visible.

**Owner:** Phase 10 (Deviation Reconciliation), or a Phase 3b follow-up.

---

## 🔴 `RequestOptionsBuilder.maxRetries` — fixed here, but the pattern deserves a sweep

**Where:** `packages/core/src/http/request-options.ts` (Phase 1)

Fixed in this phase (see `.changeset/2026-08-26-max-retries-range-check.md`): the setter rejected only
`value < 0`, so `Infinity`, `NaN`, and fractions reached a consumer as a retry budget that never
terminates.

**What is still open:** the *class* of bug, not this instance. `timeoutMs` next door has the same
shape — it rejects `<= 0` and accepts `Infinity`/`NaN`. A non-finite timeout is less dangerous than a
non-finite retry ceiling (it degrades to "no deadline" rather than "never stop"), but it is the same
gap in the same requirement (`HTTP-35`), and no other numeric public setter has been audited.

**Owner:** Phase 10, as a sweep over every public numeric setter — is the range check the full range,
or only its lower bound?

---

## 🟡 `RetrySettings.retryableStatuses` is immutable by type, not at runtime

**Where:** `packages/core/src/retry/settings.ts`

`retrySettings()` returns `Object.freeze({...})`, but freeze is shallow and does not seal a `Set`'s
internal slots: anyone holding the settings object can still call `.add()` on the status set and
change policy for every later call.

`RECOV-34`'s actual requirement — a *defensive copy* so a caller mutating **their own** source
collection cannot alter policy — is satisfied and tested. What is not achievable is `RETRY-42`'s
"immutable after construction" as a runtime guarantee.

This is a deliberate house position, not an oversight: `config/retryable.ts` records it — *"`Object.freeze`
does not seal a `Set`'s internal slots, so a frozen `Set` would be a misleading no-op — typed
`ReadonlySet` instead, same treatment as Phase 1's `IDEMPOTENT_METHODS`."* A genuine runtime guarantee
would need a wrapper object with no mutators, which changes the shape every consumer reads.

**Owner:** none. Recorded so the gap between the type-level and runtime guarantee is not rediscovered
as a bug.

---

## 🟡 `RETRY-18`'s 365-day pacing ceiling is spec-mandated and operationally hazardous

**Where:** `packages/core/src/retry/pacing.ts`

A server that sends `X-RateLimit-Reset` in **milliseconds** instead of epoch seconds — a common
server-side mistake — produces a delta of roughly 56,000 years. `RETRY-18`/`RECOV-26` require
clamping to a 365-day ceiling, so the parser returns exactly that: a retry parked for a year, which
is indistinguishable from a hang.

Nothing shortens it by default. `totalTimeoutMs` would, but `RETRY-28` makes it explicitly opt-in and
it is `undefined` by default. The caller's own `AbortSignal` is the only other exit.

Implementing a tighter ceiling would be a deviation from a MUST, so the port complies. Recorded
because "spec-compliant" and "safe by default" diverge here, and the mitigation (set
`totalTimeoutMs`) is a caller decision that needs documenting when the retry surface is finally
published in Phase 5c.

**Owner:** Phase 5c, as a documentation obligation on the public retry surface.

---

## 🟡 `parsePacingHint` reads only the first value of a repeated header

**Where:** `packages/core/src/retry/pacing.ts`

`Headers.get()` returns the first value. Given `Retry-After: garbage` followed by `Retry-After: 5`,
the parser tries `garbage`, fails, falls through the remaining header names, and returns `null` — no
hint, fall back to backoff — rather than trying the second value.

Safe (`RETRY-16`'s fallback is the conservative answer) and arguably correct, since a repeated
`Retry-After` is malformed to begin with. `RETRY-21`'s precedence is defined across header *names*,
not across duplicate values of one name, so nothing requires the second value to be tried.

**Owner:** none. Recorded because "first usable value wins" reads, on a fast skim of `RETRY-21`, like
it should scan duplicates too.

---

## 🟢 A fixed delay is deliberately not clamped to `maxDelayMs`

**Where:** `packages/core/src/retry/backoff.ts`

`computeDelay` returns `fixedDelayMs` before the cap is applied, so `fixedDelayMs: 3_600_000` with
`maxDelayMs: 8000` waits an hour. This looks like a missed clamp and is not: `RETRY-43` describes the
mode as *"zeroing the base and cap so only the fixed delay applies"* — the cap is part of the schedule
this mode replaces, not a bound that outlives it.

Documented in the field's own TSDoc. Listed here so a future reviewer reaches the reasoning before
"fixing" it.

---

## 🟢 A response that ends the retry loop is handed over live, not closed

**Where:** `packages/core/src/retry/engine.ts`

`RETRY-32` says *"any response that arrives from an already-in-flight attempt MUST be closed rather
than leaked."* The engine closes every response it **discards**. A response that survives the gates —
attempt cap reached, budget spent, status not retryable — is returned **live and unread**, even when
the caller has already aborted.

That is not a leak: ownership transfers to the caller, which is the only reader that could close it,
and a `Promise` always resolves to its awaiter, so this port has no "value that can never be
delivered" case for the reference's orphan rule to bite on. Both halves are asserted.

The narrowing is inseparable from `RETRY-36`'s disposition (`toHttpError` drains the body and drops
the headers irreversibly, and 4c's pillar signature must return a `Response`), which the phase design
already ledgers.

---

## 📄 The Phase 5a design doc overstates the `RETRY-32` guarantee

**Where:** `docs/superpowers/specs/2026-07-26-phase5a-retry-design.md`, "The wait"

> `RETRY-32`: once the caller's signal is aborted the driver launches no further attempts, and any
> response arriving from an in-flight attempt is closed rather than leaked.

The second clause describes only responses the engine discards — see the item above. The
implementation checklist carries the corrected wording; the design doc still carries the blanket
claim, and was left alone because it is a phase design of record, not a working document.

**Owner:** Phase 9 (cross-cutting conformance), which reads these documents as its source.

---

## 📄 Phase 7b still owes `engine.ts` two log events

**Where:** `packages/core/src/retry/engine.ts` (head comment)

`RETRY-40`'s "log the failure" clause and the two `SHOULD`-level structured events
(`retry.attemptFailed`, `retry.exhausted`) are specified in 5a's plan but written by Phase 7b Task 9 —
5a executes before 7b, and 7b depends on 5a's `FakeTransport`, so the cycle can only be broken in this
direction. The non-fatal half of `RETRY-40` **is** implemented here.

Already recorded in the roadmap's Deferred Items Log; repeated here so this file is a complete picture
of what Phase 5a knowingly left undone.

**Owner:** Phase 7b, Task 9.
