---
"@dexpace/core": minor
---

`Runtime.send()` now opens one span per logical operation (OBS-29), and `createRuntime` takes an
optional context init supplying the instrumentation bundle it comes from. Additive — a runtime built
without one behaves exactly as before.

`OBS-29` requires that one tracer instance correspond 1:1 to a single logical operation. The port
had spans, but `PIPE-2` fixes the LOGGING pillar step *inside* the RETRY and REDIRECT pipelines, so
every span it opened was per transmission attempt and per redirect hop — the right scope for an
attempt, the wrong one for an operation, and nowhere for the per-attempt and retries-exhausted events
to attach. `send()` is the only place in this package that runs exactly once per logical operation,
so the operation span is opened there, outside every pillar, and the LOGGING step's spans become its
children.

```ts
const runtime = createRuntime(steps, transport, {
  instrumentation: createInstrumentationBundle(() => myTracer),
});
```

Ended exactly once, on exactly one of two paths: `end()` on success, or `recordException(error)` then
`end()` on failure — `OBS-29`'s mutually-exclusive succeeded/failed pair, under span names.

**No span is opened when one is already active.** `Runtime implements Transport` (PIPE-26), so a
runtime can be another runtime's terminal transport, and a caller may have activated a span of their
own; in both cases the outermost one is the logical operation. An empty pipeline (PIPE-9) opens none
either, since it allocates no context.

The remaining gap is the vocabulary, not the scope: the spec names `operationStarted` /
`operationSucceeded` / `operationFailed` and this port spells them as a span's lifecycle. That
shape difference is recorded in `docs/deviations.md`.
