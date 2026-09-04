# Phase 7a — Configuration & Platform Primitives — Design

**Status:** Draft, approved for planning.

**Purpose:** Implement the layered configuration model, the `Clock`/async primitives, the proxy model, RFC 1123
dates, UUID generation, deep equality, the retryability classifier, the build/runtime version descriptor, and the
client-identity header step — satisfying `docs/product-spec/16-configuration.md` (`CFG-1`–`CFG-38`), `NFR-15`
(self-identifying version metadata), and `RECOV-33` (client-identity step, appendix C). This is the first of two
sub-phases the roadmap's Phase 7 ("Instrumentation & Configuration") splits into — see the
[segmentation design](../2026-07-28-phase7-segmentation-design.md). 7a leads; 7b (Observability, `§15`) trails and
consumes this phase's `Configuration`/`CFG-14` key constant for its log-level resolution (`OBS-35`).

**Governing documents:** `docs/product-spec/16-configuration.md` (normative, cited by ID throughout),
`docs/product-spec/appendix-c-consolidated-normative-requirement-index.md` (`RECOV-33`), `docs/product-spec/20-non-functional-requirements-and-quality-bar.md`
(`NFR-15`), `docs/sdk-design-nodejs/08-instrumentation-and-configuration.md` §"Configuration layering" (the
three-tier collapse, the `performance.now()` choice, the hand-rolled ISO-8601 parser), the Phase 5a design (the
`pacing.ts` RFC 1123 parser and `clock`/`random` injection point this phase retrofits). Styleguide:
`styleguide/typescript/` chapters 05, 06, 08, 09, 11, 12, 13, 15.

## Scope

7a ships every `CFG-*` requirement, `NFR-15`, and `RECOV-33`. It does **not** ship any `OBS-*` requirement — the
`Logger`/`LogEvent` seam, tracing, metrics, and the `LOGGING` pillar step are 7b's. `RECOV-33` ships here despite
living beside retry/auth conceptually, for the reason 5a's own design already gave: it is configuration-driven
header composition with zero retry coupling, and its token source (`CFG-36`'s build/runtime descriptor) is a 7a
deliverable.

Three retrofits to 5a's (written, unexecuted) design and plan are part of this phase's deliverable, not incidental
cleanup — all three are single-sourcing corrections the project's own discipline (`RECOV-30`, `CFG-35`) already
requires:

1. **`Clock` retrofit.** 5a's `RetryConfig` currently types its wait-timing dependency as an ad hoc `now: () =>
   number` / `random: () => number` pair, with its own design noting these are "the same injectable-determinism
   seam `CFG-15` wants for the clock." 7a formalizes that seam; 5a's design/plan are amended so
   `RetryConfig.clock: Clock` replaces the bespoke `now`, with `random` unchanged (the `Clock` seam has no
   randomness primitive — jitter's random source stays a sibling field).
2. **RFC 1123 parser retrofit.** 5a's `pacing.ts` hand-rolled an RFC 1123 date parser for `Retry-After` (tolerant
   of an informational weekday and single-digit day, per `RETRY-15`). 7a's `http-date.ts` is a superset — it adds
   the *formatter* `CFG-29` needs, which 5a never built — and 5a's `pacing.ts` is amended to import
   `parseHttpDate` from it instead of keeping a private copy.
3. **Retryability-classifier retrofit.** 5a's `classify.ts` defined `RETRYABLE_STATUSES`/`isRetryableStatus`
   (`RETRY-1`) privately. `CFG-35` mandates one shared retryability definition, which this phase ships as
   `config/retryable.ts` (Task 3) — the identical set (408, 429, 5xx except 501 and 505). 5a's design/plan are
   amended so `classify.ts` re-exports 7a's symbols unchanged instead of defining a second copy.

All three retrofits are document edits to 5a's already-written files, not code changes — no phase has executed
code yet (confirmed: no `packages/` directory exists in this repository as of this brainstorm). Together they
make 7a's `config/` module a **prerequisite of 5a's execution** (5a's plan's Prerequisite section records the
resulting inversion of the numeric phase order), not merely a later consumer of it.

## The `Configuration` model (`CFG-1`–`CFG-14`, `CFG-37`, `CFG-38`)

```typescript
type SourceFn = (key: string) => string | undefined;

interface Configuration {
  getString(key: string, fallback?: string): string | undefined;
  getRawProperty(key: string, fallback?: string): string | undefined;   // CFG-4, no normalization
  getInt(key: string, fallback: number): number;                          // CFG-5, CFG-38
  getBoolean(key: string, fallback: boolean): boolean;                    // CFG-6, CFG-38
  getDuration(key: string, fallback: number): number;                     // CFG-7, CFG-38 (ms)
  derive(mutate: (builder: ConfigurationBuilder) => void): Configuration; // CFG-9
}

class ConfigurationBuilder {
  put(key: string, value: string): this;      // CFG-37: invariant(key/value non-null)
  remove(key: string): this;                  // CFG-10
  withEnvSource(fn: SourceFn): this;           // CFG-11
  withPropertySource(fn: SourceFn): this;      // CFG-11 — see below
  build(): Configuration;                      // CFG-8: defensive copy of override map
}
```

**Three tiers, not four.** `CFG-1`'s precedence chain is override → environment → *system property* → default.
Node has no ambient key/value store distinct from `process.env`, so — per the already-settled
`08-instrumentation-and-configuration.md` reasoning — this port collapses to override → environment → default.
`withPropertySource` still exists on the builder (so `CFG-11`'s "environment and property sources MUST be
substitutable seams" is satisfied structurally and `CFG-3`/`CFG-4`'s normalized-vs-raw distinction has a real
second seam to test against), but production `Configuration.default()` wires it to a function that always
returns `undefined` — there is no real property store to delegate to. This is stated as a deliberate platform
difference, not smoothed over by routing a synthetic "system property" through `process.env` under a different
key (the sdk-design doc's own explicit rejection of that shortcut).

`getInt`/`getBoolean`/`getDuration` (`CFG-38`) resolve through `getString`'s full layered lookup before parsing —
never a shortcut that reads only the override map. The duration grammar (`CFG-7`) is hand-rolled (ISO-8601
`P`/`p`-prefixed, shorthand `<number><unit>` for `ms`/`s`/`m`/`h`/`d`, bare number as milliseconds) because no
built-in JS parser exists for it, mirroring `pacing.ts`'s own hand-rolled-parser precedent — same reasoning, same
totality requirement (never throw, fall back to the caller's default).

A process-wide global slot (`CFG-13`) — `getGlobalConfiguration()`/`setGlobalConfiguration()` — defaults to an
empty `Configuration`, last-write-wins, safely published. `CFG-14`'s well-known key constants live in
`configuration.ts` as exported string literals: `CFG_KEY_MAX_RETRY_ATTEMPTS`, `CFG_KEY_LOG_LEVEL` (7b consumes
this one), `CFG_KEY_HTTP_PROXY`/`CFG_KEY_HTTPS_PROXY`/`CFG_KEY_NO_PROXY`.

`CFG-37`'s fail-fast-on-null-required-argument uses the project's sanctioned `invariant(cond, msg)` helper
(throwing `InvariantViolation`) — a programmer-error signal, not a new domain `Error` subclass. Documented
nullable slots (proxy credentials, challenge handler, a lookup's own `fallback`) are `| undefined` in the type
and exempt.

## `Clock` and async primitives (`CFG-15`–`CFG-21`)

```typescript
interface Clock {
  now(): number;              // wall-clock epoch ms; MAY move backwards; never for elapsed-time math
  monotonic(): number;        // non-decreasing; absolute value meaningless; performance.now()
  sleep(ms: number, signal?: AbortSignal): Promise<void>;   // rejects negative; resolves promptly at 0
}
```

**One primitive, not two.** The reference distinguishes a blocking, interruptible `sleep` (`CFG-15`/`CFG-17`)
from a scheduler-driven non-blocking `delay` yielding a cancellable future (`CFG-18`) because the JVM has real
carrier threads worth distinguishing "block this one" from "schedule that one" against. Node has neither
blocking sleep nor a distinct scheduler object — every timer is already non-blocking by construction. Both
collapse into the one `Promise`-returning `sleep` above, the same `NFR-11` precedent 4c already established for
sync/async pipeline collapse. `CFG-17`'s "re-assert the interrupt/cancellation status before propagating"
re-expresses as: an aborted `signal` during the wait rejects with the signal's abort reason (typically a
`DOMException`/`CancellationError` per 4a's convention), not a bare rejection — the caller's cancellation is
what's surfacing, not a fresh error. `CFG-18`'s "cancelling the future cancels the underlying scheduled task" is
`clearTimeout` on the abort listener, mirroring 5a's own wait implementation exactly (`Promise` racing
`setTimeout` against `AbortSignal`, `clearTimeout` on both the resolve and the abort path so no dangling timer
keeps the event loop alive) — which is precisely why 5a's `RetryConfig.clock` retrofits onto this seam rather
than keeping its own copy.

`CFG-19` (async-wrapper unwrapping) and `CFG-20`/`CFG-21` (interruptible-task future, executor semantics) are
JVM-specific machinery — a `CompletableFuture`/`ExecutorService` vocabulary Node's single `Promise` primitive has
no analog for. `Promise` rejection already carries the original error with no wrapper to unwrap (`CFG-19`
vacuously satisfied — there is no wrapper type in this runtime), and there is no executor/worker-pool concept for
`CFG-20`/`CFG-21`'s cancel-with-interrupt/cancel-without distinction to apply to. Recorded as a platform
simplification in the Deviation Ledger below, same class as `SEAM-5`–`SEAM-10`'s permanent non-build.

`Configuration.default()`'s production sources delegate to `process.env` for the environment seam.

## Proxy model (`CFG-22`–`CFG-28`)

```typescript
interface ProxyOptions {
  readonly type: 'http' | 'socks4' | 'socks5';
  readonly host: string;
  readonly port: number;                                   // 0..65535, explicit, never guessed
  readonly nonProxyHosts: readonly string[];                // compiled glob patterns
  readonly credentials?: { readonly username: string; readonly password: string };
  readonly challengeHandler?: unknown;                      // slot only; no challenge protocol shipped
  readonly bypassAll: boolean;
}

// CFG-22's masking contract, as built. `toString(): string` was NOT kept on the interface: every object
// satisfies it via Object.prototype, so declaring it guarantees nothing while forcing Omit/Pick gymnastics
// through the public API. `createProxyOptions` attaches an own `toString` delegating here, so `String(options)`
// still masks for a factory-built instance.
function formatProxyOptions(options: ProxyOptions): string;                 // CFG-22, credentials masked
function createProxyOptions(init: ProxyOptionsInit): ProxyOptions;
function shouldBypassProxy(
  options: Pick<ProxyOptions, 'bypassAll' | 'nonProxyHosts'>,               // CFG-23
  host: string,
): boolean;
function resolveProxyOptions(config: Configuration): ProxyOptions | null;  // CFG-24–CFG-28, never throws
```

Ships as **types and resolution logic only** — no concrete `Transport` consumes a `ProxyOptions` yet, because no
concrete `Transport` exists until Phase 8 (`@dexpace/transport-fetch`/`-undici`). This mirrors Phase 2's
`Serde<T>`-before-`codec-json` precedent exactly: the contract lands here, wiring lands with the first concrete
consumer. Explicit scope boundary, recorded so it isn't later mistaken for an omission.

**As-built correction (2026-08-27).** This section originally said `CFG-24`'s "`https.proxyHost` preferred over
`http.proxyHost`" collapses to environment-only. That is true of the *production sources* and false of the
resolution logic, and the shipped code implements the wider reading. `resolveProxyOptions` consults the property
tier first — `https.proxyHost` over `http.proxyHost`, the port taken from the chosen host's own layer,
credentials read only from `https.proxyUser`/`https.proxyPassword` — and falls through to the environment URL
form (`HTTPS_PROXY` preferred over `HTTP_PROXY`, parsed as `scheme://user:pass@host:port`) only when the
property tier yields nothing. All of `CFG-26`'s non-proxy-host resolution (property pipe-list over environment
comma-list, backslash escape, split → drop empty → unescape → trim) is likewise built. It reads the same
substitutable property seam `Configuration` already carries for `CFG-3`/`CFG-4`, and in the default Node wiring
that seam is empty, so real behavior *is* environment-only exactly as the collapse describes. Without the tier,
`CFG-24`'s same-layer-port and https-only-credentials clauses and every clause of `CFG-26` would have been
silent gaps, and `CFG-4`'s `getRawProperty` would have had no consumer in the repository.

Glob compilation (`*` → "any run", `?` → "one char", metacharacter-escaped, full-string, case-insensitive)
happens once at construction. As built, the compiled patterns are held in a module-level `WeakMap` keyed by the
pattern array itself rather than in a cache field on the `ProxyOptions` instance, which keeps the public shape
free of a field no requirement asks for and makes the caching work for a hand-built options object too. The
trade-off: a hand-built object whose `nonProxyHosts` array is not frozen caches its first compile permanently,
so a pattern pushed on afterwards is silently ignored.

## Dates, identifiers, and equality (`CFG-29`–`CFG-36`)

- **`http-date.ts`** — `formatHttpDate(epochMs: number): string` (canonical `Sun, 06 Nov 1994 08:49:37 GMT`,
  always UTC, zero-padded day) and `parseHttpDate(value: string): number | null` (tolerant: case-insensitive
  month, `GMT`/`UTC`/`+0000`/`+00:00` all normalize to zero offset, informational weekday stripped not validated;
  strict on the rest — blank input and a missing post-weekday comma both fail). This is the module 5a's
  `pacing.ts` is amended to import from (see Scope above).
- **`identifiers.ts`** — `randomUuid(): string`, a type-4 RFC 4122 UUID via `globalThis.crypto.getRandomValues`
  (the cross-runtime primitive already fixed as core's floor — no `node:crypto` import). Explicitly documented
  as non-cryptographic output despite the CSPRNG source, matching `CFG-32`'s own caller-facing caveat.
  Concurrency-safe by construction — no shared mutable state, `crypto.getRandomValues` has none either.
- **`equality.ts`** — `deepEqual(a: unknown, b: unknown): boolean` / `deepHash(value: unknown): number`.
  Content-based array comparison (element-by-element, recursing into nested arrays), null-safe (`deepEqual(null,
  null) === true`, `deepHash(null) === 0`), `NaN`-equals-`NaN` and `+0` !== `-0` for numeric arrays per `CFG-34`.
  A typed numeric array (`Float64Array`) is never equal to a plain `number[]` of the same values — the
  JS-native equivalent of the reference's "object array vs. primitive array" distinction.
- **`retryable.ts`** — promotes 5a's `RETRY-1` status classifier (`isRetryableStatus(status: number): boolean`,
  exactly 408/429/5xx-except-501-and-505) to a public utility satisfying `CFG-35`. **Not a second
  implementation** — 5a's `classify.ts` imports and re-exports the same function; the single-source discipline
  `RECOV-30` already established for backoff math applies here too.
- **`build-info.ts`** — `BuildInfo` resolved once at module load:

  ```typescript
  interface BuildInfo {
    readonly sdkVersion: string;      // from generated/version.ts; 'unknown' only if codegen somehow didn't run
    readonly runtimeIdentity: string; // e.g. 'node/20.11.0', 'unknown' if undetectable
    readonly identityTokens: readonly string[];  // [sdkToken, runtimeToken], every entry non-blank
  }
  function getBuildInfo(): BuildInfo;
  ```

  `sdkVersion` comes from `src/generated/version.ts`, a file `scripts/gen-version.mjs` writes at build time from
  `package.json`'s `version` field — `export const SDK_VERSION = "x.y.z";` as a plain string literal, never
  hand-edited, never a runtime `package.json` read (which would require `node:fs`/`import.meta.url` tricks that
  break the browser/Workers runtime floor). This is the mechanism that finally closes `NFR-15`: the version is
  never the `"unknown"` placeholder on any build that ran its prebuild step.

  `runtimeIdentity` is feature-detected, never throwing: `process.version`/`process.platform` when `process` is
  defined (Node/Bun/Deno-compat mode), `navigator.userAgent` when `navigator` is defined and `process` is not
  (browsers, Workers), `Deno.version` when `Deno` is defined, falling back to the literal `"unknown"` — matching
  `CFG-36`'s own "falls back to a non-blank `unknown`" wording precisely.

## The client-identity step (`RECOV-33`, closing `NFR-15`)

```typescript
interface ClientIdentitySettings {
  headerName?: string;              // default 'User-Agent'
  tokens?: readonly string[];       // default: getBuildInfo().identityTokens
  mode?: 'append' | 'replace';      // default 'append'
}
function clientIdentityStep(settings?: ClientIdentitySettings): StepDescriptor;
```

A plain `StepDescriptor` — **no new `Stage`**. It is not one of the five reserved pillars (`REDIRECT`/`RETRY`/
`AUTH`/`LOGGING`/`SERDE`); it installs into one of the existing user-extensible pre/post slots the stage list
already interleaves around each pillar, using the pipeline authoring surface 5c already promoted to the public
barrel (`StepDescriptor`, `PipelineBuilder`). Composition per `RECOV-33`: Append mode (default) joins the token
list with spaces and appends after the *first* existing header value (treating an empty first value as absent, so
no leading space), or sets the sole value if the header is absent; Replace mode overwrites. An empty or
blank-joining token list makes the step a no-op — it never emits a blank/whitespace-only header. Default header
is `User-Agent`, default tokens are `getBuildInfo().identityTokens`, both overridable — a caller can repoint this
same step at a custom header for a second identity line without a second implementation.

Because it is configuration-driven and unrelated to retry mechanics, it does not ship in 5a (which already
reasoned this) and is not installed by `standardResilience()` by default — a caller opts in by adding it to their
own `PipelineBuilder`, or a future preset revision could adopt it; this document does not amend `standardResilience()`
(that preset's `LOGGING`-slot amendment is 7b's job, and `clientIdentityStep` targets a non-pillar slot the preset
doesn't manage).

## File Layout

```
packages/core/src/config/
  configuration.ts       # Configuration, ConfigurationBuilder, global slot, CFG-14 key constants
  duration.ts             # parseDurationMs -- CFG-7's grammar, split out of configuration.ts at review
  clock.ts                # Clock seam, default implementation
  proxy.ts                # ProxyOptions, shouldBypassProxy, resolveProxyOptions
  http-date.ts             # formatHttpDate, parseHttpDate
  identifiers.ts           # randomUuid
  equality.ts              # deepEqual, deepHash
  retryable.ts             # isRetryableStatus (re-exported by 5a's classify.ts, not duplicated)
  build-info.ts            # BuildInfo, getBuildInfo
  client-identity-step.ts  # clientIdentityStep

packages/core/src/generated/
  version.ts                # generated; export const SDK_VERSION

packages/core/scripts/
  gen-version.mjs            # prebuild codegen, reads package.json, writes generated/version.ts
```

Also amends (not creates, no code exists yet): `packages/core/src/retry/settings.ts`/`engine.ts`
(`RetryConfig.clock: Clock`) and `packages/core/src/retry/pacing.ts` (imports `parseHttpDate` from
`config/http-date.ts` instead of a private parser) — both 5a design/plan amendments per Scope above.

## Public barrel promotion

`docs/knowledge/module-organization.md` bans internal barrels outright — a folder-level `index.ts` inside
`src/config/` would be exactly that. There is no `src/config/index.ts`; every public symbol from this phase is
re-exported directly from the package root `packages/core/src/index.ts` (the single curated barrel, amended
every phase since Phase 1), each pointing at its concrete file (e.g. `export {Clock} from './config/clock.js'`).

`Configuration`, `ConfigurationBuilder`, `getGlobalConfiguration`/`setGlobalConfiguration`, the `CFG-14` key
constants, `Clock`, `ProxyOptions`, `resolveProxyOptions`/`shouldBypassProxy`, `formatHttpDate`/`parseHttpDate`,
`randomUuid`, `isRetryableStatus`, `getBuildInfo`, and `clientIdentityStep`/`ClientIdentitySettings` are
promoted this way.

**As built, two corrections to that list.** `createProxyOptions`/`ProxyOptionsInit` and `formatProxyOptions`
are promoted alongside `ProxyOptions` — a caller cannot otherwise build one with its `CFG-22` masking, and the
free formatter replaced the interface's `toString()` member (see §"Proxy model"). `clientIdentityStep`/
`ClientIdentitySettings` are **not** promoted: `StepDescriptor` is `@internal` and api-extractor rejects a
`@public` export returning a forgotten one, so the step ships in-package until the phase that publishes the
pipeline authoring surface lands. Recorded as open item G1.

`deepEqual`/`deepHash` stay `@internal` (no root re-export) — no requirement calls for
callers to compare arbitrary values through the SDK's own API, and 5a's/5b's own equality needs (settings
validation, collection defensive-copy checks) can import `config/equality.js` directly within the same package.

## Error Handling

No new `Error` subclass. `CFG-37`'s fail-fast validation uses the existing `invariant()`/`InvariantViolation`
convention (programmer error, not a recoverable domain failure). `resolveProxyOptions` and every typed accessor
are total — malformed input returns `null`/the caller's default, never throws, matching `CFG-5`–`CFG-7`/`CFG-24`/
`CFG-25`'s explicit never-throw requirements.

## Testing

`bun test`, colocated `*.test.ts`, every file citing the `CFG-N` IDs it exercises. `Configuration`'s env/property
sources are injected functions in every test (`CFG-11`) — no test touches real `process.env`. `Clock` is injected
wherever time-dependent behavior is asserted (`CFG-15`'s own stated intent); no test depends on real elapsed wall
time or an unseeded random source, continuing 5a's testing discipline.

Property tests (fast-check):

- **`parseHttpDate`** — never throws for any string; a canonical `formatHttpDate` output round-trips through
  `parseHttpDate` to the same instant; weekday/zone-alias tolerance holds for a matrix of valid date bodies.
- **`deepEqual`/`deepHash`** — reflexive, symmetric, hash-consistent over generated nested-array/primitive trees;
  `NaN`/`±0` cases from `CFG-34` as explicit unit cases (property generators don't reliably hit signed zero).
- **`resolveProxyOptions`** — never throws for arbitrary env-source string generators.

Conformance test for the retrofit: a single shared `formatHttpDate`/`parseHttpDate` test suite import-checked
against both `config/http-date.ts` and `retry/pacing.ts`'s (amended) call site, so a future edit cannot silently
reintroduce a second parser without a test noticing the import changed.

## Deviation Ledger (for Phase 10)

| Deviation | Reference behavior | Justification |
|---|---|---|
| `Clock.sleep` is the only wait primitive; no separate blocking-sleep/async-delay pair | `CFG-15`/`CFG-17` (blocking sleep) vs. `CFG-18` (scheduled async delay) as two primitives | Node has no carrier threads to distinguish "block this one" from "schedule that one" against; both are already non-blocking `setTimeout`-backed `Promise`s. Same collapse class as `NFR-11` |
| No interruptible-task-future / executor vocabulary (`CFG-20`/`CFG-21`) | JVM `ExecutorService`/`Future` cancel-with-interrupt semantics | No executor/worker-pool concept in this port; `Promise` cancellation is `AbortSignal`-based throughout, already covered by `Clock.sleep`'s signal parameter and 4a's cancellation model |
| Async-wrapper unwrapping (`CFG-19`) is vacuous | JVM wraps async-completion exceptions requiring unwrap | `Promise` rejection carries the original error directly; no wrapper type exists in this runtime to unwrap |
| The *production sources* collapse to environment-only (proxy and general config alike); the property seam and the resolution tier that reads it are both built | `CFG-1`/`CFG-24`'s four/system-properties-first precedence | Node has no ambient key/value store distinct from `process.env`, so `defaultConfiguration()` wires the property seam to a function that always returns `undefined` and real behavior is environment-only — already the settled reasoning from `08-instrumentation-and-configuration.md`. The seam itself, `getRawProperty` (`CFG-4`), `resolveProxyOptions`'s property tier (`CFG-24`), and all of `CFG-26` ARE implemented against it, so every conformance clause is testable; only the production wiring collapses. Narrowed from an earlier, wider wording on 2026-08-27 — see `docs/work/mvp/2026-09-04-open-items-dissolution.md` K2 |
| SDK version resolved via build-time codegen, not a runtime `package.json` read | N/A — JVM reads manifest attributes at class-load time | Core's runtime floor includes browsers/Workers with no filesystem; `import.meta.url` tricks are Node/Deno/Bun-only and would leave the browser build with the placeholder `NFR-15` forbids |

## Deferred Items (add to the roadmap's Deferred Items Log)

| Item | Originated in | Target | Reason |
|---|---|---|---|
| `challengeHandler` slot on `ProxyOptions` has no protocol behind it | 7a brainstorm | Phase 8 (first concrete `Transport`) | The type carries the slot per `CFG-22`'s field list; nothing dispatches through it until a real transport owns a proxy connection to challenge over |
| Whether `clientIdentityStep` should be added to `standardResilience()`'s default install list | 7a brainstorm | Phase 9 (conformance sweep) or a future preset revision | Not installed by default in this document — no requirement mandates it, and 5c's preset already closed its own scope for the pillars that exist; revisit if Phase 9 finds a caller expectation this doesn't meet |
