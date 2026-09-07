# Phase 2 — Seam Foundations — Design

**Status:** Draft, approved for planning.

**Purpose:** Build the seam *contracts* — `Transport`, `Serde<T>`, and the operation-input projection
(`buildRequest()`) — that later phases' pipelines, resilience layer, and concrete adapters build on. This is
Phase 2 of the [v1 roadmap](../2026-07-23-nodejs-sdk-v1-roadmap-design.md), building on Phase 1's domain model.

**Scope is narrower than the JVM reference's "seams" concept.** Per `sdk-design-nodejs/03`, Node collapses most of
what the JVM reference needs multiple seams and a discovery mechanism for: there is one `Transport` shape (not a
sync/async split), one async primitive (`Promise`, nothing to bridge), and no pluggable byte-stream factory (Web
Streams are the platform's own answer, not a third-party library to keep out of core). Two groups of requirements
are consequently **not built at all** in this port — permanent simplifications, not deferrals, recorded in the
roadmap's Deferred Items Log and destined for Phase 10's deviation ledger:

- **`SEAM-5`–`SEAM-10`** (discovery / registration / conflict resolution) — nothing is pluggable enough to need
  discovering. `sdk-design/03` §3.1 and §3.5 derive this in full.
- **`SEAM-18`** (the sync↔async bridges) — a bridge exists to connect two transport seams. This port has one
  (`SEAM-11`/`SEAM-16` collapse, below), so there is nothing on either bank. Every specific obligation SEAM-18
  names — "wrapping a blocking transport as async REQUIRES a caller-supplied executor", "wrapping an async
  transport as blocking MUST unwrap the async-wrapper exception", "the blocking wait MUST honor interruption" —
  presupposes a blocking transport that Node cannot idiomatically have (`sdk-design/03` §3.2: producing one would
  require `Atomics.wait` on a `SharedArrayBuffer`, "exactly the kind of hack the reference explicitly rules out").
  SEAM-18's one portable obligation that *isn't* bridge-specific — "per-call options MUST be threaded through,
  not dropped" — survives as a `Transport.send()` contract obligation below.

**Governing documents:** `docs/product-spec/03-pluggable-seams-and-extension-model.md`,
`docs/sdk-design-nodejs/03-seam-by-seam-idiomatic-mapping.md` (the Node mapping this design follows directly), and
`docs/product-spec/04-core-http-domain-model.md` (HTTP-29, whose percent-encoding fix this phase reuses).

### Requirement disposition

Every `SEAM-N` this phase touches, and how. "Contract obligation" means the requirement is stated as a TSDoc
obligation on the interface an implementor must honor — Phase 2 ships interfaces only, so nothing behavioral can
be *tested* here; the phase that ships a real implementation owns the conformance test.

| ID | Level | Disposition in Phase 2 |
|---|---|---|
| SEAM-11 | MUST | Satisfied structurally by `Transport.send()` returning `Promise<Response>` (collapsed with SEAM-16) |
| SEAM-12 | MUST | **Contract obligation** on `Transport` — concurrent-call safety, per-request state confined to locals/the returned promise graph. Conformance test belongs to Phase 8's real adapters |
| SEAM-14 | MUST | **Interface shape locked here** (`close()`), obligations documented; ownership-aware/idempotent behavior implemented in Phase 8 |
| SEAM-16 | MUST | Satisfied structurally — `Promise<Response>` cannot resolve to a null/absent value |
| SEAM-17 | SHOULD | Satisfied — the canonical pivot is native `Promise`; no second async ecosystem to bridge |
| SEAM-18 | MUST | **Not built** — moot under the one-transport collapse (see above); its per-call-options clause survives as a `send()` obligation |
| SEAM-19 | MUST | Satisfied — `Serde<T>` bundles serializer + deserializer + undefaulted `mediaType` |
| SEAM-21 | MUST | **Deferred to Phase 6** per `sdk-design/03` §3.3 → §7.3; see the `Serde<T>` provisionality note below |
| SEAM-26 | MUST | Satisfied — `OperationDescriptor` (method + path template required, four projections optional) |
| SEAM-27 | MUST | Satisfied — `buildRequest()` encoding and base-URL composition rules |
| SEAM-30 | MUST | **Contract obligation** on `send()`; implemented by Phase 8's adapters |
| SEAM-5–10 | mixed | **Never built** — permanent simplification (see above) |

## Explicitly Out of Scope (see the roadmap's Deferred Items Log for full detail)

- `Logger`/`LogEvent` — an `OBS-*` concern, not a `SEAM-N` one; belongs to Phase 7.
- A `FakeTransport` test double — no consumer of `Transport` exists until Phase 4's pipelines.
- `SEAM-30`'s cleanup implementation (cancel an orphaned response) — documented as a contract obligation on
  `Transport.send()`, actually implemented by Phase 8's real adapters.
- `SEAM-14`'s close *behavior* (idempotent, ownership-aware, releases only self-created resources) — the
  `close()` **signature is locked in this phase** (see Transport, below, for why deferring the shape is not an
  option); only the behavior waits for Phase 8, where a transport first owns a pool worth releasing.
- `SEAM-12`'s concurrency conformance test ("fire many concurrent requests through one transport and assert no
  cross-talk") — needs a real transport to fire through; Phase 8.
- The byte-stream provider implementation (`ByteQueue`, `BufferedSource`/`Sink`, `TeeSink`) — `sdk-design/03`
  discusses it in the same document, but the roadmap's phase split puts the implementation in Phase 3.
- `SEAM-21`'s full type-witness mechanism — `sdk-design/03` itself defers this to §7.3 (Phase 6), since it's the
  one place TypeScript's answer is structurally different from the JVM's, not just differently packaged.
- Concrete `Serde` (`@dexpace/codec-json`, Phase 6) and `Transport` (`@dexpace/transport-fetch`/`-undici`, Phase 8)
  implementations — this phase ships interfaces only.

## File Layout

```
packages/core/src/http/
  rfc3986.ts               # encodeRfc3986Component() — extracted from Phase 1's query-params.ts (see Retrofit)

packages/core/src/seams/
  transport.ts          # Transport interface, composeSignal(), isTimeoutSignal(), CancellationError
  serde.ts               # Serde<T> interface
  operation.ts            # OperationDescriptor, buildRequest(), OperationAssemblyError
  index.ts                 # barrel
```

## Toolchain prerequisites

This is the first phase whose *public surface* depends on platform runtime APIs rather than pure language
features. Three toolchain facts must be settled before Task 1, not discovered mid-phase:

- **`tsconfig.base.json` needs web lib types.** Phase 0 set `lib: ["ES2022"]`, which declares none of
  `AbortSignal`, `AbortController`, `DOMException`, `URL`, or `ReadableStream`. Phase 1 already used `URL`, and
  this phase puts `AbortSignal` in the *public* seam signature and `DOMException` in `isTimeoutSignal`. Today
  those resolve only because `@types/bun` injects web globals ambiently — a Bun-specific source of truth for a
  library whose whole premise is runtime-agnosticism, and precisely the kind of mismatch **NFR-10** ("artifact
  target and visible-API level must agree") exists to catch. Add `"DOM"` to `lib` (`lib: ["ES2022", "DOM"]`) so
  the declared surface is honest rather than incidentally satisfied. Do not *use* browser-only globals
  (`window`, `document`) that this admits — they stay banned by review, the same way `ascii-validation`'s
  predicates stay unexported.
- **`AbortSignal.any()` sits exactly on the declared Node floor.** It landed in Node 18.17.0, and
  `engines.node` is `">=18.17"`. This works, but it means the floor is now load-bearing for a *runtime API*, not
  just for syntax — lowering `engines.node` by a single patch version silently breaks `composeSignal()` at run
  time, not at build time. The Deferred Items Log already tracks "CI running the built artifact against the
  declared minimum Node" as an **NFR-10**/**NFR-17** residual targeted at Phase 3; this phase is the reason to
  pull it forward to Phase 2 instead.
- **`expect-type` must be installed.** The `Serde<T>` type-level test below uses `expectTypeOf`, which `bun test`
  does not provide. Add `expect-type` to the workspace-root `devDependencies` (dev-only — **SEAM-1** untouched),
  the same gap class as the missing `fast-check` that Phase 0/1 had to fix.

## Retrofit: shared RFC 3986 encoder

Phase 1's `query-params.ts` has a private `percentEncodeComponent()` patching `encodeURIComponent`'s divergence
from RFC 3986 (`encodeURIComponent` leaves `!'()*` unescaped; RFC 3986's unreserved set doesn't include them).
`buildRequest()`'s path-segment encoding (SEAM-27) needs the exact same fix. Extract it as
`encodeRfc3986Component()` and have both call sites import it — two independent implementations of the same
character-class patch is exactly the kind of drift risk `ascii-validation.ts` was extracted to avoid in Phase 1.

**It lives in `src/http/`, not `src/seams/`.** The encoder implements **HTTP-29**, an HTTP-domain requirement, and
the roadmap's ordering rationale is explicit that the layers run one way — "domain model before the seams that
operate on it." `seams/operation.ts` already imports `Request`/`Headers`/`QueryParams` from `http/`; putting the
shared encoder under `seams/` would make `http/query-params.ts` import *upward* into `seams/`, inverting that
direction. As written today that inversion happens to not form a runtime cycle (the encoder imports nothing), but
it becomes a real circular import the moment anyone reaches it through `seams/index.ts` instead of the file
directly — and barrel-first imports are the convention this package already uses. Keeping it in `http/` means the
dependency graph stays strictly one-directional and no import-cycle lint rule is needed to defend it.

## Component Design

### Transport (`transport.ts`)

```typescript
interface Transport {
  send(request: Request, options?: RequestOptions, signal?: AbortSignal): Promise<Response>;
  close(): Promise<void>;
}
```

Collapses SEAM-11 (sync) and SEAM-16 (async) into one contract — `Promise<Response>` satisfies both "single
operation, no pre-buffering" and "non-null response or exceptionally, never resolves to null" *structurally*: a
function typed to return `Promise<Response>` cannot type-check while resolving `undefined`. SEAM-17's "canonical
async pivot" is native `Promise`; there is no second async ecosystem to bridge. `Response.body` stays Phase 1's
`unknown` placeholder — SEAM-11's no-pre-buffering guarantee isn't testable until Phase 3 gives it a real
streaming type; the signature is stable regardless.

**`close()` is on the interface from day one (SEAM-14).** *"Both transport seams MUST be closeable, and close MUST
be (1) idempotent, (2) ownership-aware — only resources the transport itself created are released, and a
caller-supplied client/executor is NEVER touched, and (3) interrupt-safe. A lightweight transport MAY have a no-op
close."* Phase 2 has no resource to release, so it is tempting to leave `close()` out and add it in Phase 8 with
the first pooled adapter — that would be a mistake. `Transport` is a **published seam**: the api-extractor report
is committed and changesets gate the version, so adding a required method to a shipped interface is a breaking
change for every implementor. Locking the shape now costs one line; deferring it costs a major bump and a
migration note. The `Promise<void>` return (not `void`) is deliberate — `undici`'s `Agent.close()` and any
graceful-drain implementation are inherently async, and widening `void` → `Promise<void>` later is the same
breaking change in miniature. Implementations that own nothing satisfy it with `async close(): Promise<void> {}`.

A future revision may additionally expose `[Symbol.asyncDispose]` (TypeScript 5.2 `await using`) as a thin
delegation to `close()`. It is deliberately *not* required here: it would put an ES2022-plus lib requirement in
the public surface, which cuts against the runtime-floor discipline above, and it adds nothing `close()` doesn't
already give an implementor.

**Contract obligations carried as TSDoc** — each is an implementor requirement this phase cannot itself test,
since it ships no implementation. They are written on the interface so the Phase 8 adapters inherit them as
review criteria rather than rediscovering the spec:

| Obligation | Requirement | Statement |
|---|---|---|
| Concurrency | SEAM-12 | `send()` MUST be safe for concurrent calls; all per-request state confined to locals or the returned promise graph — never instance fields on the transport |
| Orphan cleanup | SEAM-30 | After the underlying fetch resolves, check whether the signal already fired before delivering; if so, cancel the response body instead of resolving. That cleanup path MUST be awaited or given `.catch(() => {})` — an unhandled rejection there crashes the process under Node's default `unhandledRejection` policy (`sdk-design/03` §3.2 flags this as a footgun with no JVM equivalent) |
| Options threading | SEAM-18 (residual) | Per-call `options` MUST be threaded through to the underlying client, never silently dropped. A transport that *ignores* options MUST behave identically to the no-options call (SEAM-11) |
| Close | SEAM-14 | Idempotent; releases only what the transport itself created; a caller-supplied client is never touched |

Cancellation:
- `composeSignal(userSignal?: AbortSignal, timeoutMs?: number): AbortSignal | undefined` — wraps
  `AbortSignal.timeout(ms)` + `AbortSignal.any([...])`, reusable by Phase 5's retry logic. Returns `undefined`
  when neither input is supplied, so a transport can pass it straight through to `fetch` without a branch.
- `isTimeoutSignal(signal: AbortSignal): boolean` — checks `signal.reason?.name === 'TimeoutError'`, which is
  what `AbortSignal.timeout()` fires. Deliberately **not** `reason instanceof DOMException`: `instanceof` is
  realm-bound, so a signal created inside a `node:vm` context or a worker fails the check even though it is a
  genuine timeout, and the added constraint buys nothing. `name` is a structured field on the reason object, not
  a message, so **XCUT-2**'s "told apart by ambient state, not by matching a message string" is satisfied by the
  `name` comparison alone.
- `class CancellationError extends DexpaceError` — for explicit caller-initiated aborts (see Error Handling).

### Serde (`serde.ts`)

```typescript
interface Serde<T> {
  readonly mediaType: string;
  serialize(value: T): unknown;
  deserialize(data: unknown): T;
}
```

`mediaType` is required and never defaulted (SEAM-19). `serialize`/`deserialize`'s I/O types stay abstract —
the wire representation is Phase 3's concern, and SEAM-21's full type-witness requirement is explicitly Phase
6's per `sdk-design/03`'s own framing (§7.3).

**`Serde<T>` is provisional and MUST NOT be re-exported from the package barrel this phase.** `deserialize(data:
unknown): T` with `T` inferred from the `Serde` instance is *precisely* the erased/inferred generic SEAM-21
forbids — "Deserialization MUST require an explicit runtime type token rather than an erased/inferred generic."
TypeScript erases generics exactly like the JVM does, so this signature cannot satisfy SEAM-21; the type-witness
mechanism that will is Phase 6's, and it will change this interface's shape.

That matters mechanically, not just aesthetically: Phase 0 wired a committed `api-extractor` report and changesets
that gate the published version. Exporting `Serde<T>` from `packages/core/src/index.ts` now means Phase 6 lands a
**breaking change to a published API**, forcing a major bump and a migration note for a shape that was never
intended to be final. So this phase:

- defines `Serde<T>` in `seams/serde.ts` and exports it from `seams/index.ts` for internal use,
- **omits it from `packages/core/src/index.ts`**, keeping it out of the api-extractor surface entirely,
- marks it `@internal` in TSDoc, with a one-line pointer to the Phase 6 type-witness work.

`Transport` and `buildRequest()` have no such problem — their shapes are final as designed — so they go through
the public barrel normally. The barrel is the enforcement point: what isn't in it isn't API, and can be reshaped
in Phase 6 without a changeset at all.

### Operation-input projection (`operation.ts`)

```typescript
interface OperationDescriptor {
  readonly method: Method;
  readonly pathTemplate: string;
  readonly pathParams?: Readonly<Record<string, string>> | undefined;
  readonly query?: QueryParams | undefined;
  readonly headers?: Headers | undefined;
  readonly body?: unknown;
}

function buildRequest(baseUrl: string | URL, operation: OperationDescriptor): Request;
```

The `?: T | undefined` spelling (rather than a bare `?: T`) is required, not stylistic. Phase 0 enabled
`exactOptionalPropertyTypes`, under which `?: T` means *"the key may be absent"* and **not** *"the key may be
`undefined`"* — so `buildRequest(base, {method: 'GET', pathTemplate: '/pets', query: undefined})` is a type error,
and only key-omission compiles. This seam exists to be targeted by generated code, which routinely builds
descriptors by spreading a partial object or assigning every field including the empty ones; forcing generators to
conditionally omit keys is a trap with no upside. Adding `| undefined` restores "absent or explicitly undefined,
both fine" while keeping the flag on everywhere else. This also matches Phase 1's convention, which used
`field: T | undefined` throughout and never a bare `?:` — Phase 2 is the first phase to introduce optional
*properties* at all, so the convention is being extended here rather than broken.

`body?: unknown` needs no `| undefined` — `unknown` already includes it.

`{name}` placeholders substituted from `pathParams`, each value run through `encodeRfc3986Component` — since
that encoder already turns `/` into `%2F`, SEAM-27's "a path value containing `/` is encoded, not split" holds
for free. Base-URL composition follows SEAM-27's fixed rules: trailing slash normalizes to one separator, empty
path leaves the base untouched, an existing base query is preserved with the operation query appended after it,
and a fragment-bearing or malformed base is rejected (`UrlConstructionError`, reused from Phase 1). A missing
placeholder value throws `OperationAssemblyError`.

## Error Handling

New: `CancellationError` (`transport.ts`), `OperationAssemblyError` (`operation.ts`). Reused from Phase 1:
`UrlConstructionError`. Same conventions as Phase 1 — typed `Error` subclasses, `cause` chaining, `this.name =
new.target.name`.

**Retrofit: introduce a real root above `DomainModelError`.** Phase 1 named its taxonomy root `DomainModelError`,
which was correct when every error in the tree *was* a domain-model construction failure. `CancellationError` is
the first that isn't — a cancelled transport call is a runtime/transport event, and calling it a "domain model
error" is simply wrong for anyone catching by type. Phase 5 makes this worse fast (retry-exhausted,
redirect-loop, auth-refresh failures are all non-domain), so this phase inserts one level:

```typescript
export class DexpaceError extends Error { /* sets this.name = new.target.name */ }
export class DomainModelError extends DexpaceError {}      // Phase 1's tree hangs here, unchanged
export class CancellationError extends DexpaceError {}     // sibling, not a domain-model error
export class OperationAssemblyError extends DexpaceError {} // seam-layer, likewise not domain-model
```

`OperationAssemblyError` (a missing path-parameter value) sits under `DexpaceError` rather than
`DomainModelError` for the same reason: it is raised while *projecting an operation onto* the domain model, not
while constructing one. `UrlConstructionError` stays exactly where Phase 1 put it — `buildRequest()` reuses it
for a fragment-bearing or malformed base URL, and that genuinely is a domain-model construction failure.

Cost now: one new class plus a one-word change to `DomainModelError`'s `extends` clause. Every Phase 1 leaf
(`RequiredFieldError`, `HeaderValidationError`, …) keeps its parent and its behavior, and `catch (e) { if (e
instanceof DomainModelError) }` in any existing test still narrows identically — this is additive, not a
rename. Cost if deferred to Phase 5: either the same edit against a much larger tree, or a permanent
mis-rooted hierarchy in a published API. `DexpaceError` gives consumers the "anything this SDK threw" catch-all
that a root ought to provide, which `DomainModelError` never could.

Since `DomainModelError` lives in `http/errors.ts` (Phase 1) and is already exported from the package barrel,
`DexpaceError` goes in the same file and joins the barrel alongside it — an additive API change, so it needs a
changeset but not a major bump.

## Deviation Ledger (for Phase 10)

Phase 2 predates the per-phase ledger convention that specs 3a-8b follow; this section is the retrofit, so Phase
10's reconciliation reads Phase 2 the same way it reads every other phase instead of pulling two items out of the
prose above by name.

| Deviation | Against | Reason |
|---|---|---|
| A `.`/`..` path-parameter value is rejected (`OperationAssemblyError`), not encoded | `SEAM-27` ("percent-encoded as single path segments") | Both are RFC 3986 *unreserved*, so encoding leaves them untouched, and the WHATWG URL parser folds `%2E` back to `.` during dot-segment normalization — no encoding keeps them as one literal segment. Forwarding `..` lets a path value rewrite the path (`/things/..` resolves to `/`), the injection class the requirement's own parenthetical exists to stop. Stricter than the requirement's letter, in service of its intent; no other value is affected |
| Discovery / registration / conflict-resolution machinery is never built | `SEAM-5`-`SEAM-10` | Nothing in this port is pluggable enough to need discovering: one `Transport` shape, one async primitive, and Web Streams as the platform's own byte-stream answer rather than a third-party library to keep out of core (`sdk-design/03` §3.1, §3.5) |
| The sync↔async bridge is never built; only its options-threading clause survives | `SEAM-18` | A bridge connects two transport seams; `SEAM-11`/`SEAM-16` collapse to one here, so there is nothing on either bank. Every bridge-specific obligation presupposes a blocking transport Node cannot idiomatically have. The one non-bridge clause — per-call options threaded through, never dropped — survives as an ordinary `Transport.send()` obligation, not a deviation |

## Testing

Phase 2 ships interfaces plus three pure functions. Only the pure functions are behaviorally testable; every
interface obligation in the disposition table is a Phase 8 conformance test, not this phase's.

- **`composeSignal` / `isTimeoutSignal`**: tested directly as pure functions over `AbortSignal`s — **no stub
  `Transport` is involved**. Neither function takes or returns a transport, so constructing one would test
  nothing; the earlier draft's stub was dead weight. Cases: user signal only, timeout only, both composed,
  neither (returns `undefined`); a fired `AbortSignal.timeout()` reports `isTimeoutSignal === true` while a
  fired `AbortController.abort(new CancellationError(...))` reports `false` — the concrete proof that **XCUT-2**'s
  timeout-vs-cancellation distinction is decidable from `signal.reason` without inspecting any message.
  Timeout cases use a genuinely short real timeout (single-digit ms) and `await`; `AbortSignal.timeout()` is
  backed by a real timer that `bun:test`'s clock control does not intercept, so do not reach for fake timers.
- **`Serde<T>`**: a type-level `expectTypeOf` check only (styleguide 11.6) — no runtime logic exists to unit-test.
  Requires the `expect-type` devDependency (see Toolchain prerequisites). The check should assert that
  `mediaType` is required and that `deserialize`'s return is bound to the instance's `T`; both are exactly what
  Phase 6's type-witness rework will change, so the test doubles as a tripwire for that phase.
- **`buildRequest()`**: `fast-check` property test (mandatory, styleguide 11.5 — this is an assembler/serializer)
  proving a path-param value containing `/` never splits into an extra segment, for arbitrary generated strings.
  Assert on the *parsed* segment count of the resulting `URL`, not on a substring match, so the property fails
  loudly if the encoder regresses to bare `encodeURIComponent`.
- **SEAM-27 example tests**, one per conformance note in the requirement's own text, including its worked example
  (`host/c?sig=.. + /pets → host/c/pets?sig=..&<opquery>`) as a direct test case, not a paraphrase: trailing
  slash normalizes to one separator; an empty path leaves the base untouched; an existing base query is preserved
  with the operation query appended *after* it; a fragment-bearing base is rejected; a malformed base is rejected;
  a missing placeholder throws `OperationAssemblyError`.
- **SEAM-26 conformance test**, which the earlier draft omitted: the requirement's own note is *"a parameterless
  GET overriding only method+path assembles the right request."* `buildRequest(base, {method: 'GET', pathTemplate:
  '/pets'})` — all four projections absent — must produce a well-formed `Request` with empty headers and no query,
  proving the "four projections default to empty" half of SEAM-26 rather than only the populated path.

Every test file cites the `SEAM-N` IDs it exercises in a top-of-file comment, continuing the traceability
convention Phase 1 established for Phase 9's conformance pass.
