# Phase 7b — Instrumentation & Observability — Design

**Status:** Draft, approved for planning.

**Purpose:** Implement the `Logger`/`LogEvent` structured-logging facade, the diagnostic-context (MDC) allow-list,
the redaction policy, tracing (`Tracer`/`Span`, real W3C trace-context generation), the metrics SPI, and the
`LOGGING` pillar step — satisfying `docs/product-spec/15-instrumentation-and-observability.md`'s `OBS-1`–`OBS-27`
and `OBS-30`–`OBS-40` (`OBS-19`, `OBS-28`, and `OBS-29` are deferred to Phase 8a by name — see Scope).
This is the second of two sub-phases the roadmap's Phase 7 splits into — see the
[segmentation design](./2026-07-28-phase7-segmentation-design.md). 7b trails 7a and consumes its `Configuration`
(`OBS-35`'s log-level resolution) and `CFG-14`'s log-level key constant.

**Governing documents:** `docs/product-spec/15-instrumentation-and-observability.md` (normative, cited by ID
throughout), `docs/sdk-design-nodejs/08-instrumentation-and-configuration.md` (the `Logger`/`LogEvent` no-op
default, the `@opentelemetry/api` structural-subset choice, `URL`-based redaction), the Phase 3b design (the
request/response body-logging tees this phase wires in unchanged), the Phase 4a design (`ExecutionContext`'s
`InstrumentationBundle`, whose no-op tracer factory this phase gives a real backend), and the Phase 5a/5b/5c
designs (the structured-logging and `standardResilience()` amendments this phase makes to each). Styleguide:
`styleguide/typescript/` chapters 05, 06, 08, 09, 11, 12, 13, 15.

## Scope

7b ships `OBS-1`–`OBS-27` and `OBS-30`–`OBS-40`, and closes four Deferred Items Log rows: the
`Logger`/`LogEvent` seam itself, real W3C trace-id generation (deferred from 4a), `standardResilience()`'s
`LOGGING` pillar (deferred from 5c), and redirect structured logging (deferred from 5b). A fifth item — retry's
own equivalent structured-logging gap — is closed the same way even though it was never a separate named row
(5a's design didn't flag it explicitly; it falls out of the same "`Logger` seam not built yet" reasoning 5b's
row states).

**Two `OBS-*` rows are deferred by name, not silently dropped** (both also carry Deferred Items rows below):

- `OBS-28`/`OBS-29` — the richer HTTP-shaped tracer vocabulary (per-attempt and transport-milestone events) and
  its lifecycle-ordering contract. This phase ships only `startSpan`/`end` around the whole operation.
  `OBS-29`'s own requirement text states the emission contract "is a documented emission contract; pipeline/
  transport wiring to emit it is a follow-up, so it is not yet runtime-enforced" — but the vocabulary interface
  itself must still exist for anything to be documented against, and the per-attempt events need 5a's retry
  loop and 8a's transport to have emission points. **Target: Phase 8a** (transport milestones + the interface),
  with `OBS-29`'s ordering assertions verified in Phase 9's conformance sweep.
- `OBS-19` — the dropped-header verbosity policy. The drop it reports happens inside a transport that cannot
  encode a caller-set header; `@dexpace/core` has no transport and therefore no site that can detect the drop.
  **Target: Phase 8a**, alongside the `fetch` transport that is the first component able to observe it.

**Execution-order note.** 5a's, 5b's, and 5c's plans carry Phase 7b retrofit banners whose *code* consumes this
phase's `observability/logger.ts`, `observability/redaction.ts`, and `observability/logging-step.ts`. Those
phases execute **before** 7b, so their retrofit call sites cannot be written at their own execution time
without importing a module that does not yet exist. The retrofits are therefore **applied by this phase**
(plan Task 9), not by 5a/5b/5c; each of those three plans' banners records the same rule. See the plan's
Prerequisite section.

**Key reuse, not new work.** 3b already built `withRequestLogging` (a `Body` decorator tee) and a two-regime
response-body logging wrapper in `packages/core/src/body/`, shipped `@internal` with the explicit note "unwired
until Phase 7." 7b's `LOGGING` step wires these in; it does not rebuild them. The shared preview-size cap 3b
already threads through both tees and `toHttpError()` is the same cap this phase's granularity settings expose.

Two new packages ship: `@dexpace/logging-pino` and `@dexpace/logging-debug`, both thin `Logger`-interface
adapters following the peerDependency template `package-and-dependency-layout.md` already fixes (peer on
`@dexpace/core`, peer on their respective backend library, matching `peerDependenciesMeta`). No new
package-scaffolding decision is made here — this is the same template a future `6a`'s scaffold would also follow,
already specified independent of any one phase.

## The `Logger`/`LogEvent` facade and `createLogger` (`OBS-1`–`OBS-9`, `OBS-40`)

```typescript
type LogLevel = 'error' | 'warning' | 'info' | 'verbose';

interface Logger {
  atLevel(level: LogLevel): LogEvent;     // OBS-1: decides enabled/disabled once, here
  withContext(fields: Readonly<Record<string, unknown>>): Logger;   // OBS-9, global context
}

interface LogEvent {
  field(key: string, value: unknown): this;   // OBS-3
  event(name: string): this;                  // OBS-4
  cause(error: unknown): this;
  emit(): void;                                // OBS-8: at-most-once, safe under concurrent invocation
}

interface CreateLoggerOptions {
  /** @default {} */
  readonly globalFields?: Readonly<Record<string, unknown>> | undefined;
  /** @default ['trace.id', 'span.id'] -- OBS-10; `null` folds every present key */
  readonly diagnosticAllowList?: readonly string[] | null | undefined;
  /** @default () => true */
  readonly isLevelEnabled?: ((level: LogLevel) => boolean) | undefined;
}
function createLogger(
  sink: (level: LogLevel, fields: ReadonlyMap<string, unknown>) => void,
  options?: CreateLoggerOptions,
): Logger;
```

**`@dexpace/core` ships one concrete `Logger` implementation, not just interfaces.** `Logger`/`LogEvent` are
structural, so any caller *could* implement them directly — but `OBS-5`'s three-way precedence, `OBS-40`'s
collision warning, `OBS-6`/`OBS-7`'s rendering and truncation, and `OBS-8`'s single-emit guard are real logic
with real edge cases, not something every backend should reimplement independently (the same single-source
discipline `RECOV-30`/`CFG-35` already apply elsewhere). `createLogger(sink, options?)` implements all of it
exactly once; a backend (the pino/debug bridges below, or a caller's own adapter) supplies only `sink` (where
rendered fields go) and, optionally, `isLevelEnabled` (that backend's own enabled/disabled semantics).

**The no-op default** (`NOOP_LOGGER`) is one frozen object per level-check outcome: `atLevel()` decides
enabled/disabled synchronously (no I/O, no allocation on the disabled path per `OBS-1`) and returns a shared
singleton `LogEvent` whose every builder method returns `this` and whose `emit()` is a no-op — reference-
identical across calls, so a test asserting singleton identity (`OBS-1`'s own conformance clause) is a plain
`===` check. `createLogger`'s events reuse this same singleton on the disabled path: `atLevel()` checks
`isLevelEnabled(level)` *before* building a real event, so a real backend gets `OBS-1`'s "allocates nothing
when disabled" too, not just the global no-op default.

**Precedence, rendering, and diagnostic-context folding** (`OBS-3`–`OBS-7`): per-event field > global context
(`withContext`) > folded diagnostic context, one occurrence per key, `event()` claiming the reserved `event`
key exclusively and suppressing the other two sources for it. The third tier is real, not aspirational:
`createLogger`'s event constructor seeds each new `LogEvent` from `getDiagnosticContext(diagnosticAllowList)`
(the diagnostic-context module, above) *before* layering global context on top, so a field present in both
diagnostic context and global context resolves to the global value, and a field also set via `field()` resolves
to that — precedence realized as construction order, not a separate merge step. Field-value rendering is
total: `Error` instances render as `"Name: message"`, arrays/`Map`/`Set`/plain objects get a bracketed textual
form, numeric/boolean/bigint primitives pass through type-preserving, and a value whose own
`String()`/`toString()` throws is caught and replaced with a diagnostic placeholder — never propagates. Strings
truncate at an 8 KiB default with a truncation marker; primitives are exempt.

Rendering runs on **every** field source, not just `field()`/`cause()`: global-context values are `unknown`
and a caller can hand `withContext` an object whose `toString()` throws just as easily as they can hand it to
`field()`. Seeding the constructor's map with raw values would push that throw into the backend's own
serializer, outside `OBS-20`'s containment (which wraps the emission *call site*, not the sink's internals).
Diagnostic-context values are already `string`, so rendering them is a no-op beyond truncation.

**The reserved `event` key is suppressed only when a tag is actually set** (`OBS-4`: "*when a non-empty tag is
set*, any `event` key arriving from the global context, folded diagnostic context, or a per-event field MUST be
suppressed"). With no `event()` call — or after `event('')` clears the tag — an ambient `event` key from global
context survives to the output, because `OBS-9` requires the global context on every event and nothing is
competing for the key. `event('')` clears the *tag*; it does not evict an ambient key the caller deliberately
configured.

**Reserved-key collision warning** (`OBS-40`): each `Logger` `createLogger` returns owns a one-shot gate,
consulted only when a caller's own `field()` call names the key `event` — an ambient `event` key arriving via
`withContext` or folded diagnostic context is seeded directly into the event's field map at construction, never
routed through `field()`, so it can never trip the gate (matching `OBS-40`'s "ambient event keys... defer
silently and must not be warned about"). When the gate fires (once per `Logger` instance, gated on
`isLevelEnabled('verbose')`), it emits a diagnostic event through the same `sink` at verbose level, rather than
introducing a second output channel.

**Single-emit guard** (`OBS-8`): a boolean flag checked and set before the backend call, not after — since
JavaScript has no true concurrent execution within one event's builder-call sequence (no two calls can interleave
mid-microtask on a single object without an `await` between them), the "correct under concurrent invocation"
requirement reduces to "correct across separate macrotask/microtask turns," which a plain flag already satisfies;
no lock/mutex is needed the way the JVM reference's thread-safety requirement implies.

**Failure containment** (`OBS-20`) is the caller's responsibility at the log-*emission call site*, not inside
`Logger` itself — the `LOGGING` step (below) is what wraps every emission in a catch that re-surfaces failure as
a best-effort `http.instrumentation.*` event, per `OBS-20`'s asymmetric guarantee (tracer/meter calls are never
wrapped this way).

**The pino/debug bridges build on `createLogger`, not the bare interfaces.** `createPinoLogger(instance)` and
`createDebugLogger(namespace?)` each supply only a sink (writing into `pino`/`debug`'s own API) and an
`isLevelEnabled` check (pino's `instance.isLevelEnabled`; debug's own `log.enabled` namespace flag) — neither
reimplements precedence, folding, or the collision warning. This is a direct consequence of the single-
implementation decision above: without it, `OBS-5`'s folding and `OBS-40`'s warning would need reimplementing
in every bridge, and a bridge author forgetting either would ship a conformant-looking `Logger` that silently
fails two `MUST`/`SHOULD` requirements.

## Process-wide global logger slot

```typescript
function getGlobalLogger(): Logger;      // defaults to the no-op singleton
function setGlobalLogger(logger: Logger): void;
```

Mirrors 7a's `CFG-13` global-configuration slot exactly — last-write-wins, safe publication, empty/no-op default.
**This is the mechanism that closes the retry and redirect structured-logging deferrals without touching
`StepContext`'s shape.** 5a's and 5b's steps call `getGlobalLogger()` directly at their own `SHOULD`-level
logging sites; no new field is threaded through `StepContext`, `Cursor`, or any pipeline type. The `LOGGING` pillar
step (below) accepts an explicit `logger` in its own settings, falling back to this same global slot when none is
supplied — giving a caller both a per-pipeline override and a set-once-globally convenience path, the same
two-tier pattern `Configuration`'s global slot already established.

### Amendments to 5a and 5b (doc edits, no code exists yet)

- **5a (retry)** gains two `SHOULD`-level events at its existing decision points in `engine.ts`: an attempt-failed
  event (fired each time the loop decides to retry, carrying the attempt ordinal and the computed delay) and a
  retries-exhausted event (fired once, on the terminal give-up path). Both call `getGlobalLogger().atLevel('verbose')`
  directly; no settings field, no `StepContext` change, no new parameter to `runWithRetry`.
- **5b (redirect)** gains three `SHOULD`-level events the same way: a hop event (per redirect followed, carrying
  status and target), a loop-detected event (on `REDIR-*`'s loop-cap abort), and a downgrade event (on an
  HTTPS→HTTP redirect, if the settings permit it at all).

Exact field names/vocabulary for these six events are left to plan time — `OBS-*` fixes only the `http.request`/
`http.response` names (`OBS-39`); retry/redirect logging is `SHOULD`, not `MUST`, and the spec states no fixed
vocabulary for it.

## Diagnostic context (MDC) (`OBS-10`, `OBS-23`, `OBS-24`)

```typescript
function withDiagnosticFields<T>(fields: Readonly<Record<string, string>>, fn: () => T): T;
function getDiagnosticContext(allowList: readonly string[] | null): Readonly<Record<string, string>>;
```

Backed by `node:async_hooks`'s `AsyncLocalStorage<Map<string, string>>` — the direct Node analog of a JVM
`ThreadLocal`, except `AsyncLocalStorage` already auto-propagates its store across `await`, promise chains, and
timers by construction (via `async_hooks`), which covers most of what `OBS-24`'s "bridge across async thread
boundaries" manually requires in the reference. A separate explicit snapshot/bridge helper —
`captureDiagnosticSnapshot()` / `runWithSnapshot(snapshot, fn)` — is provided only for the residual case
`AsyncLocalStorage` doesn't cover on its own: a callback invoked from outside the tracked continuation chain
entirely (e.g. a third-party callback-style API that isn't `await`ed). Default allow-list is exactly `{trace.id,
span.id}` (`OBS-10`); a `null` allow-list folds every present key; keys with `undefined` values are skipped.

`getDiagnosticContext` is not just a standalone utility — `createLogger` (above) calls it on every `atLevel()`
to realize `OBS-5`'s folded-diagnostic-context precedence tier. This module is built before `logger.ts` for
exactly that reason; see the Logger section's `createLogger` discussion.

## Redaction (`OBS-11`–`OBS-18`; `OBS-19` → Phase 8a)

Implemented directly against the global `URL` class — userinfo stripped unconditionally, query values redacted
via `url.searchParams` against an allow-list (default `{api-version}`), fragment `key=value` tokens redacted the
same way via a hand-rolled splitter (`URL` doesn't parse `hash` tokens), a fixed `[malformed url]` sentinel on any
parse/rebuild failure. Header-value URL redaction (a value that arrives as a header, e.g. `Location`) shares the
exact same redaction function as request-URL redaction — one function, two call sites, so the two paths cannot
drift (`OBS-17`'s explicit requirement). Header-*name* allow-listing (`OBS-18`) is a separate, simpler mechanism:
a fixed default allow-list of diagnostic non-credential header names, with a boolean policy for non-allow-listed
values (emit fixed `REDACTED` marker vs. omit entirely):

```typescript
type DroppedHeaderPolicy = 'mark' | 'omit';   // OBS-18's boolean policy, as a literal union (no `enum`)
function redactHeaderValue(
  name: string,
  value: string,
  policy?: DroppedHeaderPolicy,               // @default 'mark'
): string | undefined;                        // undefined === omit this header entirely
```

`'mark'` is the default because a header the caller can *see* was withheld is more diagnosable than one that
silently vanishes from the event; `'omit'` exists for callers who need the log line to stay small.

`OBS-14`'s "MUST preserve a present-but-empty query" needs care against the WHATWG `URL`: `new
URL('https://h/p?').search` is the empty string, so the trailing `?` is already lost by the time the redactor
sees a parsed `URL`. The redactor therefore takes the **raw input string** as its authority for whether a `?`
was present, not the parsed object's `.search`. This is the one place the parsed-`URL` shortcut is insufficient.

## Tracing (`OBS-21`–`OBS-27`, `OBS-30`; `OBS-28`/`OBS-29` → Phase 8a)

```typescript
interface Span {
  readonly isRecording: boolean;
  setAttribute(key: string, value: unknown): this;
  recordException(error: unknown): this;
  end(): void;                       // idempotent
}
interface Tracer {
  startSpan(name: string, options?: unknown): Span;
}

/** OBS-22: closing restores the previously-active span. `close()` over `Symbol.dispose` — see below. */
interface Scope {
  close(): void;
}
function activateSpan(span: Span): Scope;              // OBS-22
function activateSpanForCorrelation(span: Span): Scope; // OBS-23 (delegates to activateSpan when non-recording)
function getActiveSpan(): Span;                         // NOOP_SPAN when nothing is active
```

Defined as a **structural subset** of `@opentelemetry/api`'s own `Tracer`/`Span` shapes — not a bespoke
interface — per the already-settled `08-instrumentation-and-configuration.md` reasoning: Node's tracing ecosystem
has converged on one dominant API, so an application already running real OpenTelemetry auto-instrumentation
gets this SDK's spans wired in with zero adapter code, duck-typed, no dependency added to `@dexpace/core`. The
no-op default (`OBS-25`) is a frozen singleton tracer returning a frozen singleton non-recording span whose
current-scope activation is cached — selecting it allocates nothing per call.

**Real W3C trace-context generation** (`OBS-26`/`OBS-27`), closing 4a's deferral: trace ids (128-bit, 32 lowercase
hex) and span ids (64-bit, 16 lowercase hex) are generated from `globalThis.crypto.getRandomValues` — the same
cross-runtime primitive 7a's `randomUuid` uses — hex-encoded, with an all-zero draw coerced to a fixed non-zero
value (flip the last bit) so the reserved invalid sentinel (all-zero) is never produced by generation. A Datadog
flavor renders the same random bits as a 64-bit unsigned decimal string instead of hex. The no-op flavor always
yields the invalid sentinel and never calls the RNG.

**Activation and log correlation** (`OBS-22`/`OBS-23`): activating a span as current returns a scope handle with a
plain synchronous `close(): void` as its primary, supported teardown path — matching Phase 2's and 3a's precedent
of declining `Symbol.dispose`/`Symbol.asyncDispose` because both postdate the declared `>=18.17` floor
`verify-node-floor` pins. `close()` restores the previously active span, including when the guarded code throws
(a `try`/`finally` internally, not caller-managed). For a *recording*
span, activation also pushes `trace.id`/`span.id` into the diagnostic-context `AsyncLocalStorage` store for the
scope's lifetime via `withDiagnosticFields`, restoring the prior values on close; a non-recording span skips the
push entirely and just delegates to plain current-span activation.

**Closing 4a's deferred "real tracing backend" without touching 4a.** 4a's `InstrumentationBundle.activeSpan`/
`tracerFactory` are typed `unknown` deliberately, with 4a's own design doc naming this phase as their eventual
owner. Retyping those fields to `Span`/`Tracer` was considered and rejected: `InstrumentationBundle` is read by
essentially every later phase (4b, 4c, 5a–5c, 6a–6c all construct or pass through a context), so a type change
there would force 7b to build *before* 4a in execution order — a far larger inversion than the localized 5a→7a
retrofit, and not one this design accepts. Instead, this phase ships a producer-side factory,
`createInstrumentationBundle(tracerFactory?: (op: string) => Tracer): InstrumentationBundle`, which type-only
imports `InstrumentationBundle` from 4a's `context/instrumentation.js` (a normal forward dependency — 7b already
executes after 4a) and returns a real bundle: generated W3C trace/span ids, and the real `tracerFactory`/
`activeSpan` assigned into the `unknown`-typed fields (always legal on the producer side — assigning a concrete
value to an `unknown`-typed field needs no cast). A caller who wants real tracing passes this bundle's
constructor a real `Tracer` factory and uses the result wherever they'd otherwise pass
`noopInstrumentationBundle`. The one-line cast needed to *read* a real `Tracer` back out of the `unknown`-typed
field lives entirely inside 7b's own `logging-step.ts`, documented at the cast site. 4a's file is never edited.

That read is not optional decoration — it is the only thing that makes `createInstrumentationBundle` reachable
from a running pipeline, and it is what satisfies `CTX-14`/`CTX-20`'s per-operation tracer factory. The
`LOGGING` step therefore resolves its tracer in this order: `settings.tracerFactory` (an explicit
per-pipeline override) first, then the per-call `ExecutionContext`'s `instrumentation.tracerFactory` read
through the documented cast, then `NOOP_TRACER`. Without the middle tier a caller who wires a real tracer into
their context gets no spans, and the producer function has no consumer anywhere in the codebase.

## Metrics (`OBS-31`–`OBS-33`)

```typescript
interface Counter { add(delta: number, attributes?: Readonly<Record<string, unknown>>): void; }
interface Histogram { record(value: number, attributes?: Readonly<Record<string, unknown>>): void; }
interface Meter {
  createCounter(name: string, options?: { unit?: string; description?: string }): Counter;
  createHistogram(name: string, options?: { unit?: string; description?: string }): Histogram;
}
```

No-op default `Meter` returns shared singleton instruments regardless of name (discarding every measurement);
`@dexpace/core` never depends on a metrics runtime (`OBS-31`). A counter documents non-negative-only increments
but does not validate on the hot path; a histogram tolerates any input including `NaN`/`Infinity` without
throwing — non-finite handling is left to whichever concrete adapter a caller installs.

## The `LOGGING` pillar step (`OBS-34`–`OBS-39`)

```typescript
interface LoggingStepSettings {
  /** @default getGlobalLogger() */
  readonly logger?: Logger | undefined;
  /** Severity the http.request/http.response events emit at. @default 'info' */
  readonly severity?: LogLevel | undefined;
  /** @default resolved from Configuration per call via CFG_KEY_LOG_LEVEL, then 'none' (OBS-35) */
  readonly granularity?: 'none' | 'headers' | 'body' | undefined;
  /** @default 8192 -- shared with 3b's tees/toHttpError cap */
  readonly previewSizeBytes?: number | undefined;
  /** @default undefined -- falls back to the call context's tracerFactory, then NOOP_TRACER */
  readonly tracerFactory?: (() => Tracer) | undefined;
  /** @default NOOP_METER */
  readonly meter?: Meter | undefined;
  /** @default 'mark' -- OBS-18's policy for a non-allow-listed header name */
  readonly droppedHeaderPolicy?: DroppedHeaderPolicy | undefined;
  /** @default the platform clock -- CFG-15's injectable seam, so duration_ms is testable */
  readonly clock?: Clock | undefined;
}
function loggingStep(settings?: LoggingStepSettings): StepDescriptor;   // stage: 'LOGGING'
```

Note the field is `severity`, not `level`. `OBS-2`'s four severities (`error`/`warning`/`info`/`verbose`) and
`OBS-34`'s three granularities (`none`/`headers`/`body`) are different axes that both read naturally as "log
level"; `OBS-35`'s configuration key resolves the **granularity**, and an earlier draft of this interface
called the severity field `level`, which made it look like the `CFG_KEY_LOG_LEVEL` target and left it unread.

At `granularity: 'none'` (the default), no `http.request`/`http.response` events are emitted and neither 3b tee
is installed on the request/response for this call — but span start/end and counter/histogram recording still
run on **every** request regardless of granularity (`OBS-34`'s explicit "silences log events without disabling
tracing or metrics"). At `'headers'`, the events fire with header fields (redacted per the shared policy) but no
body preview. At `'body'`, both 3b tees wrap the request/response body for this call, bounded to
`previewSizeBytes`, non-buffering for a body larger than the cap (3b's existing prefix-then-live-tail behavior —
unchanged, just finally consumed). Unknown-length response bodies skip capture entirely under `'body'` (`OBS-37`)
so a slow producer can't block completion.

Granularity resolves per-call: if `settings.granularity` is set, that wins; otherwise the step reads 7a's
`Configuration` (global slot, or a config passed at pipeline-build time) via `CFG_KEY_LOG_LEVEL`, falling back
to `'none'` — `OBS-35`'s layered, tolerant, case-insensitive resolution, with no baked-in default key name (the
constant lives in 7a, not hardcoded here).

`http.response.duration_ms` is measured through 7a's `Clock` seam's monotonic reading (`CFG-15`/`CFG-16`), not
a bare `performance.now()` — a duration field asserted in a test needs a drivable clock, and `CFG-15` names
this exact class of time-dependent logic as belonging on the seam.

Emitted event names/keys are fixed per `OBS-39`: `http.request` (method, redacted `url.full`), `http.response`
(status code, duration ms, content-length/header fields; on failure, `error.type` plus the cause). The
header fields are not optional garnish — they are what distinguishes `'headers'` granularity from `'none'`, and
they are the only consumer of `OBS-17`/`OBS-18`'s `redactHeaderValue`. Each request/response header runs
through `redactHeaderValue(name, value, droppedHeaderPolicy)` and is emitted as
`http.request.header.<lowercased-name>` / `http.response.header.<lowercased-name>`, with `Content-Length`
additionally surfaced under `OBS-39`'s dedicated content-length key. A header the redactor answers `undefined`
for is omitted entirely. Every
emission site — including the tee-driving body-preview reads — is wrapped in a catch that re-surfaces failure as
a best-effort `http.instrumentation.*` event (with a swallowed secondary failure if *that* emission also throws),
per `OBS-20`. Tracer and meter calls inside the same step are **not** wrapped this way — a throwing tracer/meter
propagates and can fail the request, matching the spec's stated asymmetric guarantee exactly.

### `standardResilience()` amendment (closing 5c's deferred `LOGGING` row)

5c's preset currently installs `REDIRECT`/`RETRY`/`AUTH` and leaves `LOGGING`/`SERDE` empty. This phase amends
`standardResilience()` to also install `loggingStep(options.logging)` into the `LOGGING` slot — with default
settings (`granularity: 'none'`), so the preset stays behaviorally inert for a caller who doesn't configure
logging, while now actually installing the step so per-call/global configuration (level, granularity) takes
effect without rebuilding the pipeline. `SERDE` stays empty; no phase in this roadmap ships a `SERDE` pillar step
(serialization is consumed differently, via `@dexpace/codec-json`, not a pipeline step).

## File Layout

```
packages/core/src/observability/
  diagnostic-context.ts     # AsyncLocalStorage-backed MDC, allow-list folding, snapshot bridge -- built
                             # first, no in-package dependencies
  logger.ts                # Logger, LogEvent, createLogger, no-op default, global slot, field
                             # rendering/truncation -- imports diagnostic-context.ts for OBS-5 folding
  redaction.ts              # URL/header redaction policy
  tracing.ts                # Tracer/Span structural types, no-op defaults, W3C/Datadog/no-op id generation,
                             # createInstrumentationBundle (type-only import of 4a's InstrumentationBundle --
                             # a producer, not an edit to 4a's file; see Tracing section above)
  metrics.ts                # Meter/Counter/Histogram SPI, no-op default
  logging-step.ts           # loggingStep(settings): StepDescriptor

packages/logging-pino/src/index.ts    # createPinoLogger(pino: Pino): Logger
packages/logging-debug/src/index.ts   # createDebugLogger(namespace?: string): Logger
```

Also amends, **as this phase's own plan tasks** (see the execution-order note in Scope):
`packages/core/src/retry/engine.ts` (two `SHOULD`-level events), `packages/core/src/redirect/redirect-step.ts`
(three `SHOULD`-level events), and `packages/core/src/auth/preset.ts` (`standardResilience()`'s `LOGGING`-slot
install). Those three files are *created* by 5a/5b/5c, which execute earlier; only the logging call sites — the
parts that import from `observability/` — land here. 4a's
`context/instrumentation.ts` is **not** amended — see the Tracing section above for why, and how real tracing
flows in without it.

## Public barrel promotion

No `src/observability/index.ts` — per `docs/knowledge/module-organization.md`, barrels exist only at the
package root. Every public symbol re-exports directly from `packages/core/src/index.ts`, pointing at its
concrete file (e.g. `export {Logger} from './observability/logger.js'`), the same convention 7a follows for
`src/config/`.

Promoted: `LogLevel`, `Logger`, `LogEvent`, `createLogger`/`CreateLoggerOptions`,
`getGlobalLogger`/`setGlobalLogger`/`NOOP_LOGGER`, `Tracer`, `Span`, `Scope`, `activateSpan`/
`activateSpanForCorrelation`/`getActiveSpan`, `NOOP_TRACER`/`NOOP_SPAN`, `createInstrumentationBundle`,
`Meter`/`Counter`/`Histogram`/`NOOP_METER`, `loggingStep`/`LoggingStepSettings`/`LoggingGranularity`/
`LOGGING_STEP_TYPE`. `createLogger` must be public since the pino/debug bridge packages call it from outside
`@dexpace/core`; the `NOOP_*` singletons must be public because a caller-supplied `Tracer`/`Meter` needs
something to fall back to and a test needs an identity to assert against; `createInstrumentationBundle` must be
public because it is a caller-facing producer (the whole point is that an application builds a real bundle and
hands it in).

Staying `@internal` (no root re-export): `diagnostic-context.ts` in full, `redaction.ts` in full, and
`tracing.ts`'s `generateTraceId`/`generateSpanId`. No requirement gives a caller direct access to the MDC store
or the redaction functions; both are mechanisms the `LOGGING` step and the retrofitted retry/redirect steps use
internally. The id generators are reached only through `createInstrumentationBundle`, which is the supported
way to obtain generated ids — per `docs/knowledge/api-design.md:56`, a helper is promoted only once an outside
caller genuinely needs it, and no outside caller needs a raw id generator.

(An earlier draft of this section said the generators were "consumed only by `ExecutionContext` construction
(4a)". That was wrong in two ways: 4a executes *before* 7b and its file is never edited, so 4a cannot consume
them at all; and it named a symbol, `generateW3CTraceId`, that this design does not define — the function is
`generateTraceId(flavor)`.)

## Error Handling

No new `Error` subclass. Log-emission failure containment is a `try`/`catch` at each emission call site inside
`logging-step.ts` (and the two amended retry/redirect logging call sites), re-surfacing as an
`http.instrumentation.*` event through the same `Logger`, with a second-level swallow if that also throws.
Tracer/meter calls are deliberately left unwrapped per `OBS-20`/`OBS-30` — a conformant caller-supplied
implementation must not throw from those callbacks; this port does not add a safety net beyond the SPI contract.

## Testing

`bun test`, colocated `*.test.ts`, every file citing the `OBS-N` IDs it exercises. Reuses 5a's
`FakeTransport`/`countingResponse()` test double for the `LOGGING` step's conformance tests — no new shared test
double is built.

- **Singleton/no-op assertions** (`OBS-1`, `OBS-25`, `OBS-31`): reference-identity checks (`===`) on the
  disabled-level event, the no-op tracer's span, and the no-op meter's instruments across repeated calls, plus a
  loop asserting no allocation growth (a heap-snapshot-free proxy: constructing N events off the disabled path
  produces N references to the *same* object, checked via `===`, not distinct allocations).
- **`http.request`/`http.response` event conformance** (`OBS-39`): drive a success and a failure through
  `loggingStep()` over `FakeTransport`; assert exact event names/keys and that `url.full` is always the redacted
  form even when the raw URL carries a token.
- **Granularity independence** (`OBS-34`): at `'none'`, assert zero log events but the span still starts/ends and
  the counter/histogram still record — the negative-space half of this test (no events) is as load-bearing as
  the positive half (span/metrics still ran).
- **Body-preview cap** (`OBS-36`): send a body larger than `previewSizeBytes`; assert the caller receives every
  byte (nothing truncated on the wire) while the captured preview and reported size are both capped.
- **Header logging** (`OBS-17`, `OBS-18`, `OBS-39`): at `'headers'`, assert an allow-listed header appears with
  its value, a non-allow-listed one appears as `REDACTED` under the default `'mark'` policy and disappears
  entirely under `'omit'`, and a `Location` header carrying a query is redacted through the URL-value redactor.
- **Span activation and correlation** (`OBS-22`, `OBS-23`): assert `close()` restores the previously-active
  span including when the guarded block throws; assert a recording span's activation makes `trace.id`/`span.id`
  visible to `getDiagnosticContext` for the scope's lifetime and restores the prior values on close; assert a
  non-recording span pushes nothing.
- **Failure containment** (`OBS-20`): inject a `Logger` whose `emit()` throws; assert the request still completes
  and a best-effort `http.instrumentation.*` event fires; a separate test injects a throwing tracer/meter and
  asserts it **is not** caught — propagates and fails the request, proving the asymmetric guarantee both ways.
  A third case throws a **non-`Error`** value (`throw null`) from the transport and asserts the step still
  completes the failure path — the error-classification fields must never assume `error instanceof Error`, or
  observability throws into the request path in violation of `XCUT-20`.
- **Retry/redirect logging retrofit conformance**: install a spy `Logger` via `setGlobalLogger`; drive a
  `503,503,200` sequence through 5a's retry step and assert the two `SHOULD`-level events fire with the expected
  ordinals; drive a cross-origin redirect through 5b's step and assert the hop event fires.

Property tests (fast-check), same totality approach 5a/7a used:

- **Redaction functions** — never throw for any string input (malformed URL, arbitrary header value); a
  well-formed URL's scheme/host/port/path survive redaction byte-for-byte.
- **Field-value rendering** — never throws for any value, including one whose `toString()` throws, a `Symbol`,
  a `BigInt`, a cyclic object, and a `null`-prototype object; every rendered string is at or under the 8 KiB
  cap; a `Map`/`Set` renders to a bracketed form that contains its entries rather than an empty `{}`.
- **Trace/span id generation** — every generated id is the correct hex/decimal length and never the all-zero
  sentinel, across a large sample.

## Deviation Ledger (for Phase 10)

| Deviation | Reference behavior | Justification |
|---|---|---|
| Retry/redirect structured logging carries no fixed event vocabulary | Reference presumably has its own established event names for these `SHOULD`-level cases | `§15` fixes only `http.request`/`http.response` (`OBS-39`); no ID names a retry/redirect event vocabulary, so this port picks names at plan time rather than inventing a spurious "requirement" |
| `Tracer`/`Span` structural-subset of `@opentelemetry/api`, no bespoke interface | A dedicated `Tracer`/`Span` SPI | Already the settled `08-instrumentation-and-configuration.md` choice; restated here for `OBS-*`'s own conformance sweep |
| `AsyncLocalStorage` auto-propagation covers most of `OBS-24`'s manual bridge requirement; an explicit snapshot helper exists only for the residual out-of-continuation case | Manual capture/reinstall/restore on every async boundary | Node's `async_hooks`-backed `AsyncLocalStorage` already does this automatically for `await`/promise chains/timers; re-implementing a manual bridge for the covered cases would be redundant, not more correct |
| No JVM-style executor/thread-pool vocabulary anywhere in this phase | N/A | Consistent with 7a's own equivalent Deviation Ledger row — no executor concept in this port |
| `@dexpace/core` takes its first `node:` import (`node:async_hooks`), scoped to `diagnostic-context.ts` | Core is otherwise runtime-agnostic (the same stance that chose `globalThis.performance.now()` over `process.hrtime`, and `globalThis.crypto` over `node:crypto`) | `AsyncLocalStorage` has no cross-runtime equivalent and `OBS-23`/`OBS-24` are unimplementable without one. Recorded here, not only as a plan-level Global Constraint, because it narrows where `@dexpace/core` can run and Phase 10 must see it. Deno and Bun both implement `node:async_hooks`; a browser/Workers build would need a shim |
| Span activation scope teardown is `close()`, not `Symbol.dispose` | `try`-with-resources / `using` | Same precedent Phase 2 and 3a set: `Symbol.dispose` postdates the `>=18.17` floor `verify-node-floor` pins. Revisit with the floor |

## Deferred Items (add to the roadmap's Deferred Items Log)

| Item | Originated in | Target | Reason |
|---|---|---|---|
| Retry/redirect structured-logging event names/fields | 7b brainstorm | Phase 7b plan time | No spec-fixed vocabulary exists for these `SHOULD`-level events; naming is a plan-time detail, not a design-level decision |
| `OBS-28`/`OBS-29` — the richer HTTP-shaped tracer vocabulary (operation/attempt/transport-milestone events) and its lifecycle-ordering contract | 7b design | **Phase 8a** (interface + transport milestones), ordering assertions in **Phase 9** | The per-attempt events need 5a's retry loop and the transport milestones need 8a's `fetch` transport as emission points; `@dexpace/core` at 7b has neither. `OBS-29`'s own text records that runtime enforcement is a follow-up. 7b ships operation-level `startSpan`/`end` only, which is what `OBS-21`–`OBS-25` require |
| `OBS-19` — the dropped-header verbosity policy (WARN-every / WARN-first-per-name / verbose-only) | 7b design | **Phase 8a** | The drop it reports is a transport failing to encode a caller-set header. Core has no transport, so no site can detect it. Ships with the `fetch` transport that first can |
| Whether `standardResilience()` should also accept a `tracerFactory`/`meter` pass-through convenience, vs. requiring a caller to set them at pipeline-build time separately | 7b brainstorm | Phase 9 (conformance sweep) or a future preset revision | No requirement mandates preset-level convenience wiring beyond installing the `LOGGING` step itself; revisit if Phase 9 finds friction |
| A real `@opentelemetry/sdk-metrics`-backed `Meter` adapter package | 7b brainstorm | Not scheduled | `OBS-31` only requires the no-op default and that core not depend on a metrics runtime; no package in the roadmap's phase table ships a concrete metrics backend, unlike tracing's duck-typed zero-adapter path — a caller wanting real metrics wires their own `Meter` implementation against the published interface |
