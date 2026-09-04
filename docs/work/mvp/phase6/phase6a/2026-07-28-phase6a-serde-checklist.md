# Phase 6a — Serde Implementation Plan — Checklist

Verification of [2026-07-28-phase6a-serde.md](./2026-07-28-phase6a-serde.md) against every requirement ID in
`docs/product-spec/14-serialization-serde.md` (`SERDE-1`–`SERDE-30`), appendix C's `SEAM-19`–`SEAM-23`, and the
two Phase-0 deferrals this phase closes (`NFR-2`, `NFR-14`), as dispositioned by
`docs/work/mvp/phase6/phase6a/2026-07-28-phase6a-serde-design.md`.

**Status: EXECUTED (2026-08-27).** Every task below is implemented and tested. Deviations, deferrals, and the
requirement clauses satisfied by delegation rather than by code are recorded in `docs/work/mvp/2026-09-04-open-items-dissolution.md` §H —
**read that section alongside this table**; a row here marked ✅ against a delegated clause points at the §H
entry that says what "satisfied" means for it.

**Legend:** ✅ Implemented and tested — ✅(t) Satisfied by construction, with a test as the only possible
evidence — 🚫 Not built (permanent simplification, named reason) — ⏳ Deferred (named target phase) —
N/A Not applicable in this port.

**A note on the collapsed rows.** The design's "Collapsed Requirements" table
([design §Collapsed Requirements](./2026-07-28-phase6a-serde-design.md)) dispositions six MUSTs as N/A
or satisfied-by-construction. Phase 9's sweep must read that table rather than re-deriving them, or those six
read as uncovered. Every collapsed row below points back at it.

## §3 — The wire-codec seam (`SEAM-19`–`SEAM-23`)

Listed first because §3's seam requirements and §14's serde chapter overlap, and Phase 9 audits both indexes.

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SEAM-19 | MUST | Bundle of serializer + deserializer + undeclared-nowhere media type; concrete codecs outside core | ✅ | Task 2 — `packages/core/src/seams/serde.ts` (`interface Serde`). `mediaType` is a required non-optional field, asserted by a `@ts-expect-error` in `seams/serde.test.ts` that omitting it does not compile. Concrete codec lives in `packages/codec-json/`, a separate package |
| SEAM-20 | MUST | Four allocation profiles; encode failures a stable SDK type; stream-write I/O unwrapped; fixed-buffer overflow a bounds error | ✅ | Task 2 (`interface Serializer`), Task 9 (`packages/codec-json/src/json-serde.ts`). All four profiles present and asserted in `seams/serde.test.ts` ("all four SEAM-20 allocation profiles are present, including the fresh-string one") and exercised in `json-serde.test.ts`. Overflow → plain `RangeError`; encode failure → `SerializationError` |
| SEAM-21 | MUST | Explicit runtime type token, not an erased/inferred generic | ✅ | Task 2 + Task 7 — every decode entry point takes `Schema<T>`; `Serde` dropped its type parameter. Phase 2's `@internal` marking removed and the seam promoted to `packages/core/src/index.ts`, proven by `packages/core/src/index.public.test.ts` |
| SEAM-22 | MUST | Generic type capture rejects an unresolved type variable at construction | N/A | Collapsed — see the design's table. Nothing is inferred from an erased generic at runtime, so the state SEAM-22 guards against is unreachable; the compiler refusing a call site with no concrete schema is earlier and stronger |
| SEAM-23 | MUST | Stable SDK-owned failure hierarchy, adapters throw it instead of leaking the backing type, cause always chained | ✅ | Task 1 — `packages/core/src/serde/errors.ts`, tested in `serde/errors.test.ts` (header cites SEAM-23). **Structural deviation recorded at §H3:** two flat leaves under `DexpaceError` plus `isSerdeError`, not a `SerdeError` base class — the two-level cap 3b retrofitted for |

## §14.1 — The bundle and its media type

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SERDE-1 | MUST | One bundle exposing exactly one encoder and one decoder for one wire format | ✅ | Task 2 (`interface Serde`), Task 9 (`jsonSerde()`). Round-trip through one bundle asserted in `codec-json/src/json-serde.property.test.ts` (fast-check) and `json-serde.test.ts` |
| SERDE-2 | MUST | Declared media type is the default `Content-Type` when a body is built from value + serde; never defaulted at the SPI | ✅ | Task 4 — `packages/core/src/body/serde-body.ts`. `body/serde-body.test.ts` asserts the default, an explicit override, and that a non-JSON serde stamps its own type. No format-agnostic fallback exists on the path. Cross-package proof in `codec-json/src/cross-package.test.ts` and `test/node-conformance/serde.test.mjs` |

## §14.2 — Allocation profiles and stream ownership

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SERDE-3 | MUST | Read to EOF / write fully, never close or take ownership of the caller's stream | ✅ | Task 9 + Task 10 — `json-serde.ts` releases the writer/reader lock in a `finally` and never calls `close()`/`cancel()`. `json-serde.test.ts` uses close-counting stream wrappers on both directions; re-asserted against Node's own Web Streams in `test/node-conformance/serde.test.mjs` |
| SERDE-4 | MUST | Encode-into-buffer returns bytes written, honors offset, throws a non-serde `RangeError` on overflow or bad offset, leaves `[0, offset)` untouched | ✅ | Task 9 — `serializeInto`. Range-checked before encoding, so the buffer is never partially written. `json-serde.test.ts` asserts the byte count, the untouched prefix, the exactly-fitting boundary case, an out-of-range offset, and that the `RangeError` carries **no** `cause` |

## §14.3 — The type witness

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SERDE-5 | MUST | Every decode takes an explicit runtime type witness | ✅ | Task 2 (`Schema<T>` mandatory on `deserialize`/`deserializeFrom`), Task 10. `seams/serde.test.ts` asserts the return type is driven by the schema argument, not by the bundle |
| SERDE-6 | MUST | Parametric targets expressible; a decoder that cannot resolve type arguments fails loudly | ✅ | Task 2 + Task 10 — schema combinators (`z.array(Dto)`) are the carrier; there is no raw path to fall back to, so the "silently decodes into the wrong type" failure is unreachable. Asserted in `seams/serde.test.ts` and `json-serde.test.ts` ("a parametric target is just a combinator schema — no carrier type exists") |
| SERDE-7 | MUST | Ergonomic reified/inline decode helper routes through the generic carrier | N/A | Collapsed — see the design's table. TypeScript has no reified generics; the schema *is* the reification and is already mandatory on every entry point, so there is no less-typed path for a helper to route away from |
| SERDE-8 | MUST | The carrier rejects construction with no type argument or an unresolved type variable | N/A | Collapsed — see the design's table. Vacuous: nothing is inferred from an erased generic at runtime |

## §14.4 — Failures

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SERDE-9 | MUST | Failures surface as the SDK's stable serde type, chaining the original, with no backing-library type escaping | ✅ | Task 1 + Tasks 9/10 — `json-serde.ts` wraps every `JSON.parse`/`JSON.stringify` throw. `json-serde.test.ts` asserts the SDK type and the chained `cause` on malformed JSON, on a schema rejection, and across **every** allocation profile |
| SERDE-10 | MUST | Write path a serialization subtype, read path a deserialization subtype, both off a common root | ✅ | Task 1 — `SerializationError` / `DeserializationError`, both directly under `DexpaceError`, grouped by `isSerdeError`. Structure deviates (§H3); direction and catch-one-category both hold |
| SERDE-11 | SHOULD | Serde failures are unchecked, not a declared/checked exception | ✅ | By construction — JavaScript has no checked exceptions. Recorded in `serde/errors.test.ts`'s header comment as having nothing to assert |
| SERDE-12 | MUST | A genuine stream I/O error propagates unwrapped; only malformed-input / shape-mismatch / unencodable-value failures are wrapped | ✅ | Task 5 + Task 10 — `response-handlers.ts` rethrows anything already in this SDK's typed tree untouched (`e instanceof DexpaceError`, which covers all five FLAT `io/errors.ts` leaves plus `HttpStatusError`); the codec catches nothing off `read()`. `response-handlers.test.ts` asserts unwrapped propagation one case per leaf; `json-serde.test.ts` asserts the codec re-wraps nothing coming off the stream. **See §H8:** the narrower `instanceof IoError` guard this replaced was a real defect, and one residual limit remains — a *foreign* transport's stream error is indistinguishable from a non-conforming codec leaking one, so it is still surfaced as `DeserializationError` |
| SERDE-13 | MUST | A wire `null` into a non-null target fails naming the target, across every decode overload | ✅ | Task 10 — the single `decodeText` funnel both entry points route through, so "across every overload" is mechanically true for this codec. `json-serde.test.ts` asserts it on both entry points, asserts it fires *before* the schema runs, and asserts the documented `'the target type'` fallback label. **See §H9:** every target is treated as non-null, which is deliberate and has two named consequences |

## §14.5 — The PATCH tri-state type

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SERDE-14 | MUST | Exactly three states, Present-of-null unrepresentable, covariant in the value type | ✅ | Task 3 — `packages/core/src/serde/tristate.ts`. `present<T>(value: NonNullable<T>)` makes the fourth state unrepresentable at the **type** level (earlier than the reference's runtime rejection), asserted by a `@ts-expect-error` in `serde/tristate.test.ts`; covariance asserted separately ("Absent and Null are assignable to any parameterization") |
| SERDE-15 | MUST | Absent omits the key, Null emits a wire null, Present emits the value | ✅ | Task 11 — `packages/codec-json/src/tristate-replacer.ts`. All three asserted in `tristate-replacer.test.ts`, plus the nested-Tristate and decoy-object cases; re-asserted on Node in `test/node-conformance/serde.test.mjs` |
| SERDE-16 | MUST | Missing key → Absent, explicit null → Null, value → Present with the element type preserved | ✅ | Task 12 — `packages/codec-json/src/tristate-schema.ts` (`tristate()`). `tristate-schema.test.ts` covers all three, and an `expectTypeOf` assertion covers the element-type preservation a runtime test cannot see |
| SERDE-17 | MUST | A tri-state field with no key on the wire resolves to Absent, via the field default rather than a null hook | ✅ | Task 12 — `tristateObject()` looks the key up and feeds a module-private missing sentinel to the field's schema, because a `JSON.parse` reviver never fires for an absent key. Asserted in `tristate-schema.test.ts` and on Node |
| SERDE-18 | SHOULD | Construction/consumption helpers; `ofNullable` can never yield Absent; fold, value-or-null, three predicates | ✅ | Task 3 — `absent`, `nullValue`, `present`, `ofNullable`, `foldTristate`, `valueOrNull`, `isAbsent`/`isNull`/`isPresent`. `ofNullable` never yielding Absent is asserted directly. `fold` is named `foldTristate` to avoid colliding with 4b's `Outcome.fold` in one barrel |
| SERDE-19 | MUST | The default codec configuration wires the tri-state semantics; opting out is explicit | ✅ | Task 9 — `jsonSerde()` installs the replacer by default; `{tristate: false}` is the only way out. `tristate-replacer.test.ts` asserts both branches, including that opting out makes Absent and Null indistinguishable |
| SERDE-20 | SHOULD | Top-level / array-element Tristate degrades to a wire null rather than throwing | ✅ | Task 11, in **two** places — the top-level position is resolved by `json-serde.ts`'s `encodeToText` *before* `JSON.stringify` runs (via `degradeTopLevelTristate`), because a replacer cannot tell the root from a key literally named `""`; the array-element position needs no code at all, since `JSON.stringify` itself emits `null` for an element whose replacer returned `undefined`. Do not collapse the two back together. `tristate-replacer.test.ts` covers top-level, array-element, nested-array (indices never shift at depth), and the `""`-key case that forced the split |

## §14.6 — Codec configuration policy

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SERDE-21 | MUST | Reject cross-shape scalar coercions | ✅(t) | Collapsed — `JSON.parse` performs no coercion, so no code implements this and **the tests are the coverage**. All twelve enumerated pairs asserted in `packages/codec-json/src/conformance.test.ts`, including `empty-string → floating-point` |
| SERDE-22 | MUST | Permit representation-preserving conversions | ✅(t) | Collapsed — JavaScript has one numeric type, so integer→float widening is not a conversion. Three rows in `conformance.test.ts` |
| SERDE-23 | SHOULD | Ignore unknown/unexpected fields rather than failing | ✅ | **Delegated, not enforced — see §H2.** The policy is the caller's schema's; documented as a recommendation in `jsonSerde`'s TSDoc. Two rows in `conformance.test.ts` prove the delegation is real: the same codec and the same bytes give opposite outcomes for a permissive and a strict schema |
| SERDE-24 | SHOULD | Date/time emitted as ISO-8601, round-tripping to the same instant | ✅(t) | Collapsed — `Date.prototype.toJSON` emits ISO-8601. `conformance.test.ts` asserts the exact wire form and instant equality |
| SERDE-25 | SHOULD | The default-configuration factory returns a fresh instance per call | ✅ | Task 9 — `jsonSerde()` allocates and freezes per call, asserted in `json-serde.test.ts`. Trivial here: the requirement's rationale (mutable codec caches) has no analog — there is no engine and no cache |
| SERDE-26 | MUST | Never mutate a caller-supplied codec instance; operate on a private copy | N/A | Collapsed — see the design's table. There is no codec object to supply, copy, or mutate; `jsonSerde()` takes options, not an engine. The failure mode (reconfiguring an `ObjectMapper` the caller also uses) is unreachable |

## §14.7 — Response handlers

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SERDE-27 | MUST | Stream the body through the deserializer without materializing; close on every path; missing body a serde exception naming the target; codec failure chained; mid-stream I/O unwrapped | ✅ | Task 5 — `packages/core/src/serde/response-handlers.ts` (`decodeResponse`). `response-handlers.test.ts` covers the success path, the missing body with and without a `typeName`, the wrapped codec failure, the already-typed failure that is not double-wrapped, the unwrapped stream failure, and both close-failure orderings. Close-on-every-path is built on 4b's `releaseQuietly`/`withReleaseFailure` (§H4 item 2), so a close failure never displaces the real one. **The no-materialize clause is honored at the seam and unavoidably broken by this codec — §H1** |
| SERDE-28 | MUST | Decode only 2xx; 4xx/5xx throws the mapped HTTP error with a bounded buffered body; any other non-2xx closes and raises a status-leading serde exception preserving ETag/Location | ✅ | Task 6 — `decodeSuccessResponse`. 4xx/5xx delegates to 3b's `toHttpError()` at the shared 1 MiB `BODY-30`/`HTTP-52` cap rather than building a second one. `response-handlers.test.ts` covers 2xx, 500, a non-canonical 599, 304 (ETag/Location preserved as readable fields), 1xx, the close-also-fails ordering, and the fallback label |

## §14.8 — Concurrency and diagnostics

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SERDE-29 | SHOULD | A configured serde is safe to share across concurrent tasks | ✅(t) | Collapsed — single-threaded event loop, and the bundle is `Object.freeze`d and stateless. `conformance.test.ts` drives 200 genuinely interleaved round-trips through one bundle — each awaits a multi-chunk `deserializeFrom`, so the calls really do overlap — asserting no cross-talk |
| SERDE-30 | MAY | Absent/Null sentinels provide a stable, identity-free textual representation | ✅ | Task 3 — shipped as the exported `tristateToString()` free function rather than a `toString()` on the sentinels, which is a mismatch against the design's own coverage row; recorded at §H4 item 6. Asserted in `serde/tristate.test.ts` |

## Phase-0 deferrals closed here

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| NFR-2 | SHOULD | Each optional capability a separately installable unit depending on core plus at most one third-party library | ✅ | Task 8 — `packages/codec-json` ships with `dependencies: {}` hard-committed and **zero** external libraries, its only edge to core being a peer. `scripts/verify-seam-1.mjs` was generalized from core-only to every package under `packages/`, and `scripts/verify-seam-1.test.mjs` drives that script against fixture trees to prove it still fails when it should. Codec half closed; the transport half stays Phase 8a |
| NFR-14 | SHOULD | Dependency and tool versions live in a single source of truth | ✅ | Task 8 — the workspace root's `workspaces.catalog` block single-sources `typescript`, `@microsoft/api-extractor`, `expect-type`, and `fast-check`; the root's own `devDependencies` and both member packages reference them as `"catalog:"`. Confirmed against the pinned Bun version (`.bun-version` 1.3.14; catalogs landed in 1.2.0), so the fallback Task 8 allowed for was not needed |
| Peer-dependency dedup | — | Every adapter declares `@dexpace/core` as a peer, guarding the dual-package hazard | ✅ | Task 8 + Task 13 — `peerDependencies` + `peerDependenciesMeta`, asserted for every non-core package by `verify-seam-1.mjs`. `codec-json/src/cross-package.test.ts` proves the **consequence** rather than the declaration: a `Tristate` built in core is recognized by the codec's replacer, because `TRISTATE_BRAND` is a registry-global `Symbol.for` |
| NFR-8 | SHOULD | Shrinker keep/retain configuration covering the runtime-wired SPI seams and the Tristate type | ⏳ | **Deferred to Phase 9 — §H5.** Both surfaces are created here and neither is keep-configured here: the keep-config and its guard are one workspace-wide deliverable. `plans/2026-07-28-phase9-cross-cutting-conformance.md` ships `@dexpace/shrink-test` with `@dexpace/codec-json` and `jsonSerde` already in `participatingPackages`. 6a's only obligation is that both stay reachable through the public barrels, which `index.public.test.ts` and `cross-package.test.ts` prove |
| NFR-9 | SHOULD | Automated shrink-survival regression guard wired into the default build | ⏳ | **Deferred to Phase 9 — §H5.** Same deliverable as `NFR-8` |

## Open items this phase raised

Recorded in full at `docs/work/mvp/2026-09-04-open-items-dissolution.md` §H. Summary, so a Phase 9 sweep does not have to reconstruct it:

| § | Kind | Gist |
|---|---|---|
| H1 | Accepted deviation | The JSON codec buffers the whole body before parsing (`SERDE-27`); the seam itself does not |
| H2 | Accepted deviation | `SERDE-23` satisfied by delegation to the caller's schema, not by enforcement |
| H3 | Accepted deviation | No serde-specific error base class; two flat leaves plus `isSerdeError` (`SEAM-23`) |
| H4 | Recorded | Six places the shipped code departs from this plan as written |
| H5 | Deferred (Phase 9) | `NFR-8`/`NFR-9` shrinker keep-configuration |
| H6 | Deferred (Phase 10) | Assertion density, project-wide |
| H7 | Recorded | Coverage excludes `**/dist/**`; `bun test` is now build-dependent |
| H8 | Partly resolved / open | One bug fixed (the typed-tree pass-through); a *foreign* transport's stream error is still wrapped as `DeserializationError` |
| H9 | Open | Every decode target is treated as non-null; two named consequences |
| H10 | Open | One concept, two spellings: positional SPI vs. `DecodeTarget` at the handler layer |
| H11 | Open | `tristate()`/`tristateObject()` are format-agnostic but ship in a format-specific package |
| H12 | Open | `seams/index.ts` is an unimported internal barrel the corpus bans |
| H13 | Open | `test:scripts` runs in no CI job |
| H14 | Open | `decodeSuccessResponse`'s 4xx/5xx branch delegates to `toHttpError`, whose bare `finally { close() }` can displace the primary failure |
| H15 | Open | No `AbortSignal` on any of the four long-running async APIs this phase ships |
| H16 | Recorded | Deep-nesting encode diverges between Bun and Node; both outcomes are correct, so no gate |
| H17 | Recorded | `SERDE-20`'s array-element degradation comes from `JSON.stringify` itself; the replacer branch for it was dead |
