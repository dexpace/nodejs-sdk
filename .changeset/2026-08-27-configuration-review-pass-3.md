---
"@dexpace/core": patch
---

Phase 7a review pass 3 (readability and convention). No behavior changes. Two public parameter names change,
which is the whole of the `etc/core.api.md` diff:

- `Clock.sleep(ms, signal)` becomes `Clock.sleep(durationMs, signal)`. A bare `ms` is a unit with no concept
  attached, and the report carried it two lines above `composeSignal(userSignal, timeoutMs)` — the same
  package stating the same kind of quantity two different ways
  (`docs/knowledge/harvested/naming-conventions.md:36`).
- `Configuration.getDuration(key, fallback)` becomes `getDuration(key, fallbackMs)`. The accessor returns
  and accepts milliseconds, and said so only in prose while its own private collaborator is named
  `parseDurationMs`.

Positional callers are unaffected; only the name shown in editor hints and the emitted `.d.ts` changes.

The rest of the pass is documentation and test strength, with nothing observable to a consumer. The
documentation fixes worth naming, because each was a comment that had stopped matching its code:

- `Clock.sleep`'s TSDoc claimed the timer was cleared "on both the resolve and the abort path". Only the
  abort path clears a timer; the resolve path detaches the abort listener.
- `randomUuid` carried a comment describing an `unknown` widening that no longer exists, and pointed at
  `setGlobalConfiguration` for a shape it no longer shares.
- `composeHeaders`'s doc block sat on the interface declared above it, so the function was undocumented and
  the interface was described as if it wrote headers.
- Every `Configuration` and `ConfigurationBuilder` `@throws` said "when `x` is absent"; every guard is a
  `typeof` shape check, which is what the module's own comment says they are.
- The package barrel justified not exporting `deepEqual`/`deepHash` partly on "in-package consumers import
  the module directly". They have no in-package consumer, which `docs/open-items.md` G16 already recorded.
