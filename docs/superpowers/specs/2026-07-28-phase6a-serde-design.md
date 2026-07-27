# Phase 6a — Serde — Design

**Status:** Draft, approved for planning.

**Purpose:** Ship the serialization seam — the reshaped `Serde`/`Serializer`/`Deserializer` SPI (closing
`SEAM-21`), `Tristate<T>`, the serde error leaves, `SERDE-2`'s media-type-as-default-`Content-Type` wiring, and
`SERDE-27`/`SERDE-28`'s response handlers — plus the workspace's first second package, `@dexpace/codec-json`.
Satisfies `docs/product-spec/14-serialization-serde.md` (`SERDE-1`–`SERDE-30`). First of the three sub-phases the
[Phase 6 segmentation design](./2026-07-28-phase6-segmentation-design.md) splits Phase 6 into: **6a** (this
document, serde), 6b (SSE, `§13`), 6c (pagination, `§12`).

**Governing documents:** `docs/product-spec/14-serialization-serde.md` (normative, cited by ID throughout),
`docs/sdk-design-nodejs/07-pagination-sse-and-serialization.md` §7.3 (schema-as-witness),
`docs/sdk-design-nodejs/02-package-and-workspace-layout.md` (the `@dexpace/codec-json` package contract, the
peer-dependency rule, the dual-package hazard), `docs/knowledge/{serde,package-and-dependency-layout}.md`, the
Phase 2 design (`Serde<T>`'s provisional shape, reshaped here), the Phase 3a design (`IoError`), and the Phase 3b
design (`Body`, `TypedResponse<T>`, `toHttpError()`, the flattened error tree). Styleguide:
`styleguide/typescript/` chapters 06, 08, 09, 11, 12, 15; `styleguide/typescript-bun/` chapters 02, 08.

**Solo-brainstorm note.** Drafted with the user away from keyboard, `docs/knowledge/` as standing tie-breaker.
6a shares no types with 6b or 6c by spec mandate (segmentation design §2), so the 5b/5c drift hazard does not
apply between them; what 6a *does* share is with **earlier** phases, and every such touchpoint is named in
"Reused, Not Rebuilt" below rather than left to mid-draft discovery.

## Scope

6a ships the serde seam and the reference codec. No pagination, no SSE — and, per `SSE-37` and `§12`'s preamble,
neither of those will ever import from here.

**Not in scope:** a schema library. Core defines the structural witness interface and depends on nothing;
`@dexpace/codec-json` wraps `JSON.parse`/`JSON.stringify` and depends on nothing beyond a `@dexpace/core` peer.
Zod/Valibot/ArkType are what a *caller* supplies, never a dependency of either package.

## Requirement Coverage

| ID | Level | Where |
|---|---|---|
| SERDE-1 | MUST | `Serde` bundle — one `serializer`, one `deserializer`, one `mediaType` |
| SERDE-2 | MUST | `mediaType` is the default `Content-Type` when a body is built from value + serde; never defaulted at the SPI |
| SERDE-3 | MUST | Stream profiles read to EOF / write fully, never close or take ownership of the caller's stream |
| SERDE-4 | MUST | `serializeInto(value, target, offset)` — returns bytes written, honors offset, throws `RangeError` (**not** a serde error, no cause chain) on overflow, leaves `[0, offset)` untouched |
| SERDE-5 | MUST | Every decode takes a schema value as the explicit runtime witness — closes `SEAM-21` |
| SERDE-6 | MUST | Parametric targets via schema combinators (`z.array(DtoSchema)`), no reflective reconstruction |
| SERDE-7 | MUST | Collapsed — see below |
| SERDE-8 | MUST | Collapsed — see below |
| SERDE-9, SERDE-10 | MUST | `SerializationError` / `DeserializationError` — two flat leaves under `DexpaceError`, grouped by an exported `isSerdeError` guard rather than a base class (the tree stays two levels); backing failure always chained as `cause`, never escapes |
| SERDE-11 | SHOULD | By construction — JavaScript has no checked exceptions |
| SERDE-12 | MUST | A genuine stream failure propagates as Phase 3a's `IoError`, unwrapped; only malformed-input / unencodable-value failures are wrapped |
| SERDE-13 | MUST | Wire `null` into a non-null target throws `DeserializationError` naming the target, checked in core *before* the schema runs, uniform across every decode entry point |
| SERDE-14 | MUST | `Tristate<T>` three-branch union, `present()` bounded against `null` at the type level |
| SERDE-15, SERDE-16 | MUST | `JSON.stringify` replacer (Absent → key omitted, Null → wire null, Present → value); `tristate(inner)` decode combinator |
| SERDE-17 | MUST | Missing key resolves to Absent via the combinator's own absent-default, not via a `JSON.parse` reviver |
| SERDE-18 | SHOULD | `absent()`, `nullValue()`, `present()`, `ofNullable()`, `foldTristate()` (named to avoid colliding with 4b's `Outcome` `fold`), `valueOrNull()`, `isAbsent`/`isNull`/`isPresent` |
| SERDE-19 | MUST | The replacer is installed by `jsonSerde()` **by default**; opt-out is an explicit, named option |
| SERDE-20 | SHOULD | Top-level / array-element Tristate degrades to a wire `null` rather than throwing |
| SERDE-21, SERDE-22 | MUST | Collapsed — see below |
| SERDE-23 | SHOULD | Delegated to the caller's schema, documented — see below |
| SERDE-24 | SHOULD | By construction — `Date.prototype.toJSON` emits ISO-8601; round-trip proven by test |
| SERDE-25 | SHOULD | `jsonSerde()` returns a fresh frozen bundle per call |
| SERDE-26 | MUST | Collapsed — see below |
| SERDE-27 | MUST | `decodeResponse(response, deserializer, schema, typeName?)` — streams through the deserializer, closes on every path |
| SERDE-28 | MUST | `decodeSuccessResponse(response, deserializer, schema, typeName?)` — 2xx decodes, 4xx/5xx throws via 3b's `toHttpError()`, other non-2xx throws a status-leading `DeserializationError` preserving ETag/Location |
| SERDE-29 | SHOULD | By construction — single-threaded event loop; bundles are `Object.freeze`d and stateless |
| SERDE-30 | MAY | Shipped — `Absent`/`Null` sentinels carry a stable `toString()` |

## The Reshaped Seam

```typescript
/** The runtime type witness. Structurally matches Zod/Valibot/ArkType/effect-schema. */
interface Schema<T> {
  parse(input: unknown): T;
}

interface Serializer {
  serialize(value: unknown): Uint8Array;
  serializeInto(value: unknown, target: Uint8Array, offset?: number): number;
  serializeTo(value: unknown, sink: WritableStream<Uint8Array>): Promise<void>;
}

interface Deserializer {
  deserialize<T>(data: Uint8Array, schema: Schema<T>, typeName?: string): T;
  deserializeFrom<T>(source: ReadableStream<Uint8Array>, schema: Schema<T>, typeName?: string): Promise<T>;
}

interface Serde {
  readonly mediaType: string;
  readonly serializer: Serializer;
  readonly deserializer: Deserializer;
}
```

**`Serde` is no longer generic in `T`** — the segmentation design left this open; the schema resolves it. Phase 2's
`Serde<T>` bound one bundle to one payload type, which was always an artifact of `deserialize`'s inferred return.
Once `T` arrives as a *parameter of the decode call*, a bundle is a per-*format* object, not a per-*type* one,
which is what `SERDE-1`'s "one bundle, one wire format" actually says. One `jsonSerde()` instance now serves every
DTO in an application.

**`Serializer` takes `unknown`, not `T`.** Encoding needs no witness — the value is in hand. `SERDE-3`/`SERDE-4`
are ownership and allocation contracts, not typing ones.

**`typeName` is an optional diagnostic label**, not a witness. `SERDE-13` requires the null-rejection error to
*name the target type*, and a structural schema value carries no reliable name (Zod exposes `.description`,
Valibot does not, and neither is guaranteed populated). Core therefore checks for the wire `null` itself, before
delegating to the schema, and names the target from `typeName` when supplied, falling back to a documented
`'the target type'`. Doing the check in core — not leaving it to the schema — is also what makes `SERDE-13`'s
"across every decode overload" mechanically true rather than dependent on which schema library a caller chose.

### `SEAM-21` closure

Phase 2 shipped `Serde<T>.deserialize(data: unknown): T` with `T` inferred from the instance — precisely the
erased/inferred generic `SEAM-21` forbids — kept `@internal` and out of the barrel expressly so this reshape
would not be a breaking change. The reshape lands, the deferral closes, and the `@internal` marking comes off
(see "Public Barrel").

## `Tristate<T>`

```typescript
type Tristate<T> =
  | {readonly kind: 'absent'}
  | {readonly kind: 'null'}
  | {readonly kind: 'present'; readonly value: T};
```

`present<T>(value: NonNullable<T>): Tristate<T>` makes `SERDE-14`'s illegal fourth state unrepresentable at the
type level — strictly earlier than the reference's construction-time runtime rejection. The union is a
discriminated union over object literals, not a class hierarchy (`styleguide/typescript/06` §6.4/§6.5, the same
pattern 3b's `Body` and 4b's `Outcome<T>` already use).

`Tristate` lives in **core**, not codec-json: `SERDE-14`'s type is format-agnostic, a PATCH-shaped domain concept
that a caller models DTOs with regardless of wire format. Only the *wiring* (`SERDE-15`/`SERDE-16`/`SERDE-19`) is
JSON-specific and lives in codec-json. This also matters for the dual-package hazard — see below.

`SERDE-20`'s degradation is real work, not a freebie: `JSON.stringify`'s replacer cannot omit an array element or
a top-level value, so the replacer emits `null` for Absent in exactly those two positions and omits the key
everywhere else.

## Errors

New leaves on 3b's flattened tree (`DexpaceError → leaf`, two levels, per the checkpoint's §5.2 cap — no
`SerdeError → SerializationError` sub-tier, which would reintroduce the three-level shape 3b just finished
retrofitting away):

```
DexpaceError
├── … (Phases 1–3b)
├── SerializationError      (6a — write path, SERDE-10)
└── DeserializationError    (6a — read path, SERDE-10)
```

`SERDE-9`/`SERDE-10` want callers to catch one base type while distinguishing direction. Two flat leaves plus an
exported `isSerdeError(e): e is SerializationError | DeserializationError` type guard delivers both, using the
same guard-union mechanism 3b chose for `isIoError`/`isBodyError` rather than a third distinct pattern.

`SERDE-4`'s overflow throws a plain `RangeError` — the spec explicitly requires an error *distinct from the serde
type and not chaining one*. `SERDE-12`'s stream failures propagate as Phase 3a's `IoError`, untouched.

## `SERDE-2` — Media Type as Default `Content-Type`

3b ships `Body` variants with a `mediaType` field. 6a adds one factory to the body layer:

```typescript
function serdeBody(value: unknown, serde: Serde, mediaType?: string): Body;
```

It encodes eagerly to bytes (so the body is `replayable: true`, which retry needs) and defaults `mediaType` to
`serde.mediaType`. `SERDE-2`'s "MUST NOT be defaulted to a format-agnostic constant at the SPI level" is enforced
structurally: there is no `'application/octet-stream'` fallback anywhere on this path, and `Serde.mediaType` is a
required non-optional field, so a serde cannot fail to declare one.

## Response Handlers

```typescript
function decodeResponse<T>(
  response: Response, deserializer: Deserializer, schema: Schema<T>, typeName?: string,
): Promise<T>;
function decodeSuccessResponse<T>(
  response: Response, deserializer: Deserializer, schema: Schema<T>, typeName?: string,
): Promise<T>;
```

The `deserializer` is an explicit parameter, not an ambient default. Core owns no codec and must not acquire one
(`SEAM-1`), so there is nothing for it to fall back to — a caller passing `jsonSerde().deserializer` is the only
way a decode can happen, and making that visible at the call site is the point.

Both are free functions over `Response`, matching 3b's `toHttpError()` precedent (`Response` stays ignorant of
serde semantics) rather than methods.

- `SERDE-27`: streams `response.body` through `deserializeFrom` without materializing; closes the response on
  every path via a `try/finally`; a missing body (204) throws `DeserializationError` naming the target; a codec
  failure is wrapped with the original chained; a genuine mid-stream failure propagates as `IoError`, unwrapped.
- `SERDE-28`: 2xx decodes. **4xx/5xx delegates to 3b's `toHttpError()`** — that function already buffers a bounded
  error body inside the response's own close-guaranteeing scope, at the shared 1 MiB cap `BODY-30`/`HTTP-52`
  define and `§14` itself points at. Building a second cap here would be a defect. Other non-2xx (1xx, an
  unfollowed 304) closes the response and throws a `DeserializationError` whose message leads with the status
  code and carries `ETag`/`Location` as `readonly` fields (3b's §5.3 sanitized-fields pattern), not only
  interpolated into the message.

`TypedResponse<T>` (3b) is the lazy, parse-once wrapper these two are the eager counterparts of; 3b's design
already names Phase 6 as the supplier of its `parse` callback. 6a supplies it:
`new TypedResponse(response, (r) => decodeResponse(r, jsonSerde().deserializer, schema))`. No change to `TypedResponse` itself.

## `@dexpace/codec-json`

```
packages/codec-json/
  package.json          # peerDependencies: {"@dexpace/core": "workspace:*"} + peerDependenciesMeta
  tsconfig.json         # composite, project reference to ../core
  api-extractor.json
  etc/codec-json.api.md
  src/
    json-serde.ts       # jsonSerde() → Serde; JSON.parse/stringify; the Tristate replacer
    tristate-schema.ts  # tristate(inner) decode combinator
    index.ts
```

`jsonSerde()` returns a fresh, `Object.freeze`d bundle per call (`SERDE-25`) with the Tristate replacer installed
by default (`SERDE-19`); opting out is a named option (`{tristate: false}`), never silent.

**This is the workspace's first second package**, which makes three Phase-0 deferrals live here rather than in
Phase 8 (segmentation design §6, roadmap rows retargeted 2026-07-28):

- **Peer-dependency dedup / dual-package hazard.** `codec-json` declares `@dexpace/core` as a `peerDependency`
  with a `peerDependenciesMeta` entry, per `sdk-design-nodejs/02` §2. Not theoretical for this package: the
  hazard breaks branded-identity checks, and `Tristate`'s discriminant is 6a's own deliverable — two copies of
  core would mean codec-json's replacer failing to recognize a caller's `Tristate` values, silently emitting a
  key the caller asked to omit. **The plan must include a test that constructs a `Tristate` in core and
  round-trips it through codec-json's replacer**, so the wiring is proven, not assumed.
- **`NFR-14`** — version single-sourcing. The Bun `catalog`/`catalogs` field in the workspace-root `package.json`
  replaces the pnpm `catalog:` protocol `sdk-design-nodejs/02` specifies, consistent with the roadmap's standing
  Bun-over-pnpm resolution. Confirm the exact field shape against `styleguide/typescript-bun/` and the installed
  Bun version at plan time; if the installed Bun predates catalog support, fall back to a root-declared
  `devDependencies` set inherited by workspace members and record it as a deviation rather than restating
  versions per package.
- **`NFR-2`** — codec-json is the first separately installable capability unit, and it takes **zero** external
  libraries. Closes the codec half; the transport half stays Phase 8.

Also inherited from the scaffold, now applying to a second package for the first time: the CI check that
`@dexpace/core`'s `dependencies` is a hard-committed `{}` must be generalized to assert `codec-json`'s
`dependencies` is `{}` too (its only edge to core is a peer), and library builds stay plain `tsc`, never
`Bun.build` (`typescript-bun/08`).

## Reused, Not Rebuilt

| Surface | From | Why it must not be re-implemented here |
|---|---|---|
| `toHttpError()` + the 1 MiB error-body cap | 3b | `SERDE-28`'s bounded error body **is** `BODY-30`/`HTTP-52`; §14 says so in its own parenthetical |
| `IoError` | 3a | `SERDE-12`'s unwrapped-propagation rule routes over the existing error, adds none |
| `TypedResponse<T>` | 3b | Already built for exactly this; 6a supplies its `parse`, changes nothing |
| The flattened error tree + guard-union grouping | 3b / checkpoint §5.2 | A `SerdeError` base class would be a third instance of the banned three-level shape |
| `Body` + `Object.freeze` immutability discipline | 3b / 1 | `serdeBody` is a factory over existing variants, not a new variant |

## Collapsed Requirements

Phase 9's sweep must read this table rather than re-deriving it, or six MUSTs read as uncovered.

| ID | Disposition |
|---|---|
| `SERDE-7` — ergonomic reified/inline decode helper routing through the generic carrier | **N/A.** TypeScript has no reified generics to capture. The schema value *is* the reification, and it is already the mandatory parameter of every decode entry point — there is no second, less-typed path for a helper to route away from |
| `SERDE-8` — carrier rejects construction with no type argument / an unresolved type variable | **Vacuous.** Nothing is inferred from an erased generic at runtime, so the "erases to its bound" state is unreachable. `sdk-design-nodejs/07` §7.3: the compiler's refusal of a call site missing a concrete schema is earlier and stronger than the reference's runtime guard |
| `SERDE-21` — reject cross-shape scalar coercion | **Satisfied by construction, one layer up.** `JSON.parse` performs *no* coercion: `{"x":"5"}` yields the string `"5"`, and a number-typed schema rejects it. There is no coercion setting to turn off because there is no coercing codec. Every listed pair is covered by a conformance test asserting the rejection, so the behavior is proven even though no code implements it |
| `SERDE-22` — permit representation-preserving conversions | **Satisfied by construction.** JavaScript has one numeric type, so integer→float widening is not a conversion at all; empty-string→string binds trivially |
| `SERDE-25` — fresh instance per factory call | Shipped, but trivial: `jsonSerde()` allocates. The requirement's rationale (codec instances carry mutable caches) does not apply — there is no engine and no cache |
| `SERDE-26` — never mutate a caller-supplied codec instance; operate on a private copy | **N/A.** There is no codec object to supply, copy, or mutate. `jsonSerde()` takes options, not an engine. The requirement's entire failure mode — the SDK reconfiguring a `ObjectMapper` the caller also uses — is unreachable |

**`SERDE-23` (SHOULD — ignore unknown fields) is delegated, not collapsed.** Whether an extra wire field is
ignored or rejected is a property of the caller's schema (Zod strips by default; `.strict()` rejects), and core
cannot and should not override it. Documented in the codec's TSDoc as a recommendation with the rationale
(forward compatibility with a server adding fields), plus a deviation-ledger row: this port satisfies the
requirement's *intent* by defaulting to the permissive path every mainstream schema library already defaults to,
but does not *enforce* it.

## Public Barrel

`@dexpace/codec-json` is a separate package and can import only from `@dexpace/core`'s public entry point. That
settles the segmentation design's open promotion question by force: **`Schema`, `Serde`, `Serializer`,
`Deserializer`, `Tristate` + its helpers, `SerializationError`, `DeserializationError`, `isSerdeError`,
`serdeBody`, `decodeResponse`, `decodeSuccessResponse`, and `isTristate`/`TRISTATE_BRAND` (the codec's recognition test) all go public.** `api-extractor`'s core report changes;
a second report is created for codec-json. Both need a changeset.

## Testing

`bun test` + `fast-check` per the standing toolchain. Notable cases beyond the per-ID conformance tests:

- A close-counting `WritableStream`/`ReadableStream` wrapper proving `SERDE-3`'s zero-close contract on both
  directions.
- `serializeInto` at an offset into an oversized buffer, asserting return value, the written region, and that
  `[0, offset)` is byte-identical to its pre-call contents; then a one-byte-short buffer asserting `RangeError`
  with no `cause`.
- The cross-package `Tristate` round-trip named above, guarding the dual-package hazard.
- A `Date` round-trip proving `SERDE-24`'s ISO-8601 form and instant equality.
- Every `SERDE-21` coercion pair, asserting rejection — the tests are the coverage, since no code implements it.

## Deviation Ledger (for Phase 10)

| Deviation | Against | Reason |
|---|---|---|
| No generic type carrier / `TypeRef` type exists | `SERDE-6`/`SERDE-8` | Nothing to carry — the schema is both witness and static type, from one caller statement |
| No codec-configuration surface (coercion, unknown fields, date format) | `SERDE-21`–`SERDE-26` | `JSON.parse`/`stringify` expose no such knobs; the responsibility sits in the caller's schema, one layer up |
| `SERDE-23` satisfied by delegation, not enforcement | `SERDE-23` (SHOULD) | Core cannot override a caller's schema strictness without defeating the point of caller-supplied schemas |
| `Serde` is not generic in `T` | Phase 2's provisional `Serde<T>` | A bundle is per-format, not per-type, once the witness is a decode parameter — which is what `SERDE-1` says |
