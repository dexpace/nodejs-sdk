# @dexpace/core

## 0.1.0

### Minor Changes

- c1eb3aa: Add the core HTTP domain model (Request, Response, Headers, Status, MediaType, Protocol, QueryParams, RequestOptions, ETag, HttpRange, RequestConditions).
- c1eb3aa: Add the seam foundations: the `Transport` contract with its `composeSignal`/`isTimeoutSignal` cancellation helpers and `CancellationError`, the operation-input projection (`OperationDescriptor`, `buildRequest`, `OperationAssemblyError`), and `DexpaceError` as the root of the error taxonomy.

  Every existing error leaf keeps its behavior and its message. The taxonomy is two levels: a leaf's own superclass is `DexpaceError` itself, and a family is grouped with an exported type guard rather than an intermediate class.

- c1eb3aa: Body lifecycle review fixes.

  Security:

  - Body media types are validated as header-safe at construction (`byteArrayBody`, `stringBody`, `streamBody`, and every part rendered into a multipart body), using the same predicate as outbound header-value validation (HTTP-26). A CR/LF in a media type was previously interpolated verbatim into a multipart part header, which allowed arbitrary header injection, arbitrary part content, and a forged closing boundary while the declared content length still matched the corrupted bytes (HTTP-51).
  - `StreamBody.writeTo` now refuses a chunk that would carry the body past its declared `contentLength` _before_ writing it, and aborts the sink rather than closing it on any length mismatch. Overrun bytes previously reached the sink and were reported only afterwards, leaving them on the socket behind a stamped `Content-Length` (HTTP-39/BODY-10).

  Correctness:

  - A body write failure is no longer masked by the close that follows it. All five `Body` implementations share one writer scope that aborts on failure and never lets a close error replace the primary one (RECOV-12), so retry classification still sees the I/O failure in the cause chain (RETRY-2).
  - `TypedResponse.value()` memoizes a parser that throws synchronously; it previously re-ran the handler and re-read the single-use body (HTTP-44).
  - `HttpStatusError.preview()` decodes with the charset declared by the response media type, falling back to UTF-8, and never throws a `RangeError` on an unknown label (HTTP-42).
  - `withRequestLogging(...).materialize()` gives the new wrapper its own tap buffer instead of aliasing the original's, so one wrapper's write can no longer rewrite another's captured preview (BODY-21).
  - `withResponseLogging` treats a zero-length delegate chunk as a stream-contract violation, matching `RetentionWindow` under IO-17 (BODY-25), and `snapshot()` now starts the lazy drain the way `read()` does (BODY-22).
  - `Response.close()` marks the response closed only once the release actually succeeds, memoized so concurrent closers share one cancel — the shape `BufferedSink.close()` already uses (BODY-15, HTTP-43).

  Public API:

  - New `FormBodyValidationError`, reported by `isBodyError`. A form field whose value cannot be rendered is now raised instead of silently dropped from the body.
  - `FormUrlEncodedInput` accepts the new `FormUrlEncodedValue` (`string | number | boolean | bigint | null`); primitives render rather than vanish (HTTP-38/BODY-35).

- c1eb3aa: Add the core Body domain interface and implementations (ByteArrayBody, StringBody, FormUrlEncodedBody, StreamBody, MultipartBody, materialize, TypedResponse, HttpStatusError, toHttpError, withRequestLogging, withResponseLogging).

  `RequestBuilder.body` and `ResponseBuilder.body` narrow from `unknown` to `Body | undefined` and `ReadableStream<Uint8Array> | null` respectively — a breaking parameter-type change per `styleguide/typescript/10-api-design.md`. Resolving Phase 3b's open D1 finding (`docs/superpowers/specs/2026-07-23-nodejs-sdk-v1-roadmap-design.md`, "Open Findings — Phase 3b Validation Review"): kept as **minor** rather than major because `@dexpace/core` is still pre-1.0 (`0.0.0`), where a 0.x breaking change is conventionally released as minor (semver's own carve-out for initial development, https://semver.org/#spec-item-4). Revisit at 1.0.

- c1eb3aa: Phase 3 conformance fixes, from a review of the shipped `io/` and `body/` layers against the phase 3a/3b plans.

  Correctness:

  - The request-body logging tee now forwards **both** teardown paths to the sink it was handed. Its adapter stream
    declared `write` and `close` but no `abort`, and a `WritableStream`'s default abort algorithm is a no-op — so a
    delegate failure aborted the adapter and stopped there, leaving the caller's sink open, still locked, and never
    told the message was broken. A truncated body could be committed downstream as a complete one. `writeTo` also
    releases the writer when a delegate refuses before ever touching the adapter, which is what a `ConsumedBodyError`
    on a second write does (BODY-17, RECOV-12).
  - `StreamBody.writeTo` no longer cancels the caller's stream when the sink fails. The unknown-length path used
    `pipeTo`'s default `preventCancel: false`, which cancels the _source_ on a destination failure — taking
    cancellation ownership away from the caller on exactly the failure path, and disagreeing with the
    declared-length path, which only releases its reader. Both paths now leave the caller's stream alone (BODY-8).
  - Every `Body` variant is frozen at construction. `readonly` is erased at run time, so `contentLength` could be
    reassigned after construction and desynchronized from the bytes `writeTo` emits — the same declared-length drift
    `MultipartBody` shares one framing routine to prevent, left open on the field a transport stamps into
    `Content-Length` (HTTP-1, XCUT-15, HTTP-51).
  - `Response` regained the private constructor and `createResponse` friend hook that the body-lifecycle rewrite
    dropped. `Response` is exported as a value, so a public field-wise constructor let a caller construct around
    `build()`'s required-field validation, and it appeared in the published `.d.ts` (HTTP-2).
  - `TeeSink.write` validates its count. `IO-3`'s guard existed as three byte-for-byte copies and the tee — the
    fourth size-taking surface — had none, so a negative count was rejected only indirectly, and not at all on its
    `count === 0` and short-source early returns. The guard is now single-sourced in `io/limits.ts`.
  - `withResponseLogging` enforces the zero-length-chunk contract on the exceeds-cap tail path as well as the drain.
    A rule held in one regime and not the other made the same violating upstream pass or fail depending only on how
    big the body happened to be (BODY-25).

  Public API:

  - `Response` and the response-body logging wrapper no longer declare `[Symbol.asyncDispose]`; `close()` is the only
    teardown interface, matching every other resource-owning class in the package. The symbol postdates the declared
    `engines.node` floor (`>=18.17`), where it evaluates to `undefined` and binds the method to the string
    `"undefined"`, and its type reached the package only through a dev-only global — so a consumer compiling against
    the published `.d.ts` on this package's own declared `lib` failed with
    `TS2550: Property 'asyncDispose' does not exist on type 'SymbolConstructor'`. It returns, on all seven resource
    owners at once, when the runtime floor moves.
  - Every public symbol now carries TSDoc. The committed API report had accumulated 62 `(undocumented)` members,
    including 11 of `Response`/`ResponseBuilder`'s own that a wholesale file rewrite had dropped; it is back to zero.

  Internal:

  - `http/charset.ts`'s `decodeText` is renamed `decodeBodyText`. It shares a name with `io/text-codec.ts`'s
    `decodeText` while deliberately disagreeing with it: this one delegates every label to `TextDecoder` (so
    `iso-8859-1` follows the WHATWG mapping onto windows-1252) and consumes a leading BOM, which is right for a whole
    message body; the other implements true ISO-8859-1 for IO-13's round-trip and sets `ignoreBOM` so a mid-stream
    BOM survives as ordinary data (SSE-12). Reaching for the wrong one silently changes bytes.

- c1eb3aa: Phase 3 review pass 2. Five defects, each in the same class as one pass 1 already fixed — the earlier fixes
  were correct but did not reach every site the same reasoning applies to.

  Correctness:

  - `Response.bytes()`, `Response.text()` and `toHttpError()` now acquire the body reader **inside** the try, so
    the response is closed even when the read cannot start. `getReader()` itself throws a `TypeError` when an
    external consumer already holds the lock — which `BODY-15` explicitly forbids assuming away, and which
    `Response.close()` was already hardened for — so the one failure `BODY-16`'s close guarantee most needs to
    cover was the one that skipped the close entirely and held the connection open.
  - `MultipartBody.writeTo` verifies the bytes it writes against its own declared `contentLength`. The shared
    framing routine keeps the framing consistent but takes each part's own `contentLength` on trust, and
    `MultipartPart.body` is the public `Body` interface — so a caller implementation reporting one length and
    writing another desynchronized the value a transport stamps into `Content-Length` from what reaches the
    socket. An overrunning chunk is now refused before it is written, and a short total raises inside the writer
    scope so the sink is aborted rather than cleanly closed (HTTP-51, same shape as `StreamBody`'s HTTP-39 check).
  - `withRequestLogging` closes the primary sink when a delegate resolves without closing the adapter. It is the
    only place that takes a writer on behalf of someone else's `Body`, so a delegate that ignored `writeTo`'s
    close-the-sink contract stranded the caller's sink open and locked with nothing thrown to notice it by.
  - A foreign primitive source that over-reports its transferred count now raises `SourceContractViolationError`.
    It previously surfaced as `EndOfStreamError: delivered 2 of 99 bytes` — a foreign source's broken accounting
    reported as an exhausted stream, which is the exact confusion `IO-17` forbids and which the under-report
    direction was already guarded against (IO-17).

  Documentation:

  - `multipartBody`'s `boundary` parameter and `MultipartBodyBuilder.boundary` now state the obligation a
    caller-supplied delimiter carries. RFC 2046 requires the sender to pick a boundary that appears in no part,
    and that half cannot be checked here — a `StreamBody` part's bytes do not exist until the write, and a partial
    scan would read as a complete guarantee. The generated default (32 random characters from Web Crypto) is the
    mitigation, and is why it is the default.

  Tooling:

  - New blocking gate `verify:consumer-types`: compiles a throwaway consumer against the built `.d.ts` using the
    `lib` and `target` read from `tsconfig.base.json`, with `types: []`. This is the gate whose absence let pass
    1's `Symbol.asyncDispose` defect ship — `typecheck` passes on dev-only ambient globals, `build` emits
    regardless, `api` only compares a report, `lint:publish` checks resolution and export shape rather than
    whether declarations resolve, and `verify:dual-consumption` runs `node`, not `tsc`. Verified to fail on the
    reintroduced defect and pass once reverted.

- c1eb3aa: Raise `engines.node` from `>=18.17` to `>=20.3`, and `lib`/`target` from `ES2022` to `ES2023` with it.

  The declared floor was not real. `MultipartBody` generates its boundary from `crypto.getRandomValues`, and Node
  exposes `globalThis.crypto` unflagged only from **19.0.0** — never to an ES module on any 18.x release, verified
  on both 18.17.0 and 18.20.8. Every `multipartBody(...)` call threw `ReferenceError: crypto is not defined` on the
  version `engines.node` promised. `bun test` could not see it, because Bun supplies the global; the Node
  conformance suite caught it the first time it ran the built artifact on the pinned floor.

  The floor is `>=20.3` rather than `>=20.0` because `AbortSignal.any()` — `composeSignal`'s own floor-defining
  call, backported to 18.17.0 — reached the 20.x line only in 20.3.0. Confirmed by running the suite against a
  pinned 20.0.0, where `composeSignal` fails with `AbortSignal.any is not a function`.

  Raising the floor was chosen over the two alternatives that keep Node 18. A `node:crypto` fallback puts a
  Node-only specifier in a package documented as running on browsers, Deno, Bun and Workers, and cannot be reached
  synchronously from the constructor that needs it. A non-crypto fallback RNG silently downgrades the
  unguessable-boundary mitigation `HTTP-51` leans on against multipart injection, on exactly the runtime CI pins.
  Node 18 reached end of life in April 2025, so no supported runtime is dropped.

  Also in this change:

  - `verify:runtime-floor`'s pairing table moves its `es2023` row to `>=20.3`, with the built-ins the SDK calls —
    not the syntax it emits — named as the reason the floor sits above the language level's own minimum.
  - The `node-conformance` CI matrix pins `20.3.0` in place of `18.17.0`.
  - The conformance suite gains a case asserting `globalThis.crypto.getRandomValues` is a function **in ESM**, so
    this floor cannot regress silently. Node 18 exposed `crypto` to CommonJS while leaving it undefined in ES
    modules, so a CJS probe would have reported the old floor as satisfied.
  - `seams.test.mjs` holds the event loop open with a ref'd deadline while awaiting an `AbortSignal.timeout()`
    abort. That timer is unref'd on every Node version by design, so with nothing else scheduled the loop drained
    before it fired and Node 18.17.0's test runner cancelled the rest of the file. Newer runners kept the loop
    alive through handles of their own, which is why this passed on current LTS and failed only on the floor.
  - `sdk-design-nodejs/02`'s runtime-requirement line is corrected; it had claimed Node ≥18.17 supplies
    `globalThis.crypto.subtle`.

  `Symbol.asyncDispose` is still not declared anywhere. The symbols reached the 20.x line in 20.4.0, one patch
  above this floor, and re-adding them remains checkpoint §5.4's job across all seven resource owners at once.

- c1eb3aa: Add the configuration subsystem and the shared platform primitives (Phase 7a): the layered `Configuration` model with its `ConfigurationBuilder`, substitutable env/property seams, never-throw typed accessors, copy-on-write `derive`, the process-wide global slot, and the well-known `CFG_KEY_*` constants; the injectable `Clock` seam and `defaultClock`; RFC 1123 `formatHttpDate`/`parseHttpDate`; the shared `isRetryableStatus`/`RETRYABLE_STATUSES` classifier; `randomUuid`; the `ProxyOptions` model with `createProxyOptions`, `formatProxyOptions`, `shouldBypassProxy`, and `resolveProxyOptions`; and the `BuildInfo` descriptor behind `getBuildInfo`.

  `@dexpace/core`'s own version is now compiled in at build time by `scripts/gen-version.mjs`, which the package's `prebuild` step runs — so a runtime-emitted identifier reports the real version rather than an `unknown` placeholder, with no runtime `package.json` read on any runtime.

- c1eb3aa: Phase 7a review pass 2 (adversarial). Fourteen defects found by enumerating boundaries, failure paths, and
  lifetimes against the running code. The public API surface is unchanged — `etc/core.api.md` is
  byte-identical — but several of these change observable behavior, so they are recorded here.

  Security and availability:

  - `shouldBypassProxy` no longer compiles bypass globs to a regular expression. Translating `*` to `.*`
    produced adjacent unanchored runs, and a non-matching host then drove catastrophic backtracking: the
    operator-supplied `NO_PROXY` entry `*a*a*a*a*a*a*a*a*a*b` against a 60-character host blocked the event
    loop for 38 seconds. A two-pointer wildcard walk replaces it — 0.02ms on that case, `O(pattern × text)` at
    worst (CFG-23).
  - `getBuildInfo().identityTokens` is now header-safe at its source. The runtime identity is read from
    ambient values (`process.version`, `Deno.version.deno`, `navigator.userAgent`) that were returned
    untrimmed and unvalidated, so a single non-ASCII byte in a browser `navigator.userAgent` made the default
    `clientIdentityStep` reject **every** outbound request with a `HeaderValidationError`. An unusable value
    now falls back to `unknown` (CFG-36, RECOV-33, NFR-15).
  - `RETRYABLE_STATUSES` is genuinely immutable. The `ReadonlySet` type is compile-time only and
    `Object.freeze` does not seal a `Set`'s internal slots, so `(RETRYABLE_STATUSES as Set<number>).add(418)`
    succeeded and permanently rewrote the process-wide retry classifier for the whole program. `add`, `delete`,
    and `clear` now throw (CFG-35, RETRY-1).

  Correctness:

  - `resolveProxyOptions` honors an explicitly written default port. The WHATWG URL parser normalizes a
    special scheme's default port to the empty string, so `HTTP_PROXY=http://proxy:80` and
    `HTTPS_PROXY=https://proxy:443` — the two most common proxy configurations there are — both resolved to
    `null` and routed direct. CFG-25 bans _guessing_ an absent port, not honoring one the operator wrote; a
    URL with no port at all is still rejected (CFG-25).
  - `resolveProxyOptions` no longer throws a `URIError` on a literal `%` in proxy credentials. The
    percent-decode sat outside the parse `try`, and an un-encoded password containing `%` is ordinary operator
    input (CFG-24).
  - The layered lookup is total against any seam. A `Record`-backed source — `process.env` included — resolves
    a key named `__proto__`, `constructor`, or `toString` through `Object.prototype`, so `getString` returned a
    _function_ typed as `string | undefined` and `getInt`/`getBoolean`/`getDuration` died on a raw `TypeError`.
    A seam that throws escaped unwrapped through the same accessors. Both now fall through as "this layer
    supplies nothing" (CFG-5, CFG-6, CFG-7, CFG-11).
  - `Clock.sleep` rejects a duration above `2 ** 31 - 1` ms instead of firing almost immediately. `setTimeout`
    silently clamps a larger delay to `1`, so `sleep(2 ** 31)` returned in 7ms rather than waiting 24.8 days —
    an overflowed retry backoff became no backoff at all (CFG-17).
  - `Clock.sleep(0)` yields to the event loop rather than only to the microtask queue. The previous
    `Promise.resolve()` short-circuit let a zero-backoff loop spin 4.1 million times in 300ms without a pending
    `setTimeout(fn, 0)` ever running (CFG-17).
  - `formatHttpDate` rejects an instant outside the four-digit-year span RFC 1123 renders. `padStart(4, '0')`
    emitted the malformed `00-1` for year −1 and `275760` for `Date`'s upper limit, neither of which survived a
    round-trip back through `parseHttpDate` (CFG-29).
  - The proxy port accepts only a bare run of decimal digits. Bare `Number()` also read `0x10` as port 16,
    `1e2` as 100, `0b11` as 3, and `80.0`/`+80`, silently connecting to a port the operator never wrote
    (CFG-25).
  - An IPv6 proxy address resolves to the same bare form from either configuration tier, rather than bracketed
    from the environment URL and bare from the system property (CFG-22, CFG-24).
  - An empty user name means no credentials on both tiers, so a blank `https.proxyUser` no longer fabricates a
    masked `***:***@` for a proxy that has none (CFG-24).
  - `randomUuid` names its missing dependency when a runtime exposes no global WebCrypto, instead of reporting
    `TypeError: Cannot read properties of undefined (reading 'getRandomValues')` (CFG-32).
  - `setGlobalConfiguration` rejects a present-but-wrong value rather than only a null one, matching every
    other CFG-37 guard in the module (CFG-37).
  - `Configuration.getInt` normalizes `-0` onto `0`.

- c1eb3aa: Add the pagination engine for product-spec §12 (`PAGE-1`–`PAGE-36`). The public surface is `Paginator<T>`
  with its two views, the `Page<T>` resource, the `PageInfo<T>` / `pageInfo()` pair and the
  `PaginationStrategy<T>` interface, three built-in strategies (`cursorStrategy()`, `pageNumberStrategy()`,
  `linkHeaderStrategy()`), the fetcher-driven front end `paginateWithFetchers()` with `PagingOptions` and
  `FetcherPage<T>`, and the `PaginationError` leaf.

  The engine drives a `Transport` directly and stays serde-agnostic: item extraction is a caller-supplied
  callback on every built-in strategy, never a `Serde`. Resilience composes from outside — 4c's `Runtime` is
  itself a `Transport`, so a full retry/redirect/auth pipeline drops in as the `transport` field with no
  pagination-side change, recorded at `docs/work/mvp/2026-09-04-open-items-dissolution.md` §J5. The query splice and the `Link`
  tokenizer stay internal; publishing them would stand a second URL-manipulation surface next to Phase 1's
  `QueryParams`, which is the confusion the one-encoder rule exists to avoid.

  What landed under `packages/core/src/pagination/`: `page.ts`, `strategy.ts`, `paginator.ts`,
  `strategies.ts`, `link-header.ts`, `query-splice.ts`, `fetchers.ts`, and `errors.ts`, plus
  `test/node-conformance/pagination.test.mjs`.

  Three files changed outside it. `packages/core/src/http/query-params.ts` now exports
  `encodeQueryComponent`/`decodeQueryComponent` (both `@internal`, so the API report is unaffected) —
  `PAGE-22` restates HTTP-29's encoding rule verbatim, and two encoders in one codebase is a drift bug
  waiting to happen. `packages/core/src/testing/fake-transport.ts` gains `sentOptions`/`sentSignals`
  accessors and an init-object overload on `countingResponse()`. And `tsconfig.base.json` adds
  `ESNext.Disposable` to `lib` — see the caveat below, because that one reaches consumers.

  Five design calls worth recording:

  - **Each page is closed _before_ any of its items are yielded**, not in a `finally` after. `PAGE-11`
    mandates the ordering and `sdk-design-nodejs/07` §7.1's illustrative snippet shows the opposite — it
    closes after the yield, which holds the response open for the entire item walk and still passes the
    requirement's stated conformance test. Materialized items survive close (`PAGE-2`), so closing first
    costs nothing and means abandoning iteration mid-page can never strand a connection, however long the
    consumer takes. An erratum callout was added to §7.1; recorded at `docs/work/mvp/2026-09-04-open-items-dissolution.md` §J1.
  - **`PaginationStrategy.parse` is asynchronous, against `PAGE-5`'s literal wording.** The requirement says
    a strategy reads what it needs "synchronously inside parse"; this runtime has no synchronous body read,
    because the bytes may not have arrived. Every enforceable part of the intent — isolated, non-mutating,
    one read, no retained body — survives the promise and is stated on the interface, since none of it is
    expressible in the type system. Recorded at §J2. It cannot be "fixed" back to a synchronous signature.
  - **The query splice is hand-rolled rather than `URLSearchParams` or `QueryParams`.** Both re-serialize
    the _whole_ query through their own canonical encoding on every mutation: untouched parameters get
    reordered and re-encoded, against `PAGE-21`'s byte-for-byte rule, and a space becomes `+` rather than
    the `%20` this port standardizes on. `query-splice.ts` tokenizes the raw query substring and copies
    every untargeted byte through, sharing only the component _encoder_ — the part `PAGE-22` and `HTTP-29`
    genuinely agree on (§J4).
  - **`Link` parsing is a scanner, not a regular expression.** The separator rules are context-sensitive in
    two directions at once: a comma splits link-values only outside both angle brackets and quoted strings,
    and a semicolon splits parameters under the same condition — and quoted strings support `\"` escapes, so
    quote tracking cannot be a simple toggle. A target that fails to resolve is end-of-stream, not an error
    (`PAGE-19`), which is one of the few places in this codebase where swallowing an exception is the
    specified behavior rather than a smell.
  - **`items()` is re-iterable and `pages()` is single-use.** The asymmetry is deliberate: each `items()`
    walk closes every page before yielding, so a second iteration simply drives a second fetch sequence
    (`PAGE-8`), while `pages()` hands out live connection-owning objects whose re-iteration would
    double-consume unclosed resources (`PAGE-14`). `paginateWithFetchers()` is single-use for the same
    reason — a second loop would re-run `first()` and break `PAGE-34`'s "exactly once" (§J6).

  Limits worth knowing at the call site:

  - **`Page` declares `implements AsyncDisposable` unconditionally, and this package's declared `lib` grew
    `ESNext.Disposable` to make that compile.** A consumer compiling the published `.d.ts` needs the same
    lib entry (`"ESNext.Disposable"`, or `esnext`) or `Page` will not typecheck for them. This is also the
    one place the SDK is now internally inconsistent about explicit resource management: `Response`
    (`HTTP-38`) and Phase 6b's `SseStream` install `[Symbol.asyncDispose]` behind a runtime guard precisely
    because the declared `engines.node` floor is `>=20.3` and the symbol landed in 20.4, where a computed
    key evaluating to `undefined` binds the method to the string `"undefined"` instead. `Page` takes the
    unguarded route (§J3), so on the declared floor `await using page = ...` does not dispose and the class
    carries a stray `"undefined"` method. `test/node-conformance/pagination.test.mjs` does not catch this —
    its `page[Symbol.asyncDispose]` lookup coerces the key the same way the class definition did, so the
    assertion passes on 20.3 without exercising anything. Resolving this one way or the other is a
    floor-bump decision, not a pagination one.
  - **Cancellation cannot reach a response the engine never received** (`PAGE-33`). If `signal` aborts
    before the transport delivers, releasing that response is the transport's job. A request already
    dispatched may still complete after the abort; when it does, the engine closes and discards it rather
    than yielding it.
  - **`PaginationError` is reserved for engine misuse** — a non-positive `maxPages` at construction
    (`PAGE-9`), or a second iterator on a single-use view (`PAGE-14`). Transport, parse, and close failures
    propagate as whatever the underlying layer raised, because `PAGE-28` requires the original cause to
    surface rather than a pagination-flavored wrapper (§J8).
  - **Ownership transfers to the page.** A fetcher builds a `Page` and must not close its response; the
    engine closes it as the consumer advances and at exhaustion. A fetcher that throws _before_ building the
    page still owns whatever response it opened — the engine never saw it and has no handle to close it
    with.
  - **Two built-in strategies defend against servers that never signal termination.** `cursorStrategy`
    treats an empty-string cursor as end-of-stream alongside `null`, and `pageNumberStrategy` stops on an
    empty item list before any arithmetic runs. Both would otherwise walk forever against a server that
    keeps answering past the end.

- c1eb3aa: Ship the authentication layer (product-spec §11, `AUTH-1`–`AUTH-38`) and promote the pillar-authoring surface
  to the public barrel. **This is the first release with new public API since Phase 1.**

  `minor`, not `patch`: `packages/core/etc/core.api.md` gains the whole pipeline-authoring surface plus the auth
  configuration types its signatures name, and `RequestOptions` gains one member. Nothing is removed or
  narrowed, so no consumer breaks.

  ## What a caller can now do

  ```ts
  import {
    ApiKeyCredential,
    createAuthDescriptor,
    createAuthRequirement,
    standardResilience,
  } from "@dexpace/core";

  const client = standardResilience(transport, {
    auth: {
      credentials: {
        apiKey: { credential: new ApiKeyCredential(process.env.API_KEY ?? "") },
      },
      tiers: {
        client: createAuthDescriptor([createAuthRequirement("API_KEY")]),
      },
    },
  });
  ```

  `standardResilience()` installs redirect, retry, and auth in that order — `AUTH-27`'s "redirect wraps retry
  wraps auth" — so auth re-resolves and re-stamps per redirect hop and per retry attempt. `PipelineBuilder`,
  `retryStep`, `redirectStep`, and `authStep` are exported for hand-assembling a pipeline instead, and
  `PipelineBuilder.seedFrom(runtime, 'flatten' | 'nest')` composes one pipeline onto another with the choice
  explicit rather than accidental (`PIPE-35`).

  ## What landed

  The scheme-agnostic descriptor/resolver model (`AuthScheme`, `AuthRequirement`, `AuthDescriptor`,
  `resolveAuthRequirement`), the credential types (`BearerToken`, `ApiKeyCredential`, `NameKeyCredential`,
  `TokenProvider`), a total RFC 7235 challenge parser, a dependency-free MD5, the Basic/Digest/static-key
  stamping handlers, a single-flight three-zone bearer token cache, and one AUTH pillar step tying them
  together. `RequestOptions` gains `auth?: AuthDescriptor`, which fills `AUTH-4`'s most-specific `perCall` tier.

  Zero runtime dependencies still (`SEAM-1`). SHA-256 and the Digest client nonce go through
  `globalThis.crypto`, and Basic stamping through `globalThis.btoa`, never `node:crypto` — the package stays
  portable to browsers, Deno, and Workers. MD5 is hand-rolled because Web Crypto deliberately excludes it and
  RFC 7616 still requires it for interop.

  ## Design calls worth recording

  - **Basic and Digest never stamp preemptively.** Both are phrased in §11 entirely in terms of answering a
    parsed challenge, and Digest structurally cannot stamp before seeing the server's `realm`/`nonce`. `OAUTH2`
    and `API_KEY` do stamp preemptively; `NO_AUTH` never stamps. Flagged as an interpretation, not a certainty
    — Phase 9's conformance sweep re-checks it.
  - **One auth step with one pluggable challenge hook, not three mechanisms.** `AUTH-27` mandates exactly one
    step, yet `AUTH-30`, `AUTH-23`–`AUTH-26`, and `AUTH-34`–`AUTH-37` read as three. Reconciled as one step,
    one `challengeHook` extension point, and a scheme-dependent default body. A caller may override the hook
    entirely — for a custom OAuth2 grant, say — and it takes precedence over every scheme default.
  - **The cross-origin marker suppresses the WHOLE hop, not just the outbound pass.** The redirect step
    (Phase 5b) marks a cross-origin re-issue; the auth step is that marker's intended consumer. It skips the
    HTTPS guard, skips stamping, clears the marker so it never reaches the wire — and declines to answer a 401
    on that hop, because answering it would stamp exactly the credential the outbound pass withheld, onto a
    server-chosen foreign host.
  - **A `TokenProvider` takes no arguments and must carry its own deadline.** `AUTH-34` coalesces every
    concurrent caller racing on a missing or expiring token onto ONE fetch, so that fetch belongs to no single
    request — handing it one caller's signal would let a stranger's cancellation reject callers who never
    aborted, and let a request that merely finished tear down a refresh others were joined to. Each caller
    instead races its own wait against its own signal, cancelling the wait without cancelling the work. Because
    nothing could ever populate a signal parameter, the type has none: write providers as
    `() => fetchToken({signal: AbortSignal.timeout(5_000)})`.
  - **`ChallengeHook` receives the call's signal.** Unlike a token fetch, a hook is not shared between callers,
    so the same reasoning that withholds the signal above positively requires passing it here — a hook running a
    custom OAuth2 refresh grant is network I/O on the request path. The hook's third parameter is optional and
    additive: an existing two-argument hook still type-checks. `authStep` also declines to spend a second wire
    send on the replay once the caller has aborted, and skips the hook entirely when the call was already
    abandoned before the challenge arrived — matching the redirect and retry pillars.
  - **A Digest challenge this client cannot echo is declined, not answered.** A received header may legally
    carry non-ASCII (`Digest realm="café"` is a real RFC 7616 shape), but an outbound header value may not, and
    loosening that is the request-splitting defence. Such a challenge is now reported as unsatisfiable, so the
    401 surfaces unchanged rather than the step throwing. A non-ASCII configured Digest _username_ is caller
    misconfiguration and is rejected up front; RFC 7616 `username*` encoding is not yet supported.
  - **Every credential type is a nominal class that redacts its secret.** `BearerToken`, `ApiKeyCredential`, and
    `NameKeyCredential` each hold their secret in a `#` field, so `console.log`, `util.inspect`,
    `JSON.stringify`, and `Object.keys` all see a redacted form and never the value. Build them through
    `createBearerToken`/the constructors — an object literal is not assignable, which is also what stops a
    `TokenProvider` handing back a token that skipped the non-blank validation.
  - **One clock for the whole pipeline.** `AuthStepSettings.clock` is the `now()` half of the same `Clock`
    `RetryStepOptions.clock` takes, so one instance drives both pillars and a test cannot fake time for one and
    forget the other.
  - **`challengeHook` is the only challenge-reaction extension point.** There is deliberately no
    `handlers` field: the built-in Basic and Digest handlers are internal, so a caller-supplied list could only
    replace them wholesale, never compose with them. A hook covers the custom-scheme case with a shape a caller
    can actually satisfy.
  - **One bearer strategy, not two.** The reference ships a synchronous single-flight policy and a separate
    async three-zone policy because it has two pipeline execution stories. This port has one, so the three-zone
    policy ships unconditionally and `AUTH-34`'s non-blocking cached read is its fresh-zone branch. Same shape
    as the retry engine's `RETRY-28` collapse.
  - **`AUTH-31`'s replayability gate applies to every replacement — and gates only the replay.** The reference
    gates only its sync step and recommends a port extend it; one unified step leaves exactly one place to apply
    it. A non-replayable body skips the re-drive, but the challenge is still handled, so a 401 on a streaming
    upload still evicts the token the server rejected instead of leaving it cached for every later request.
  - **A refresh margin is validated, and so is a token's expiry.** `bearerMarginMs`, `BearerCredential.marginMs`,
    and `createBearerToken`'s `expiresAt` must all be finite. Expiry is evaluated as `now + margin > expiresAt`,
    which is `false` for `NaN` — an unvalidated margin (`Number(process.env.MARGIN_MS)` on an unset variable)
    made the cache read a long-dead token as fresh and serve it forever without ever calling the provider again.
  - **A failed background token refresh can never fail the request that triggered it.** `AUTH-37` says so
    unconditionally, so the failure is swallowed unconditionally — including a programmer-error-shaped one. The
    alternative re-raised it into a promise nobody awaits, which does not surface at the fault: it terminates the
    host process asynchronously, unattributable to any request, while the request that triggered it had already
    been served a valid token.
  - **A failing response release never masks the error it was unwinding from.** If the challenge hook throws and
    closing the 401's body then also fails, the hook's error stays primary and the teardown failure rides along
    as `suppressed` (`RECOV-12`), matching the redirect and retry pillars.

  `standardResilience()` leaves the `LOGGING` slot empty — Phase 7b installs `loggingStep()` there and gives
  `AUTH-37`'s failed-background-refresh case somewhere to be recorded. `SERDE` stays reserved.

- c1eb3aa: Add the serde seam. `Serde`/`Serializer`/`Deserializer` are reshaped around an explicit schema
  witness supplied at each decode call, closing `SEAM-21` — `Serde` is no longer generic in a payload
  type, because a bundle is per wire format, not per DTO. Ships alongside it: `Tristate<T>` and its
  helpers for PATCH three-state fields, the `SerializationError`/`DeserializationError` leaves with an
  `isSerdeError` guard, `serdeBody()` (the serde's own media type becomes the default `Content-Type`),
  and the `decodeResponse()`/`decodeSuccessResponse()` response handlers.

  `decodeResponse()` passes through every error already in the SDK's typed tree rather than re-typing
  it, so a stream failure raised by this SDK's I/O layer reaches the caller unwrapped (`SERDE-12`). A
  foreign transport's stream error is indistinguishable from a non-conforming codec leaking one and is
  still surfaced as `DeserializationError`; both handlers' `@throws` state that limit and name the
  affected transports. A body already locked by another consumer raises a plain `TypeError`, matching
  `Response.bytes()`, instead of being reported as a malformed payload.

- c1eb3aa: Add the Server-Sent Events subsystem for product-spec §13 (`SSE-1`–`SSE-41`). The public surface is
  `sseStreamFrom()` and the `SseStream` facade it returns, `typedSseStream()` with the `MapperOutcome<T>`
  union and its `mapperValue()` / `MAPPER_SKIP` / `MAPPER_DONE` constructors, the `SseEvent` value with
  `makeSseEvent()` / `sseEventsEqual()` / `sseEventToString()` / `isSseEventEmpty()`, and two error leaves,
  `SseStreamError` and `SseLineTooLongError`.

  Pull-based with no read-ahead (`SSE-39`): one consumer pull drives at most one parse, and nothing is
  buffered speculatively. No reconnection and no `Last-Event-ID` continuity (`SSE-38`) — both remain the
  caller's responsibility, and both are now gate-enforced rather than merely documented.

  The line reader and the parser stay internal. They are driven only through the facade, and publishing them
  would publish a way to violate `SSE-17`'s non-ownership contract by accident: neither closes the
  `BufferedSource` it reads, because lifecycle belongs to `SseStream` alone.

  What landed under `packages/core/src/sse/`: `event.ts` (the frozen value and its operations),
  `line-reader.ts` (byte-level line framing plus the opt-in cap), `parser.ts` (the field grammar and
  dispatch rules), `stream.ts` (the resource-owning facade and `sseStreamFrom()`), `typed.ts` (the mapper
  adapter), and `errors.ts`. Outside the package: `scripts/verify-sse-37.mjs` with its own test, a CI step
  that runs it, and `test/node-conformance/sse.test.mjs`.

  Four design calls worth recording:

  - **SSE frames its own lines rather than reusing `BufferedSource.readUtf8Line()`.** Phase 3a's primitive
    treats `\n` and `\r\n` as terminators but keeps a lone `\r` as line _content_ (`IO-14`); `SSE-2`
    requires the opposite, where a lone CR terminates a line by itself. Both contracts are normative for
    their own subsystem, so reshaping the frozen Phase 3a surface for one consumer was the wrong trade. The
    duplication is deliberate and recorded at `docs/work/mvp/2026-09-04-open-items-dissolution.md` §I2 so Phase 10's deviation review does
    not read it as accidental. The awkward case it exists to get right is a `\r` ending one chunk whose `\n`
    begins the next: the pending CR is held until the following byte — or EOF — is known, so the pair
    resolves to a single terminator.
  - **`SSE-37`/`SSE-38` are enforced by a script, not by a type.** Nothing in the type system would catch
    somebody "helpfully" adding a reconnect loop or a `Last-Event-ID` header, so `verify:sse-37` scans
    `src/sse/` for serde imports and for reconnection markers. It scans **comments-stripped** source on
    purpose: the requirement forbids the code path, not the documentation of its absence, and "this
    subsystem never reconnects; that is the caller's job" is the single most likely sentence to appear in a
    TSDoc there. A gate that fails on its own requirement's explanation is a gate the next person deletes
    instead of the comment.
  - **`[Symbol.asyncDispose]` is installed at run time, not declared on the class.** The declared
    `engines.node` floor is `>=20.3` and the symbol landed in Node 20.4, where a computed key that evaluates
    to `undefined` binds the method to the string `"undefined"` instead — wrong, silent, and only at run
    time. Declaring the member would also break consumers compiling the published `.d.ts` on a plain
    `ES2023` lib. `SseStream` therefore installs it behind a `typeof Symbol.asyncDispose === 'symbol'`
    guard, matching `Response` (`HTTP-38`). Recorded at §I3; it becomes an unconditional `implements
AsyncDisposable` when the floor moves past 20.4. Note that Phase 6c's `Page` resolves the same question
    the other way — see that changeset.
  - **`MapperOutcome<T>` is a sibling of Phase 4b's `Outcome<T>`, not a third variant on it.** `Outcome<T>`
    is a two-branch success/failure union threaded through the recovery chain; widening it with `skip` and
    `done` would force every `fold` call site in `src/recovery/` to handle variants that can never occur
    there. What `sdk-design-nodejs/07` §7.2 asks to reuse is the _idiom_ — a `kind`-discriminated union over
    frozen literals.

  Limits worth knowing at the call site:

  - **The line cap is opt-in and off by default** (`SSE-19`), matching the reference's own absence of a cap.
    Set `maxLineBytes` to bound memory against a server that never sends a terminator; exceeding it raises
    `SseLineTooLongError`, which carries `limitBytes` as a field so a log aggregator indexes it without
    parsing the message.
  - **`signal` adds a trigger, not a code path.** Aborting closes the stream, which is all the cancellation
    a pull-based reader needs: an iterator sitting _between_ pulls ends cleanly (`SSE-27`), and one blocked
    _in_ a read surfaces an `IoError` (`SSE-31`). Both paths release the owned resource exactly once.
  - **A release failure on a clean terminal path is swallowed and reported out-of-band** (`SSE-30`), because
    throwing would discard events already delivered. `onReleaseFailure` receives it and defaults to a no-op;
    Phase 7 wires a real `Logger` there without reshaping the class. An explicit `close()` still propagates.
  - **A bodyless response is rejected rather than yielding an empty stream** (`SSE-32`). It is a server or
    caller mistake, and silently producing zero events would hide it behind a successful-looking loop that
    does nothing.
  - **`SSE-41`'s reactive `Observable` view is not here.** It is a MAY, and the roadmap scopes §18's
    async-runtime adapters to Phase 8b (`@dexpace/rx`). Deferral recorded at §I1. `SSE-21`'s hash-equality
    clause has no JavaScript analogue; value equality ships as `sseEventsEqual()` (§I4).

- c1eb3aa: Add the instrumentation and observability subsystem (Phase 7b):
  - The `Logger` / `LogEvent` structured logging facade and `createLogger` builder, with zero-allocation `NOOP_LOGGER`, four severity levels, 4-tier precedence folding, safe total field rendering with 8 KiB truncation, at-most-once single emission, and global logger slot (`getGlobalLogger`/`setGlobalLogger`).
  - AsyncLocalStorage-backed diagnostic context (MDC) allow-list filtering (`trace.id`, `span.id`).
  - Redaction policy for URLs and headers with default-deny allow-listing.
  - OpenTelemetry-compatible tracing SPI (`Tracer`, `Span`, `SpanContext`, `Scope`, `activateSpan`, `activateSpanForCorrelation`) and W3C Trace Context generation (`createInstrumentationBundle`).
  - Metrics SPI (`Counter`, `Histogram`, `Meter`, `NOOP_METER`).
  - The `LOGGING` pillar step (`loggingStep`, `LOGGING_STEP_TYPE`) with configurable granularity (`none`, `headers`, `body`), bounded body previews, asymmetric `OBS-20` failure containment, and installation into `standardResilience()`.
  - Adapter packages: `@dexpace/logging-pino` and `@dexpace/logging-debug`.
- c1eb3aa: Add the transport adapters (Phase 8a) — the first code in this SDK that puts bytes on the wire:
  - `@dexpace/transport-fetch`: a `Transport` over the runtime's global `fetch`, with zero dependencies beyond its `@dexpace/core` peer. No `proxy` option exists at all (an absent option, not a silently ignored one), and `close()` is a sanctioned no-op over a runtime global it does not own.
  - `@dexpace/transport-undici`: the full-featured `Transport`, taking exactly one external dependency. Ownership-aware `close()` over the dispatchers it constructed (never a bring-your-own one), `NO_PROXY` bypass routed over a separate direct `Agent`, direct file-body dispatch honoring `start`/`count`, and a native-internal cancel told apart from a timeout.
  - `@dexpace/body-file`: the concrete `fileBody()` factory, with fail-fast `node:fs` construction validation, a fresh handle per write, and short-write detection. Transports recognize it structurally through `body.kind === 'file'`, never a cross-package `instanceof`.
  - `@dexpace/transport-shared`: the header drop/degrade pass, drop-log dedup policy, abort-to-SDK-error mapping, request-body pump, and delivery-detached signal fork — `@internal` exports both transports share so the one algorithm exists once rather than twice.
  - `@dexpace/core` gains `TransportFailureError` (the canonical retryable no-response failure, an `IoError` subtype) and the type-only `FileBodyDescriptor` plus a `'file'` member on `Body['kind']`. `IoError` is promoted from `@internal` to `@public` as its base class. Note for TypeScript consumers: widening `Body['kind']` is additive for anyone _implementing_ `Body`, but an exhaustive `switch (body.kind)` with a `never` default will stop compiling until it handles `'file'`.
  - Both transports are proven against one shared `TRANSPORT-N` conformance suite and are `AsyncDisposable`, so `await using` is a single teardown path. Both also keep a handler on a streaming request body's producer for the whole send: a producer that fails _after_ the response was delivered (an early `413`, say) is an observed rejection rather than one that reaches the runtime's default `unhandledRejection` policy. `@dexpace/transport-undici` additionally reports undici's argument-validation failures outside the `IoError` tree, so a permanent misconfiguration is terminal rather than retried to exhaustion.
- c1eb3aa: Guard every `[Symbol.asyncDispose]` install behind a runtime check, so disposal is never promised on a Node version that does not have the symbol.

  `Page`, `FetchTransport`, and `UndiciTransport` each declared `[Symbol.asyncDispose]` as a plain computed class member. `Symbol.asyncDispose` arrived in Node **20.4**, but every package here declares `engines.node: ">=20.3"`. On the declared floor the computed key evaluates to `undefined`, so the method was bound to the string key `"undefined"` — leaving a junk prototype entry and **no working disposal**, while the emitted `.d.ts` promised `AsyncDisposable` unconditionally. `SseStream` was already guarded, and `Response` carries a regression test asserting the absence of exactly this junk key (`http/response.test.ts`); these three sites had reintroduced it.

  The installs now match `SseStream`: `Object.defineProperty` behind `typeof Symbol.asyncDispose === 'symbol'`. Disposal works unchanged on Node 20.4+.

  Breaking, in the type system only:

  - `Page` no longer declares `implements AsyncDisposable`, and its `.d.ts` no longer declares `[Symbol.asyncDispose]`.
  - `fetchTransport()` returns `Transport` rather than `Transport & AsyncDisposable`.
  - `undiciTransport()` returns `Transport` rather than `Transport & AsyncDisposable`.

  `await using page = ...` / `await using transport = ...` therefore no longer type-checks. This is deliberate: the declaration was only ever true on Node 20.4+, and on the floor it type-checked a call that silently did nothing — for `undiciTransport` that meant leaking every pooled connection. Call `close()` instead, which has always been the real teardown path and is unchanged. Consumers pinned to Node 20.4+ who want `await using` back can reach the installed symbol through a cast.

  The floor will not be raised to `>=20.4` to restore the declaration. `NFR-10` requires a capability that needs a newer runtime to be isolated into its own unit declaring that higher floor, never to raise the floor of the general-purpose core; it also requires the emitted-artifact target and the visible-API level to agree, which is the clause the unguarded member violated. `>=20.3` is in any case derived rather than chosen — it is the lowest Node that runs what these packages emit, set by `globalThis.crypto` (absent from ESM on every Node 18 release) and `AbortSignal.any()` (20.3.0). The guarded install is the permanent shape.

  `Paginator.pages()`'s published TSDoc is corrected to match: it had discharged `PAGE-12`'s "consumers MUST be told to wrap the view in a scoped/auto-close construct" clause by naming `await using` alongside `for await`, which no longer type-checks. It now names the two constructs that do give the guarantee — a `for await` loop, or `.return()` from a `finally` when you drive the iterator by hand — and says why `await using` is not a third.

  Kept as **minor** rather than major because these packages are pre-1.0 (`0.0.0`), per the same semver initial-development carve-out the earlier `Body` narrowing used.

- c1eb3aa: Publish ten symbols that the emitted `.d.ts` already told consumers about but no package exported.

  **The redirect guard** (`docs/work/mvp/2026-09-04-open-items-dissolution.md` U7). `withRedirect(builder, overrides?)` and
  `stripCrossOriginMarkerStep()` are now public. `redirectStep()` marks a cross-origin hop with an
  internal header and relies on a second `POST_AUTH` step to strip it before dispatch (`REDIR-11(c)`);
  that step was `@internal`, so `withRedirect`'s own instruction — "a caller who installs
  `redirectStep()` directly is responsible for installing the guard too" — named an obligation no
  consumer could discharge. `standardResilience()` and `PipelineBuilder.seedFrom()` were the only safe
  routes to a redirect pipeline; `withRedirect(builder)` is now the direct one.

  **Eight catchable error classes** (`docs/work/mvp/2026-09-04-open-items-dissolution.md` U9): `PillarCollisionError`,
  `ReservedStageError`, `AnchorNotFoundError`, `CrossStageEditError`, `CursorAlreadyAdvancedError`,
  `EndOfStreamError`, `SchemeDowngradeError` and `NonReplayableBodyError`. Each is the subject of a
  `@throws` tag on a public symbol, and each shipped into the `.d.ts` — so a consumer read the tag,
  reached for `instanceof`, and had nothing to reach for. `error.name` was the only handle.

  `InvariantViolation` stays unexported and `@internal`: it signals a bug rather than a condition, and
  extends `Error` rather than `DexpaceError`. Its `@throws` tags on public symbols now read as prose —
  "an assertion failure (a caller bug, not a catchable condition)" — instead of naming a class nobody
  can catch. `DuplicateContextKeyError` likewise stays behind the `@internal` `ContextStore`.

  **Two new error classes, both from `XCUT-8`** (`docs/work/mvp/2026-09-04-open-items-dissolution.md` N2/V14):

  - `HttpStatusValidationError` — `HttpStatusError`'s constructor now validates that `status` is an
    integer in HTTP-11's 400–599 band and throws this otherwise. The class documented that invariant
    and never enforced it, so `new HttpStatusError(200, …)` built the "successful exception" `XCUT-8`
    forbids. **This is the one behavioural break in this changeset**: a caller constructing an
    `HttpStatusError` out of band now gets a throw. `toHttpError` is unaffected — it is the total form
    and still returns `null` for any status outside the band.
  - `RetryDiscardedResponseError` — the retry engine's trail entry for a response it discarded whose
    status is outside 400–599, reachable only by widening `RetrySettings.retryableStatuses` to include
    a non-error code. The engine used to fabricate `new HttpStatusError(<that status>, …)` there, so
    core itself built the object the requirement forbids and the trail claimed an HTTP failure that had
    not occurred. A discarded 4xx/5xx still yields `HttpStatusError` exactly as before.

  Otherwise additive: nothing else was removed or narrowed.

- c1eb3aa: Remove `DomainModelError` as a class tier. The ten HTTP domain-model error leaves — `RequiredFieldError`, `HeaderValidationError`, `MediaTypeParseError`, `ProtocolParseError`, `UrlConstructionError`, `RequestOptionsValidationError`, `EtagParseError`, `HttpRangeValidationError`, `RequestConditionsValidationError` and `RequestBodyNotAllowedError` — now extend `DexpaceError` directly, and a new `@public` `isDomainModelError` type guard groups them.

  **This is a breaking change to published API.** `DomainModelError` was a barrel export and a runtime value, so `instanceof` narrowing on it was live public API, and it is gone. The migration is one line: `if (error instanceof DomainModelError)` becomes `if (isDomainModelError(error))`, which narrows to the same ten-class union, so nothing downstream of the check changes.

  The class earned its removal by doing nothing: it was an empty marker (`export class DomainModelError extends DexpaceError {}`), nothing in the SDK ever narrowed on it, and the corpus caps custom error hierarchies at two levels. Core had already stopped feeding it — `HttpStatusValidationError` landed as a two-level leaf under `DexpaceError` rather than as an eleventh leaf on the tier.

  **The taxonomy stays mixed, and that is deliberate.** `TransportFailureError extends IoError` is still three levels. `TRANSPORT-20` is a MUST requiring the canonical transport failure to be a subtype of the platform IO exception so existing `catch (IOException)` sites keep matching, and `retry/classify.ts` walks the cause chain with `current instanceof IoError` to make such a failure unconditionally retryable; removing that tier would break a MUST and a live retry path (`docs/deviations.md` item 17). This change removes the one gratuitous three-level tier and leaves the one the specification requires — it does not make the tree uniformly two-level.

  Kept as **minor** rather than major because `@dexpace/core` is still pre-1.0 (`0.0.0`), where a 0.x breaking change is conventionally released as minor (semver's own carve-out for initial development, https://semver.org/#spec-item-4). Revisit at 1.0.

- c1eb3aa: Give `AuthTiers.operation` a source: `RequestOptions` gains `operationAuth`, a second per-call slot
  that `effectiveTiers()` folds into AUTH-4's middle tier (AUTH-4, AUTH-5, AUTH-6, AUTH-7). Additive —
  no signature changed and no behavior changed for a caller who does not set it.

  `AuthTiers` has always resolved `perCall ?? operation ?? client`, and nothing in the workspace could
  write the middle slot. The cost was measured rather than assumed: `examples/petstore/FINDINGS.md` §4
  found that a consumer with per-operation descriptors had to fold them itself —
  `const auth = call.auth ?? operation?.auth` — which reimplements the top two-thirds of AUTH-4's
  precedence chain in consumer code, and leaves core unable to tell a caller's genuine per-call
  override from an operation's declared requirement once they arrive in the same slot. Every generated
  SDK would have carried that fold.

  ```ts
  const options = RequestOptions.newBuilder()
    .auth(callerOverride) // may be undefined
    .operationAuth(operation.auth) // the operation table's static declaration
    .build();
  ```

  `effectiveTiers()` applies each slot only when present, so a configured tier is never overwritten
  with `undefined` — spreading an absent `perCall` would have erased one the AUTH step was constructed
  with.

  The other option the spike named — carrying the operation descriptor as a separate `StepContext`
  field — was not taken. `StepContext.options` already travels from `Runtime.send` through every retry
  attempt and redirect hop, and is where `authStep` reads the per-call descriptor today; a parallel
  carrier for the same lifetime would have widened the pipeline's plumbing for one consumer.

  Verified by deleting the fold it exists to remove: `examples/petstore/src/service-core.ts` now fills
  both slots and lets core resolve the chain, and the spike's canary passes unchanged.

  See `docs/work/mvp/2026-09-04-open-items-dissolution.md` W1.

- c1eb3aa: `Runtime.send()` now opens one span per logical operation (OBS-29), and `createRuntime` takes an
  optional context init supplying the instrumentation bundle it comes from. Additive — a runtime built
  without one behaves exactly as before.

  `OBS-29` requires that one tracer instance correspond 1:1 to a single logical operation. The port
  had spans, but `PIPE-2` fixes the LOGGING pillar step _inside_ the RETRY and REDIRECT pipelines, so
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

- c1eb3aa: Publish `clientIdentityStep` and `ClientIdentitySettings` on the package barrel (RECOV-33, NFR-15).
  Purely additive: `packages/core/etc/core.api.md` gains ten lines and loses none, and the step's
  behavior, defaults and error paths are unchanged.

  `RECOV-33`'s identity-stamping step has been implemented and tested since Phase 7a, and unreachable
  for just as long — tagged `@internal`, absent from the barrel, and installed by nothing.
  `standardResilience` does not install it, so the step's own TSDoc instruction ("a caller adds it to
  their own pipeline") named an action no caller could take. Every other step factory was already
  public: `authStep`, `retryStep`, `redirectStep`, `loggingStep`, `stripCrossOriginMarkerStep`.

  The blocker that kept it internal is gone and had been for two phases. The barrel comment claimed
  its `StepDescriptor` return type was "part of the still-internal pipeline authoring surface", which
  stopped being true when Phase 5c promoted `StepDescriptor`, `Stage`, `Step`, `StepContext` and
  `PipelineBuilder`. Exporting the step therefore names no forgotten export, and api-extractor accepts
  it unchanged.

  Its file stays at `packages/core/src/config/client-identity-step.ts`. A `@public` symbol named on the
  barrel against its own module path has an invisible folder, and relocating it to `recovery/` would
  trade its one outbound `→ pipeline/` edge for a new `→ config/` one for `./build-info.js`.

  Usage:

  ```ts
  import { clientIdentityStep, PipelineBuilder } from "@dexpace/core";

  const runtime = new PipelineBuilder(transport)
    .append(clientIdentityStep({ tokens: ["acme-sdk/1.2.3"], mode: "append" }))
    .build();
  ```

  See `docs/work/mvp/2026-09-04-open-items-dissolution.md` K1 (fixed) and K11 (closed).

- c1eb3aa: Publish the four flat I/O error leaves, `isIoError`, and the `SuppressedErrorLike` type. Additive —
  no class changed, no hierarchy moved, and nothing was renamed.

  Newly on the barrel: `SourceContractViolationError`, `ClosedResourceError`, `AllocationLimitError`,
  `isIoError`, and `SuppressedErrorLike` (a type, not the class). `IoError`, `EndOfStreamError` and
  `TransportFailureError` were already there.

  A caller receives these today and had no name to catch them by. `decodeResponse`'s guard is a single
  `e instanceof DexpaceError` pass-through — anything already in this SDK's typed tree is never
  re-typed — so a body stream that fails with a `ClosedResourceError` or an `AllocationLimitError`
  delivers exactly that class, identity preserved, to a caller who could not `import` it. `isIoError`
  is the category catch a deliberately flat error tree cannot offer through `instanceof`:

  ```ts
  import { isIoError } from "@dexpace/core";

  try {
    await decodeResponse(response, deserializer, { schema });
  } catch (error) {
    if (isIoError(error)) retry();
  }
  ```

  `SuppressedErrorLike` is exported as a type because `instanceof SuppressedError` is **not** a valid
  test on this package's declared `engines.node >=20.3` floor, where the global is absent. A caller
  narrowing a decode failure whose release also failed needs the structural shape — `name` is
  `'SuppressedError'`, `.error` is the primary throwable, `.suppressed` rides along — not a class.

  This completes the taxonomy the previous release started: `DomainModelError` was flattened and
  replaced with a `@public isDomainModelError` guard, making "two levels, plus an exported guard per
  family" the settled shape. `isIoError` is that guard for `io/`, and `isBodyError` was already public.

  See `docs/work/mvp/2026-09-04-open-items-dissolution.md` H8.

- c1eb3aa: **Breaking to the `Serde` SPI, taken deliberately before the first published version.** Every decode
  entry point now takes a `DecodeTarget<T>`, the two stream-driving methods take `{signal}`, and
  `DecodeTarget` gains an `admitsNull` opt-in.

  ```ts
  // before
  deserialize<T>(data: Uint8Array, schema: Schema<T>, typeName?: string): T;
  deserializeFrom<T>(source: ReadableStream<Uint8Array>, schema: Schema<T>, typeName?: string): Promise<T>;
  serializeTo(value: unknown, sink: WritableStream<Uint8Array>): Promise<void>;

  // after
  deserialize<T>(data: Uint8Array, target: DecodeTarget<T>): T;
  deserializeFrom<T>(source: ReadableStream<Uint8Array>, target: DecodeTarget<T>, options?: {signal?: AbortSignal}): Promise<T>;
  serializeTo(value: unknown, sink: WritableStream<Uint8Array>, options?: {signal?: AbortSignal}): Promise<void>;
  ```

  Migration is mechanical: `d.deserialize(bytes, schema, 'Dto')` becomes
  `d.deserialize(bytes, {schema, typeName: 'Dto'})`.

  **One spelling, both layers.** `decodeResponse`/`decodeSuccessResponse` already bundled the
  schema/label pair as `DecodeTarget`; the SPI took the same pair positionally. A codec author
  implemented one shape while a caller used the other, and
  `docs/knowledge/harvested/api-design.md:14` points at the object form for both. `DecodeTarget` now
  lives on the seam, where a third-party codec implements against it, and the handler layer re-exports
  it — one type, not two.

  **`{signal}` where an API drives a stream it did not open.** That is the project-wide rule, stated
  once and applied here: `deserializeFrom` and `serializeTo` drive caller-owned streams and now accept
  a signal; the buffered-bytes APIs (`serialize`, `serializeToString`, `toHttpError`,
  `Response.bytes()`) correctly take none, and neither do `decodeResponse`/`decodeSuccessResponse`,
  which hand the live stream to the codec and never read it. The abort reaches the drain loop and
  leaves the caller's stream unlocked, uncancelled and unclosed (SERDE-3). The CPU-bound parse after
  the drain is not interruptible by any signal — `JSON.parse` has no incremental form.

  **`DecodeTarget.admitsNull` (SERDE-13).** A wire `null` at the top level is still rejected before the
  schema runs, unconditionally, because a schema _value_ carries no nullability a codec could read and
  moving the check later would let `{parse: (i) => i}` launder a `null` into a non-null `T`. Set
  `admitsNull: true` to state what the schema cannot — that `T` includes `null` — and the check is
  skipped. This is what makes a legitimately nullable success body decodable, and the one way
  `tristate(inner)` can serve as a top-level target rather than a field combinator.

  See `docs/work/mvp/2026-09-04-open-items-dissolution.md` H9, H10 and H15.

### Patch Changes

- c1eb3aa: Internal: byte-streaming primitives for product-spec §5 (IO-1–IO-42). No public API change.
- c1eb3aa: Add the execution-context model for product-spec §7 (`CTX-1`–`CTX-20`, `XCUT-14`). No public API change.

  Everything this adds lives under `packages/core/src/context/` and none of it is re-exported from
  `src/index.ts` — `packages/core/etc/core.api.md` is byte-identical before and after. `patch` rather than an
  empty changeset because files under `packages/` did change: the published tarball carries the new
  `dist/context/*.js`, and a consumer stepping through the package in a debugger will see them.

  What landed: `ExecutionContext` as a three-member discriminated union — `DispatchContext` (before any
  request), `RequestContext` (an outbound request assembled), `ExchangeContext` (a response arrived, terminal) —
  with `promoteToRequest`/`promoteToExchange` as the pure promotion chain and `createDispatchContext`/
  `createRequestContext`/`createExchangeContext` as the off-chain factories `CTX-5`/`CTX-6` require.
  `InstrumentationBundle` plus the `noopInstrumentationBundle` disabled-tracing default. `ContextStore`, a
  bounded keyed registry with `install`/`installIfAbsent`/`find`/`close`, and `DuplicateContextKeyError`.

  Three design calls worth recording:

  - **Call keys are `Symbol()`, not a counter or a UUID.** `CTX-4`'s uniqueness requirement cannot lean on any
    field of the instrumentation bundle, because `noopInstrumentationBundle`'s fields are all constants shared
    by every context that takes the default. A fresh `Symbol()` per call is distinct across the process and
    across all three context flavors by construction, and `ContextInit.key` is the pin that makes two contexts
    deliberately share one store slot (`CTX-5`).
  - **The store's cap drains in a loop, and holds strong references.** `XCUT-14` names context registries first
    among the caller-keyed process-lived maps that MUST carry a hard cap and drain back under it after each
    insert — an unbounded one is a memory-exhaustion vector, not merely a leak. The loop (rather than a single
    check-then-evict) is what makes an insert burst converge. `Map`, never `WeakMap`/`WeakRef`: a registered
    context keeps its whole `Request`+`Response` graph reachable on purpose, so the cap is the backstop rather
    than the collector (`CTX-19`).
  - **Promotions never touch a store.** `context.ts` does not import `store.ts`, which is what satisfies
    `CTX-17`'s negative half structurally — constructing a head context must not auto-register it. Wiring the
    store into the promotions would invert the layering and make every promotion a global side effect. The
    positive half — the first store entry, installed by the first promotion — is Phase 4c's `Runtime.send()`.

  Two known deviations, both already in the deferral register (`docs/work/mvp/2026-09-04-open-items-dissolution.md`):

  - `contextStore` is a module-level mutable singleton, which
    `docs/knowledge/harvested/variables-and-declarations.md:22` bans. Accepted because threading a store handle through
    builder → runtime → every step would be a wide API change for no observable gain; logged in the design's
    Deviation Ledger for Phase 10. Tests build their own `new ContextStore()` rather than asserting through the
    singleton, which is shared by every file in a `bun test` run.
  - `activeSpan` and `tracerFactory` stay typed `unknown`, and `activeSpan` is `undefined` rather than a no-op
    span object. `CTX-14`/`CTX-15` ship as the bundle's frozen shape and the disabled default only; real W3C
    Trace Context generation waits for the Phase 7 tracing adapter that gets to define `Span`.

- c1eb3aa: Tighten `RequestOptionsBuilder.maxRetries` validation: a defined value must now be a non-negative
  integer. `Infinity`, `NaN`, and fractional values were previously accepted and now throw
  `RequestOptionsValidationError`, the same way a negative value already did.

  A retry ceiling is a count of wire sends, so a non-finite one is as out of range as a negative one —
  and worse in effect: a negative value still fails a downstream `>= 1` guard, while `Infinity` or
  `NaN` makes a retry driver's `attempt >= ceiling` test permanently false and its loop unbounded.
  HTTP-35's requirement is that an out-of-range retry count is a loud error at the call site that
  supplied it, never a value reinterpreted somewhere downstream; this closes the half of that
  requirement the setter did not implement.

- c1eb3aa: Add the recovery-chain primitives for product-spec §8.2 (`RECOV-1`–`RECOV-16`). No public API change.

  Everything this adds lives under `packages/core/src/recovery/` plus two package-root helpers, and none of it is
  re-exported from `src/index.ts` — `packages/core/etc/core.api.md` is byte-identical before and after. `patch`
  rather than an empty changeset because files under `packages/` did change: the published tarball carries the
  new `dist/recovery/*.js` and `dist/suppress.js`, and a consumer stepping through the package in a debugger will
  see them.

  What landed: `Outcome<T>` with `success`/`failure`/`fold`; `RequestRecoveryChain` and `ResponseRecoveryChain`
  (defensive copies on both, concurrency-safe by construction); `dispatchWithRecovery`, whose single `try`/`catch`
  wraps both the request chain and the transport hop so no throwable from either can bypass the recovery hooks;
  `wrapCancellation`; and `statusMappingStep`, a thin response step over Phase 3b's unchanged `toHttpError()`.
  `assertNever` joins `invariant.ts` as the codebase's first discriminated-union `default` case.

  One consumer-visible-in-principle detail worth recording: `RECOV-12` pairs a step's throwable with a close
  failure, which is what `SuppressedError` is for — and `SuppressedError` reached Node only in 24.0.0, against
  this package's `>=20.3` floor. Rather than raise the floor and drop Node 18, 20 and 22 for one error class,
  `suppress()` uses the native class where the runtime has one and returns a shape-compatible stand-in (`name`,
  `error`, `suppressed`) where it does not. Code that catches one of these should read its fields, not test
  `instanceof SuppressedError`.

- c1eb3aa: Add the retry pillar for product-spec §9 (`RETRY-1`–`RETRY-45`) and appendix C's `RECOV-17`–`RECOV-34`, plus
  the Phase 7a `config/` prerequisite slice and the shared `FakeTransport`. No public API change.

  Everything this adds lives under `packages/core/src/{retry,config,testing}/` and none of it is re-exported
  from `src/index.ts` — `packages/core/etc/core.api.md` is byte-identical before and after. `patch` rather than
  an empty changeset because files under `packages/` did change: the published tarball carries the new
  `dist/retry/*.js`, `dist/config/*.js`, and `dist/testing/*.js`, and a consumer stepping through the package in
  a debugger will see them. (The one behavior change a caller can observe from outside — tightening
  `RequestOptionsBuilder.maxRetries` to a non-negative integer — ships under its own changeset.)

  Public-barrel promotion of `retryStep` and the step-authoring surface is deliberately **not** in this release.
  A caller cannot assemble a working pipeline until the standard-resilience preset exists, and publishing
  `retryStep` alone would freeze `StepDescriptor`/`Stage`/`PipelineBuilder` shapes that still had latitude to
  move. Phase 5c owns that promotion.

  ## What landed

  `packages/core/src/retry/`, eight files, no folder barrel:

  - **`classify.ts`** — the two orthogonal axes (`RETRY-1`–`RETRY-8`, `RETRY-37`). Retryability is an
    ALLOW-list over an iterative, identity-tracking cause walk; `isResendable` is the second axis over
    `Body.replayable` and Phase 1's `isIdempotent`.
  - **`backoff.ts`, `pacing.ts`** — the pure math and the server-hint parser, split away from the imperative
    loop.
  - **`settings.ts`** — `RETRY-12`'s defaults, `RECOV-34`'s construction validation, and `totalTimeoutMs` as an
    opt-in.
  - **`engine.ts`** — the one attempt loop both adapters reach.
  - **`attempt-stamp.ts`, `retry-step.ts`, `retry-dispatch.ts`** — per-attempt stamping and the two thin
    adapters: the `RETRY` pillar step and the recovery-chain wrapper.

  Plus `recovery/idempotency-key.ts` (`RECOV-32`) and `testing/fake-transport.ts`, which closes the roadmap's
  twice-punted `FakeTransport` deferral.

  Two files outside those folders changed, both additively. `StepContext` gains `signal` and `options`
  (`PIPE-13`/`PIPE-17`): `Cursor` already carried both and threaded them into terminal dispatch, but no step
  could read either, so `RETRY-26`'s cancellable wait and `RETRY-32` were unimplementable and `PIPE-17`'s
  "readable by any step" MUST was unsatisfied outright — which is also the wire `RETRY-41`'s per-call
  `maxRetries` override (`HTTP-35`) had been missing since Phase 1 designed the knob.

  ## Executed out of numeric order: the Phase 7a prerequisite slice

  `config/clock.ts` (`CFG-15`–`CFG-17`), `config/http-date.ts` (`CFG-29`–`CFG-31`), and `config/retryable.ts`
  (`CFG-35`) are built here, verbatim from Phase 7a's plan Tasks 1–3, because 5a's Global Constraints ban
  shipping the private copies that would otherwise be needed: Task 8 consumes the `Clock` seam, Task 4 imports
  the shared RFC 1123 parser, and Task 2 re-exports the shared retryable-status set instead of defining it a
  second time. Phase 7a's Tasks 4–10 are untouched, and none of the three enters the public barrel — 7a's Task
  10 still owns that decision.

  ## Design calls worth recording

  - **One retry loop, reached by both adapters.** `RETRY-13`/`RETRY-14` and `RECOV-30` require the pillar stack
    and the recovery-chain stack not to drift. `runWithRetry` is the single choke point both call, so the
    schedule, the classifier, and the budget cannot diverge — structural, not a discipline. Every piece of
    per-call state is a local (`RETRY-42`/`RECOV-28`), so concurrent invocations sharing one config cannot
    clobber each other's attempt count or start instant.
  - **`RETRY-25`'s fatal-error exclusion needs no code.** Because classification is an allow-list, a
    stack-overflow `RangeError` is non-retryable for never having been opted in, not for having been screened
    out. A caller `AbortError` is likewise non-retryable for free (`RETRY-23`), while `TimeoutError` is
    explicitly listed (`RETRY-24`) — keying off the abort reason's `name` draws that line more precisely than
    the class hierarchy the reference describes.
  - **The pacing parser is total, and a failure never maps to `0`.** `RETRY-16` makes never-throwing the
    defining property; every malformed, negative, or out-of-range value maps to `null` ("no hint", fall back to
    backoff). `0` is reserved for a validly-parsed instant already in the past (`RETRY-17`) — mapping a
    malformed header to `0` would hammer a server that just asked for room. `X-RateLimit-Reset` receives
    `RECOV-25`'s positive [100%, 120%] jitter so a fleet released at one reset instant does not stampede; a
    literal `Retry-After` receives none (`RETRY-20`).
  - **`RETRY-36`'s remap applies only to responses the engine DISCARDS.** A response surviving the gates is
    returned live and unread: `toHttpError()` drains the body and drops the headers irreversibly, and 4c's
    pillar signature must return a `Response`. This is also why the pacing hint is read BEFORE the retire step
    — that ordering is load-bearing, not stylistic.
  - **`RETRY-27`'s budget clause is implemented as three separate checks, deliberately.** A delay that would
    push cumulative elapsed time past the budget SUPPRESSES the retry and surfaces the last failure; the
    `Math.min` clamp beside it is the requirement's separately-listed belt-and-braces clause and narrows
    nothing except across clock drift between two `elapsed()` reads. It ships because the requirement lists it
    separately, not because a test can drive it.
  - **A non-finite retry ceiling is guarded at three layers.** Unlike a negative value, which still fails a
    downstream `>= 1` guard, `Infinity` or `NaN` makes `attempt >= ceiling` permanently false and the loop
    unbounded. The setter, the step's per-call derivation, and a `runWithRetry` precondition each reject it —
    the precondition being the one choke point both adapters pass through.
  - **`RETRY-41`'s "clamp a negative retry count to the default" is implemented as a REJECTION.** It collides
    head-on with `HTTP-35`, also a MUST, which rejects precisely so the value cannot be silently reinterpreted
    downstream. The port takes `HTTP-35`'s line on both surfaces; recorded in the design's Deviation Ledger.
  - **The inter-attempt wait delegates to `Clock.sleep`.** `CFG-17` already races the timer against the signal,
    clears it on both exits (`RETRY-45`'s scheduler hygiene, which has no scheduler object to own in this
    port), and rejects promptly for a signal that aborted earlier. Hand-rolling a second `setTimeout`-plus-
    listener would put the wait outside the injected seam and force real timers into a suite that must stay
    deterministic. Cancellation RESOLVES rather than propagates, so the loop's next iteration observes the
    signal and stops through its own `RETRY-32` path.
  - **`RETRY-33`'s "every terminal path returns an Outcome" is honored literally.** An attempt that throws is
    folded into a failure outcome carrying the trail rather than left to surface as a bare rejected promise,
    which would drop `RETRY-34`'s suppressed attempts on the floor. The trail folds through Phase 4b's
    `suppress()` helper, not `new SuppressedError(...)`: the native class reached Node only in 24.0.0 and this
    package's floor is `>=20.3`. Argument order is controlled explicitly — native `using` disposal builds the
    pair the other way round, making the LATER error primary.
  - **`RETRY-30`'s trampoline requirement is satisfied by the language.** An `await` loop is already iterative,
    so N retries build no continuation chain and no stack growth.
  - **`PIPE-36` is satisfied structurally.** `retryStep()` is a factory returning a descriptor with
    `stage: 'RETRY'` baked in — no class to subclass, no way for a caller to relocate a shipped pillar family
    out of its pillar. 4c deferred this to "whichever future phase ships the first real pillar step family";
    this is that phase.
  - **`countingResponse()` counts release by BOTH routes it can happen** — `cancel()` for an abandoned
    response, `pull()`-to-EOF for one `toHttpError()` drained. A helper counting `cancel()` alone reads zero on
    exactly the `RETRY-35` path it exists to prove.

  ## Known gaps, each recorded rather than left silent

  - **`RETRY-29`** (opt-in server-driven retry-classification override) is a `MAY` and is unscheduled: it
    widens the classifier's input surface to server-controlled values and wants an explicit trust decision, not
    a default.
  - **`RECOV-33`** (client-identity header step) belongs with the `CFG-*` work and is Phase 7a's Task 9.
  - **`RETRY-40`'s "log the failure" clause and the two SHOULD-level structured events** (`retry.attemptFailed`,
    `retry.exhausted`) are not implemented here. 5a executes before 7b, so an `observability/logger.js` import
    would not resolve; 7b in turn needs this phase's `FakeTransport`, so the cycle only breaks in this
    direction. Phase 7b's Task 9 owns them, named in `engine.ts`'s retrofit note.

- c1eb3aa: Add the stage-based pipeline for product-spec §8.1 (`PIPE-1`–`PIPE-40`). No public API change.

  Everything this adds lives under `packages/core/src/pipeline/` and none of it is re-exported from
  `src/index.ts` — `packages/core/etc/core.api.md` is byte-identical before and after. `patch` rather than an
  empty changeset because files under `packages/` did change: the published tarball carries the new
  `dist/pipeline/*.js`, and a consumer stepping through the package in a debugger will see them.

  What landed: `Stage` and `STAGE_ORDER`, the fixed total order from `PRE_REDIRECT` out to the reserved terminal
  `SEND`, with `PILLAR_STAGES` marking the slots that admit at most one step. `Step`, `StepContext`, `Next` and
  `StepDescriptor` as the step contract. `PipelineBuilder`, the surgical-edit API — `append`/`prepend`/
  `appendAll`/`prependAll`/`insertAfter`/`insertBefore`/`replace`/`remove`/`reload` — flattening into an
  immutable `Runtime` at `build()`. `Cursor`, one instance per call, driving the flattened array. Five typed
  errors: `PillarCollisionError`, `AnchorNotFoundError`, `CrossStageEditError`, `CursorAlreadyAdvancedError`,
  `ReservedStageError`.

  Design calls worth recording:

  - **`Runtime` implements `Transport` itself (`PIPE-26`), and its `close()` is a deliberate no-op
    (`PIPE-27`).** Phase 2's `Transport` SPI has a single `send`, so there is no second async entry point to
    delegate through. The pipeline never owns the transport it wraps, so closing the pipeline must not close it.
  - **Continuations are one-shot, and a fork is a closure, not a second cursor.** `next` and every `fork()`
    handle are one-shot closures over one private recursive dispatcher indexed by array position
    (`PIPE-15`/`PIPE-16`); reusing an already-invoked handle rejects with `CursorAlreadyAdvancedError`. There is
    deliberately no settable start position — a step that must re-drive the chain calls `ctx.fork()` again. The
    dispatcher shares one mutable in-flight request, so a `PIPE-14` substitution sticks for every later step
    _and_ the terminal dispatch.
  - **`Stage` is a string-literal union, not an enum.** `erasableSyntaxOnly` bars enums, and `Stage` carries no
    behavior beyond ordering, which `STAGE_ORDER` alone provides. Adding a stage later is one splice into that
    array — no existing `Stage` value changes, so there is no numeric-gap renumbering to design around.
  - **`prependAll` reverses its batch and `appendAll` does not.** The asymmetry falls out of prepending each
    element individually, and is the documented one `PIPE-38` allows rather than an oversight. `reload` is the
    transactional bulk path (`PIPE-23`): fully validated before any existing content is touched, so a rejected
    batch leaves the builder untouched instead of half-applied.
  - **`replace` is the sanctioned way past a pillar collision.** `PIPE-5` exempts it from the pillar check;
    re-seating the _same_ `type` symbol anywhere is an idempotent no-op rather than a second step (`PIPE-6`),
    which is also what keeps the bulk paths from seating two steps where `append` would seat one.
  - **`send()` closes `CTX-17`'s positive half.** The first promotion installs into Phase 4a's `contextStore`,
    the exchange promotion replaces it under the same key, and the `finally` evicts whichever context was
    installed last. `exchangeSource()` is exported (still `@internal`) so its two branches can be asserted as
    the pure function they are: when a step substituted the outbound request, the exchange is promoted from an
    off-chain rebuild around the request that was _actually sent_, pinned to the same call key and carrying the
    same instrumentation bundle by reference. Promoting straight off the original would pair the response with a
    request that never left the process.

  One deferral, recorded in `docs/work/mvp/2026-09-04-open-items-dissolution.md`: `StepContext` carries neither the per-call `options` nor the
  `AbortSignal`. `Cursor` holds both and threads them into the terminal dispatch (`PIPE-17`), but the
  "readable by any step" clause has no reader until Phase 5a's retry engine, which adds both fields as one
  additive amendment.

- c1eb3aa: Phase 7a review pass 3 (readability and convention). No behavior changes. Two public parameter names change,
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
    the module directly". They have no in-package consumer, which `docs/work/mvp/2026-09-04-open-items-dissolution.md` G16 already recorded.

- c1eb3aa: Add the redirect-following pillar step for product-spec §10 (`REDIR-1`–`REDIR-27`) and close `PIPE-40`. No
  public API change.

  Everything this adds lives under `packages/core/src/redirect/` and none of it is re-exported from
  `src/index.ts` — `packages/core/etc/core.api.md` is byte-identical before and after. `patch` rather than an
  empty changeset because files under `packages/` did change: the published tarball carries the new
  `dist/redirect/*.js`, and a consumer stepping through the package in a debugger will see them.

  One file landed outside `redirect/`: `packages/core/src/recovery/release.ts`, which is
  `releaseQuietly`/`withReleaseFailure` extracted unchanged from `retry/engine.ts`. The redirect step needs
  the same "a teardown failure never becomes primary" discipline `RECOV-12` already required of retry, and
  the helper's identity guard is subtle enough that a second copy would drift. `engine.ts` now imports what
  it used to define; its behavior and its suite are unchanged.

  What landed: `codes.ts` (the recognized `{301,302,303,307,308}` set and per-code method eligibility),
  `cross-origin.ts` (the RFC 6454 origin tuple compared against the seed, plus the credential-suppression
  marker header), `settings.ts` (validated, frozen policy with a defensively copied allowed-method set),
  `decide.ts` (the pure per-hop decision), `redirect-step.ts` (the `REDIRECT` pillar adapter), and
  `strip-marker-step.ts` (a `POST_AUTH` guard plus `withRedirect()`). Two new operational error leaves,
  `NonReplayableBodyError` and `SchemeDowngradeError`, both `@internal` for now.

  Four design calls worth recording:

  - **The cross-origin suppression signal is a real header, not an in-process marker.** A `WeakSet<Request>`
    keyed by object identity is unforgeable and never touches the wire, but stage order is
    `REDIRECT → RETRY → AUTH` and 5a's attempt-stamping builds a fresh per-attempt `Request` copy when
    enabled — an identity-keyed signal would silently stop matching exactly when a retry sits between
    redirect and auth, which is when cross-origin credential suppression matters most. Stamping preserves
    headers, so a header survives the intermediate copy.
  - **A second, always-bundled step strips that marker independently of whether an auth step exists.**
    `REDIR-11` itself names the porter caveat: in the reference only the auth step strips the signal, so a
    pipeline with none forwards it to the transport. 5b ships before 5c, so that is not a future concern
    here — it is a live leak this phase would otherwise ship. `stripCrossOriginMarkerStep()` occupies 4c's
    inert `POST_AUTH` extension slot, so nothing in 4c or 5c had to change.
  - **Two origin-shaped checks, two deliberately different reference points.** Cross-origin classification
    compares against the **seed** origin for the whole chain (`REDIR-8`), so a foreign host cannot hand the
    credential back by redirecting to the seed's own origin. The scheme-downgrade guard compares the
    **current hop** against its target (`REDIR-15`), so an HTTPS→HTTP→HTTPS chain flags only the hop that
    actually downgraded. Conflating them silently breaks one or the other.
  - **A failing release never replaces the error it was supposed to let through.** `Response.close()`
    rethrows whatever cancelling the body raised, so the two error paths that close before propagating
    (`decideOrClose`, and the `'fail'` branch's `SchemeDowngradeError`) route through
    `withReleaseFailure`: the decision error stays primary and the release failure rides along as
    `suppressed`. The third close — releasing a superseded hop before the next drive — is deliberately
    left bare, because there is no primary error to preserve and `PIPE-40` makes the release itself part
    of the contract.
  - **Location resolution ends with an explicit `http:`/`https:` gate.** WHATWG `URL` parses
    `javascript:`, `data:`, `file:`, and `mailto:` without complaint, and the downgrade guard waves all of
    them through (none is `http:`). Without the gate the step would dispatch a server-supplied
    `javascript:` target. The `catch` around `new URL(raw, base)` is a genuinely narrow path, not the
    general garbage guard it looks like: with a base supplied, a non-URL string resolves as a relative
    reference rather than throwing.

  One normative conflict, resolved and recorded rather than silently picked: **`PIPE-40` and `REDIR-22`
  disagree, both at `MUST`, about the non-replayable-body path.** `PIPE-40` lists it among the paths whose
  in-flight response is "returned unclosed"; `REDIR-22`(b) lists the same trigger among those "closed before
  the error propagates". `REDIR-6` settles the control flow — that path "MUST fail with a clear error" — so it
  throws, and a response never returned cannot be returned unclosed. 5b closes and throws; the contradiction
  is in the design's Deviation Ledger and deferred to Phase 10, which owns the erratum either way.

  Two known gaps, both recorded in the phase checklist:

  - **`REDIR-28`'s structured hop/loop/downgrade log events, and `REDIR-15`'s "surface it observably" clause
    on a permitted downgrade, are not implemented here.** Phase 5b executes before Phase 7b, so
    `redirect-step.ts` cannot import `observability/`, and 7b needs this step for its own retrofit test —
    the dependency cannot run the other way. Phase 7b's Task 9 owns them, named in `redirectStep()`'s TSDoc.
  - **`REDIR-20`'s predicate override is read as scoped to code/method eligibility only.** A configured
    predicate replaces the built-in follow decision; it does not bypass userinfo stripping, credential
    hygiene, the downgrade guard, the replayability gate, or loop/cap detection, all of which the same spec
    document states as unconditional `MUST`s. Logged in the design's Deviation Ledger for Phase 10 and
    flagged for re-confirmation at Phase 9's conformance sweep.

- c1eb3aa: `Clock.sleep` now honors any finite, non-negative duration by chaining timers, instead of rejecting
  a duration longer than one `setTimeout` delay can carry.

  `setTimeout` clamps a delay above 2^31 − 1 ms and _silently_ rewrites it to `1`, so an oversized
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

  Closes `docs/work/mvp/2026-09-04-open-items-dissolution.md` V13.

- c1eb3aa: Three configuration and auth failures that resolved silently now emit a structured warning through
  `getGlobalLogger()`. All three were deferred to "once a `Logger` seam exists"; Phase 7b shipped one,
  and these are the call sites that never got wired to it.

  - **`AUTH-37`** — a failed background bearer-token refresh emits `http.auth.bearerRefreshFailed` with
    the provider's error as the cause, then continues exactly as before. The requirement is
    log-and-continue; only the continue half was implemented.
  - **`CFG-24`** — a proxy URL rejected by `resolveProxyOptions` emits `http.proxy.configRejected`
    naming the variable it came from (`HTTPS_PROXY`/`HTTP_PROXY`) and which gate rejected it
    (`unparseable`, `scheme`, `port`, `host`). A typo'd proxy variable previously routed every request
    direct with nothing to read anywhere. The URL itself is never logged — it can carry `user:pass@`,
    and CFG-22 masks credentials in every rendering.
  - **`CFG-5`/`CFG-11`** — a caller-supplied configuration source that throws emits
    `config.sourceFailed` naming the layer and the key. The lookup still falls through to the caller's
    default, because CFG-5's never-throw clause is the stronger obligation; what changes is that the
    operator can now see why.

  Resolution behaviour is unchanged in all three cases. Every emission is wrapped so a failing logger
  cannot fail the operation (OBS-20).

- c1eb3aa: Default-constructed execution-context keys now carry a serial number in their description —
  `Symbol('dispatch-context#7')` rather than `Symbol('dispatch-context')`.

  `CTX-8` is stated in appendix C as an error "whose **message** identifies the key", and
  `DuplicateContextKeyError`'s message renders `String(key)`. Every default key of a flavor rendered
  identically, so the message named the _kind_ of key and never _which_ key — the error's typed
  `.key` field carried the identity, but the message did not. The identity is still the `Symbol()`
  itself; only the label changed, so `CTX-4`/`CTX-5`/`CTX-6`'s uniqueness is untouched.

  Recorded at `docs/work/mvp/2026-09-04-open-items-dissolution.md` A5.

- c1eb3aa: A cancellation observed inside core now surfaces as `CancellationError`, the same type the transport
  layer already produced for the identical abort (XCUT-1, `docs/work/mvp/2026-09-04-open-items-dissolution.md` N1).

  The retry engine's `RETRY-32` exit handed back `config.signal.reason` verbatim, and the bearer
  cache's `raceAbort` rejected with it, so a caller writing
  `catch (e) { if (e instanceof CancellationError) … }` handled a cancelled transport dispatch and
  silently missed a cancelled backoff or a cancelled token fetch — those arrived as a bare
  `DOMException` named `AbortError`. Both now map through the same shape, keeping the caller's own
  abort reason as the error's `cause`.

  `XCUT-3` is why the mapping is not unconditional: a signal aborted by `AbortSignal.timeout()`
  surfaces `TransportFailureError`, so a timeout stays distinguishable from a cancellation.

  `Clock.sleep` is deliberately unchanged — `CFG-17` requires it to reject with the caller's reason
  exactly as given, and the retry loop absorbs that rejection rather than surfacing it.

- c1eb3aa: The pipeline cursor now checks the caller's `AbortSignal` at every step boundary, so a cancelled call
  stops walking instead of running every installed step and only failing at the transport hop.

  `Cursor` accepted the signal, threaded it to the terminal transport, and never looked at it in
  between — against `concurrency-and-async.md`'s "check the signal at the top of each loop iteration or
  before each expensive step". Each pillar guarded its _own_ loop (`RETRY-32`, redirect's per-hop
  check), but the walk itself was unguarded, so an already-aborted call could still do real work on the
  way down — the auth step's bearer-token refresh being the concrete case.

  **Consumer-observable:** a call whose signal is already aborted now rejects before any step runs, so
  no wire send happens and no response is produced. It previously dispatched and, on the redirect path,
  handed the first hop back open. An abort raised _during_ a hop is unchanged: the redirect step's own
  guard runs before it forks again, so the in-flight response is still returned unclosed (`PIPE-40`).

  The abort is mapped through the same helper `docs/work/mvp/2026-09-04-open-items-dissolution.md` N1 added, so it surfaces as
  `CancellationError` with the caller's own reason as `cause` — never a bare `DOMException` — and a
  timeout-aborted signal still surfaces `TransportFailureError`, keeping `XCUT-3`'s distinction.

  Closes `docs/work/mvp/2026-09-04-open-items-dissolution.md` V15 and Section T's `F9`.

- c1eb3aa: Delete `packages/core/src/seams/index.ts`, an internal folder-level barrel from Phase 2 that nothing
  imported. Its only reference anywhere in the workspace was the comment in `packages/core/src/index.ts`
  explaining why the public barrel deliberately did not re-export it.

  No published surface changes: `packages/core/package.json`'s `exports` names `.` only, so the file
  was never reachable by a consumer, and every symbol it re-exported is already named directly on the
  public barrel. Closes `docs/work/mvp/2026-09-04-open-items-dissolution.md` H12.

- c1eb3aa: `toHttpError` no longer lets a failing `close()` replace the `HttpStatusError` it was about to
  build. The drain ended in a bare `finally { await response.close() }`; `Response.close()` memoizes
  its release promise, so a response whose close had already failed handed the same rejection back
  from inside that `finally`, and it replaced the result. A 5xx then surfaced as the raw close error
  with `error instanceof HttpStatusError` false — making the `@throws HttpStatusError on 4xx/5xx` tag
  on `decodeSuccessResponse`, `statusMappingStep` and the retry engine untrue.

  Release now goes through `releaseQuietly`/`withReleaseFailure`, the same pair every other subsystem
  uses (RECOV-12):

  - a **read** failure stays primary, with the release failure suppressed under it;
  - a **successful** read returns the `HttpStatusError` even when the release failed, carrying that
    failure as the error's `cause` rather than dropping it.

  Fixing it at `toHttpError` covers all four callers at once. Recorded at `docs/work/mvp/2026-09-04-open-items-dissolution.md` H14 (of
  which `P1` is the same defect under a second letter).

- c1eb3aa: Close the public numeric range checks that guarded only their lower bound, completing the sweep
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

- c1eb3aa: `redirectStep()` now emits the last two of `REDIR-28`'s four structured events:
  `http.redirect.loopDetected` and `http.redirect.malformedLocation`. Phase 7b shipped the hop,
  rejection and permitted-downgrade events; these two were blocked because `decide()`'s
  `'return-current'` outcome was a bare `{kind}` that could not tell loop detection from a hop cap
  from ordinary termination.

  `Decision`'s `'return-current'` variant now carries a `reason` — `'not-a-redirect'`,
  `'not-eligible'`, `'malformed-location'`, `'loop-detected'` or `'hop-cap'`. `decide()` and
  `Decision` are `@internal` and appear in no API report, so no published surface changes.

  The malformed-Location event logs the header **raw**, unredacted. That is `REDIR-28`'s own carve-out:
  the value failed to parse into a URL, so there is nothing for the redactor to key off. A deployment
  whose upstreams may send credential-bearing malformed `Location` values should account for it.

  Closes `docs/work/mvp/2026-09-04-open-items-dissolution.md` G3, and the "Redirect's loop-detected and malformed-Location events"
  row in Section D.

- c1eb3aa: `MediaType.charset` now returns `undefined` for an encoding label the runtime does not recognize,
  closing the "or unknown" half of `HTTP-24` — whose own conformance text reads
  `charset=bogus` → null. It previously returned the label verbatim, so `text/plain;charset=bogus`
  answered `'bogus'` and a caller had no way to reach the requirement's fallback without exception
  handling of its own.

  "Unknown" is resolved against the runtime's WHATWG Encoding registry: a label
  `new TextDecoder(label)` refuses is one nothing in this SDK could decode with, and it is the same
  resolution `decodeBodyText` already performs a layer down, so the two cannot disagree about what is
  decodable. Recognized labels keep their original case (`HTTP-23`).

  The raw parameter is unchanged and still reachable: `parameter('charset')` returns `'bogus'`, and
  `render()` still round-trips it verbatim (`HTTP-25`). Behaviour downstream is unchanged too —
  `resolveCharset` already fell back to UTF-8 for a label `TextDecoder` rejected.

  Recorded at `docs/work/mvp/2026-09-04-open-items-dissolution.md` A1.

- c1eb3aa: Document `AuthTiers.operation`'s settled disposition on the field itself (AUTH-4, AUTH-5, AUTH-6,
  AUTH-7). Documentation only: no behavior, no types, and no exported symbol changed, so
  `packages/core/etc/core.api.md` is byte-identical — the field is still
  `readonly operation?: AuthDescriptor | undefined;`.

  The tier was previously described as having "no shipped source yet", with a pointer to the
  roadmap's Deferred Items Log. Both halves were wrong. "Yet" read as pending work, and the pointer
  dangled: that log moved out of the roadmap into `docs/deferred-items.md` on 2026-08-31 and the
  roadmap's own section is a stub.

  Nothing is pending. `resolveAuthRequirement` selects `perCall ?? operation ?? client`, so the
  `operation` tier resolves correctly the moment a caller populates the `AuthTiers` it passes — the
  tier is live, not dead code. What does not exist is an automatic source: filling it would take a
  per-operation configuration layer, a code generator or a client surface, and no phase on this
  roadmap ships one, so `client` and `operation` alike stay construction-time configuration.
  `AUTH-4` through `AUTH-7` are mechanically satisfied either way, which is why this is a missing
  source rather than an unmet requirement.

  The per-call half of the same question shipped in Phase 5c and is unaffected: `RequestOptions.auth`
  reaches the AUTH step through `StepContext.options` and is merged into the tier set at resolution
  time.

  The reasoning now lives in the code a consumer reads in the published `.d.ts` and needs no pointer,
  so the row for it was closed. The register that held it, `docs/deferred-items.md`, was dissolved the
  same day; the live gap this leaves — a published tier core gives consumers no way to fill — is
  tracked as `docs/work/mvp/2026-09-04-open-items-dissolution.md` W1.

- c1eb3aa: Document `ProxyOptions.challengeHandler`'s settled disposition on the field itself, in both
  `ProxyOptions` and `ProxyOptionsInit` (CFG-22, TRANSPORT-30, SEAM-1). Documentation only: no
  behavior, no types, and no exported symbol changed, so `packages/core/etc/core.api.md` is
  byte-identical — both entries are still `readonly challengeHandler?: unknown;`.

  The slot was previously described as having "no protocol behind it yet", which read as pending
  work. It is not pending. The field is required by `CFG-22`'s field list (a MUST) and gives
  `TRANSPORT-30`'s SHOULD-warn clause a subject, but **nothing dispatches through it and nothing is
  going to**: undici's `ProxyAgent` takes its credential solely from its own constructor and rejects
  a per-request `Proxy-Authorization` with `InvalidArgumentError`, and that constructor runs before
  any challenge exists, so a handler-minted credential can never reach the exchange that provoked it.
  `@dexpace/transport-undici` answers the requirement by discoverability instead — a WARN at
  construction, a second WARN on the first real `407`, Basic proxy auth through
  `ProxyOptions.credentials`, and the `407` returned untouched.

  The TSDoc also records why the type stays `unknown` rather than becoming a declared signature: the
  only concrete argument a handler could take is the native client's own response type, which
  `SEAM-1`'s zero-runtime-dependency rule forbids core from naming, and a transport-neutral challenge
  shape invented here would be a contract with no implementation behind it.

  The reasoning now lives in the code a consumer reads in the published `.d.ts` rather than in a
  register, so the row for it has been removed from the deferral register; the full platform audit
  remains at `docs/deviations.md` item 13.
