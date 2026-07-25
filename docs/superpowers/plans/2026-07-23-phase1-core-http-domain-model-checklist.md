# Phase 1 — Core HTTP Domain Model Implementation Plan — Checklist

Verification of [2026-07-23-phase1-core-http-domain-model.md](./2026-07-23-phase1-core-http-domain-model.md)
against every `HTTP-N` requirement ID in `docs/product-spec/04-core-http-domain-model.md` (§4.1–4.6, HTTP-3
through HTTP-53 — 39 IDs total, verified against the actual requirement text, not just the design doc's
summaries) plus `SEAM-29` (`product-spec/03` §3.8) and `SEAM-1`/`SEAM-2` (`product-spec/02`).

**Legend:** ✅ Implemented and tested — ⚠️→✅ gap found during this pass, fixed in the plan — ⏳ Deferred (named
reason) — N/A.

## §4.1 Construction, immutability, derivation

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| HTTP-3 | MUST | `newBuilder()` derivation, no aliasing; value types re-constructed via factories | ✅ | Pattern established Task 1, applied in every task (`newBuilder()` on `Headers`/`Request`/`Response`/`QueryParams`/`RequestOptions`; static factories on `Status`/`Protocol`/`MediaType`/`ETag`/`HttpRange`) |
| HTTP-4 | MUST | `build()` validates required fields, field-named error | ✅ | `requireField()` (Task 1), used in Task 9 (Request: url, method), Task 10 (Response: request/protocol/status) |
| HTTP-5 | MUST | Accessors don't leak builder mutation or allow mutation-through-collection | ✅ | `Object.freeze` once at construction (every task); Task 9's `Request.url` getter specifically clones the mutable native `URL` on every access — the one place a naive frozen-class approach would still leak mutability |

## §4.2 Request and method legality

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| HTTP-6 | MUST | Request/Response required field sets | ✅ | Task 9 (Request), Task 10 (Response) |
| HTTP-7 | MUST | Reject body on GET/HEAD/TRACE/CONNECT at construction | ✅ | Task 9, `RequestBodyNotAllowedError` |
| HTTP-8 | SHOULD | No method+no body → GET; body+no method → error naming method | ✅ | Task 9 `RequestBuilder.build()` |
| HTTP-9 | MUST | Idempotency classification, uppercase wire token | ✅ | Task 2 |
| HTTP-46 | MUST | URL equality by textual form only, no DNS | ✅ | Task 9, `Request.equals()` compares `#url.href` |
| HTTP-47 | SHOULD | Malformed/non-absolute URL → argument error naming input | ✅ | Task 9, `parseUrl()` + `UrlConstructionError` |

## §4.3 Status

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| HTTP-10 | MUST | Total function of code, never throws, recognized/unrecognized distinction | ✅ | Task 3, property-tested |
| HTTP-11 | MUST | Range classification | ✅ | Task 3 |
| HTTP-12 | MUST | Equality by code only | ✅ | Task 3 |

## §4.4 Headers, media type, protocol, query

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| HTTP-13 | MUST | Case-insensitive storage, ASCII-only fold | ✅ | Task 6 |
| HTTP-14 | MUST | Multi-value: add appends, set replaces | ✅ | Task 6 |
| HTTP-15 | MUST | Null value removes the header | ✅ | Task 6 |
| HTTP-16 | SHOULD | Insertion order preserved | ✅ | Task 6 |
| HTTP-17 | MUST | Outbound name validation + trim | ✅ | Task 7, `hasForbiddenNameByte` |
| HTTP-18 | MUST | Outbound value validation (HTAB allowed) | ✅ | Task 5 (predicate), Task 7 (wired to `add`/`set`) |
| HTTP-19 | MUST | Inbound leniency (obs-text permitted, names still strict) | ✅ | Task 7, `addInbound`/`setInbound` + `hasForbiddenInboundValueByte` |
| HTTP-20 | MUST | No value echo, escaped name in error messages | ✅ | Task 1 (`HeaderValidationError`), tested Task 7 |
| HTTP-21 | MUST | Typed header-name: case-folded compare, original casing preserved | ✅ | Task 7, `HeaderName` |
| HTTP-22 | MAY | Process-wide interning, first casing wins | ✅ | Task 7, `HeaderName.of()`'s static cache |
| HTTP-23 | MUST | MediaType case rules (type/subtype/keys lower, values preserved) | ✅ | Task 5 |
| HTTP-24 | MUST | charset resolves case-insensitively, never throws | ✅ | Task 5 |
| HTTP-25 | MUST | Quoted-string-aware parse, first-`=`-only split, `parse(render(x))===x` | ✅ | Task 5, property-tested |
| HTTP-53 | MUST | Reject blank/empty type-subtype/malformed params | ✅ | Task 5 |
| HTTP-26 | MUST | Reject forbidden bytes in construction (same predicate as HTTP-18) | ✅ | Task 5, reuses `hasForbiddenOutboundByte` from the same task — the design doc's "same predicate" requirement is satisfied by literal code reuse, not just parallel logic |
| HTTP-27 | SHOULD | Wildcard matching (`*/*`, either-position wildcard) | ✅ | Task 5, `MediaType.matches()` |
| HTTP-28 | MUST | Case-sensitive query names, multi-value, value-less-as-empty-string | ✅ | Task 8 |
| HTTP-29 | MUST | RFC 3986 percent-encoding, not form-urlencoded | ✅ | Task 8, `percentEncodeComponent` |
| HTTP-32 | SHOULD | Per-component encoding independent of stdlib quirks | ✅ | Task 8 — verified `encodeURIComponent`'s divergence from RFC 3986 (`!*'()`) explicitly patched, not assumed correct |
| HTTP-30 | MUST | Order-sensitive equality; empty value-list dropped at build | ✅ | Task 8, `QueryParamsBuilder.build()` filters empty lists |
| HTTP-31 | MUST | Lenient parse, never throws, malformed % falls back to raw | ✅ | Task 8, `safeDecodeComponent` |
| HTTP-33 | MUST | Protocol canonical form + alias parsing | ✅ | Task 4 |

## §4.5 Request options

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| HTTP-34 | MUST | Operational overrides outside wire form; EMPTY sentinel; tags defensively copied | ✅ | Task 11 |
| HTTP-35 | MUST | Reject zero/negative timeout (null OK); reject negative retries (0 OK) | ✅ | Task 11 |

## §4.6 Conditional-request helpers

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| HTTP-48 | SHOULD | ETag strong/weak/any, etagc validation, round-trip, absent-for-blank | ✅ | Task 12 |
| HTTP-49 | SHOULD | HttpRange bounded/suffix/open, bytes-only, single-range, verbatim storage | ✅ | Task 13 |
| HTTP-50 | SHOULD | If-Match/If-None-Match comma-join, RFC 1123 dates, idempotent apply, any-tag exclusivity | ✅ | Task 14 |

## Seams

| ID | Level | Requirement gist | Status | Where |
|---|---|---|---|---|
| SEAM-29 | MUST | Shared generic `Builder` contract, uniform `<name> is required` message | ✅ | Task 1 — structural `interface Builder<T>`, `requireField()` |
| SEAM-1 | MUST | Core has zero runtime dependencies | ✅ verified, not (re)implemented | Task 15 Step 6 re-runs the Phase 0 `verify:seam-1` gate against this phase's actual dependency footprint — this phase must not weaken it, only confirm it still holds with real code present |
| SEAM-2 | MUST | Each core-owned concern is exactly one narrow interface seam | N/A this phase | No seams (transport, serde, etc.) are implemented in Phase 1 — Phase 2 (Seam Foundations) per the roadmap |

## Gaps found during this verification pass

None required a plan fix — every requirement text-checked against the actual `product-spec/04` wording (not just
`sdk-design-nodejs/04`'s paraphrase) already had a corresponding task and test before this pass. Two things worth
naming explicitly rather than treating as silent:

- **HTTP-26's "same predicate" language** was checked literally: Task 5's `MediaType` construction calls the
  exact same `hasForbiddenOutboundByte` function Task 7 wires into `Headers`' outbound value validation for
  HTTP-18 — not a second implementation of the same character class, which would have been a subtle drift risk
  (two predicates that happen to agree today but could silently diverge on a future edit).
- **The `MultipartBody` model** HTTP-3 lists among "each builder-based model" is not implemented this phase —
  documented as a deliberate deferral in the plan's own Self-Review, not an oversight, since it depends on the
  body-lifecycle contracts Phase 3 owns.

## Summary

All 39 `HTTP-N` IDs in scope (per the design doc's "full §4 now" scope decision) map to an implemented, tested
task. `SEAM-29` is implemented; `SEAM-1` is verified (not newly implemented — it was already satisfied by Phase
0's empty `dependencies` field, this phase's job is to not break it); `SEAM-2` is correctly out of scope until
Phase 2.
