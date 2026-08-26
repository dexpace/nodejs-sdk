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

The `SEAM-*` requirements this phase closes are listed first, because §3's wire-codec seam and §14's serde
chapter overlap and Phase 9 audits both indexes: **`SEAM-19`** (bundle of serializer + deserializer + undefaulted
media type) = `SERDE-1`/`SERDE-2`; **`SEAM-20`** (four allocation profiles; encode failures as a stable SDK type;
stream-write I/O errors unwrapped; fixed-buffer overflow as a bounds error) = `SERDE-3`/`SERDE-4`/`SERDE-9`/
`SERDE-12`, and its *fresh-string* profile is `serializeToString`; **`SEAM-21`** (explicit runtime witness, no
erased generic) = `SERDE-5`/`SERDE-6`; **`SEAM-22`** (generic type capture) = `SERDE-8`, collapsed below;
**`SEAM-23`** (stable SDK-owned failure hierarchy) = `SERDE-9`/`SERDE-10`, with a structural deviation recorded
in the ledger.

| ID | Level | Where |
|---|---|---|
| SERDE-1 | MUST | `Serde` bundle — one `serializer`, one `deserializer`, one `mediaType` |
| SERDE-2 | MUST | `mediaType` is the default `Content-Type` when a body is built from value + serde; never defaulted at the SPI |
| SERDE-3 | MUST | Stream profiles read to EOF / write fully, never close or take ownership of the caller's stream |
| SEAM-20 | MUST | Four allocation profiles: `serializeToString`, `serialize` (fresh bytes), `serializeTo` (caller sink), `serializeInto` (caller buffer + offset) |
| SERDE-4 | MUST | `serializeInto(value, target, offset)` — returns bytes written, honors offset, throws `RangeError` (**not** a serde error, no cause chain) on overflow, leaves `[0, offset)` untouched |
| SERDE-5 | MUST | Every decode takes a schema value as the explicit runtime witness — closes `SEAM-21` |
| SERDE-6 | MUST | Parametric targets via schema combinators (`z.array(DtoSchema)`), no reflective reconstruction |
| SERDE-7 | MUST | Collapsed — see below |
| SERDE-8 | MUST | Collapsed — see below |
| SERDE-9, SERDE-10 | MUST | `SerializationError` / `DeserializationError` — two flat leaves under `DexpaceError`, grouped by an exported `isSerdeError` guard rather than a base class (the tree stays two levels); backing failure always chained as `cause`, never escapes |
| SERDE-11 | SHOULD | By construction — JavaScript has no checked exceptions |
| SERDE-12 | MUST | A genuine stream failure propagates as Phase 3a's `IoError`, unwrapped; only malformed-input / unencodable-value failures are wrapped |
| SERDE-13 | MUST | Wire `null` into a non-null target throws `DeserializationError` naming the target, checked *before* the schema runs, in the one `decodeText` funnel every codec entry point shares — a documented `Deserializer` contract obligation, not something core can enforce over a third-party codec (see below) |
| SERDE-14 | MUST | `Tristate<T>` three-branch union, `present()` bounded against `null` at the type level |
| SERDE-15, SERDE-16 | MUST | `JSON.stringify` replacer (Absent → key omitted, Null → wire null, Present → value); `tristate(inner)` decode combinator |
| SERDE-17 | MUST | Missing key resolves to Absent via the combinator's own absent-default, not via a `JSON.parse` reviver |
| SERDE-18 | SHOULD | `absent()`, `nullValue()`, `present()`, `ofNullable()`, `foldTristate(t, {onAbsent, onNull, onPresent})` (named to avoid colliding with 4b's `Outcome` `fold`; the branches travel in one object because four positional parameters breach `max-params: 3`), `valueOrNull()`, `isAbsent`/`isNull`/`isPresent` |
| SERDE-19 | MUST | The replacer is installed by `jsonSerde()` **by default**; opt-out is an explicit, named option |
| SERDE-20 | SHOULD | Top-level / array-element Tristate degrades to a wire `null` rather than throwing |
| SERDE-21, SERDE-22 | MUST | Collapsed — see below |
| SERDE-23 | SHOULD | Delegated to the caller's schema, documented — see below |
| SERDE-24 | SHOULD | By construction — `Date.prototype.toJSON` emits ISO-8601; round-trip proven by test |
| SERDE-25 | SHOULD | `jsonSerde()` returns a fresh frozen bundle per call |
| SERDE-26 | MUST | Collapsed — see below |
| SERDE-27 | MUST | `decodeResponse(response, deserializer, {schema, typeName?})` — hands the live body to the deserializer without buffering at the handler layer, closes on every path (codec-level materialization noted below) |
| SERDE-28 | MUST | `decodeSuccessResponse(response, deserializer, {schema, typeName?})` — 2xx decodes, 4xx/5xx throws via 3b's `toHttpError()`, other non-2xx throws a status-leading `DeserializationError` preserving ETag/Location |
| SERDE-29 | SHOULD | By construction — single-threaded event loop; bundles are `Object.freeze`d and stateless |
| SERDE-30 | MAY | Shipped — `Absent`/`Null` sentinels carry a stable `toString()` |

## The Reshaped Seam

```typescript
/** The runtime type witness. Structurally matches Zod/Valibot/ArkType/effect-schema. */
interface Schema<T> {
  parse(input: unknown): T;
}

interface Serializer {
  serializeToString(value: unknown): string;
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

**All four of `SEAM-20`'s allocation profiles ship.** `SEAM-20` enumerates *produce a fresh string*, *produce a
fresh byte array*, *stream into a caller-owned output*, and *encode into a caller-owned scratch buffer at an
offset*. The string profile is the one an earlier draft dropped; it is free for a JSON codec (`JSON.stringify`
already produces the string that the byte profile then UTF-8-encodes) and a non-JSON codec that has no textual
form can throw from it, so there is no reason to ship three of four.

**Positional-parameter budget.** `serializeInto` and both decode entry points sit at three positional
parameters, the `max-params: 3` ceiling, matching Phase 2's shipped `Transport.send(request, options?, signal?)`
and 4b's `fold(outcome, onSuccess, onFailure)`. Nothing in this phase may reach four — see the response-handler
signatures below, which carry the schema and the diagnostic label in one object for exactly that reason.

**`typeName` is an optional diagnostic label**, not a witness. `SERDE-13` requires the null-rejection error to
*name the target type*, and a structural schema value carries no reliable name (Zod exposes `.description`,
Valibot does not, and neither is guaranteed populated). So the wire `null` is rejected explicitly, before the
schema runs, and the target is named from `typeName` when supplied, falling back to a documented
`'the target type'`.

**Where that check lives: in the `Deserializer` implementation, not in core's response handlers.** An earlier
draft of this document put it in core "so `SERDE-13`'s *across every decode overload* is mechanically true."
That is not implementable: `decodeResponse` streams the body straight into `deserializeFrom` and never holds a
parsed value to inspect — checking in core would mean core parsing the payload, which is exactly the codec
ownership `SEAM-1` forbids. The check therefore belongs one layer down, in `decodeText`, which **every**
`@dexpace/codec-json` entry point (`deserialize`, `deserializeFrom`, and so both response handlers by
composition) funnels through — that single funnel is what makes "across every decode overload" true for this
codec.

The consequence, stated so Phase 9 does not read it as a gap: `SERDE-13` is a contract obligation on
`Deserializer` implementors, documented on the interface, not an invariant core can enforce over a third-party
codec. Core cannot police a seam it deliberately owns no implementation of. The codec conformance test
(Task 10) is what proves the shipped one honors it.

### `SEAM-21` closure

Phase 2 shipped `Serde<T>.deserialize(data: unknown): T` with `T` inferred from the instance — precisely the
erased/inferred generic `SEAM-21` forbids — kept `@internal` and out of the barrel expressly so this reshape
would not be a breaking change. The reshape lands, the deferral closes, and the `@internal` marking comes off
(see "Public Barrel").

## `Tristate<T>`

```typescript
/** Registry-global, so two copies of core in one tree still agree — see the dual-package hazard below. */
const TRISTATE_BRAND: unique symbol = Symbol.for('@dexpace/core.Tristate');

type Tristate<T> =
  | {readonly [TRISTATE_BRAND]: true; readonly kind: 'absent'}
  | {readonly [TRISTATE_BRAND]: true; readonly kind: 'null'}
  | {readonly [TRISTATE_BRAND]: true; readonly kind: 'present'; readonly value: T};
```

**The brand is load-bearing, not decoration.** `SERDE-15`'s replacer has to recognize a Tristate among arbitrary
caller values, and a purely structural `{kind: 'present', value}` test would misfire on any caller DTO that
happens to carry a `kind` field — silently rewriting it, or omitting a key the caller wanted emitted. The brand
also gives the dual-package guard something to assert: `Symbol.for` resolves through the cross-realm registry, so
even two non-identical copies of `@dexpace/core` produce the *same* symbol and the codec keeps recognizing both.
The cost is that a caller writing a `Tristate` object literal by hand cannot — they must go through
`absent()`/`nullValue()`/`present()`, which is the intent (`present()` is where `NonNullable<T>` makes the
illegal fourth state unrepresentable).

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
/** The decode target: the runtime witness plus the optional diagnostic label that names it in errors. */
interface DecodeTarget<T> {
  readonly schema: Schema<T>;
  readonly typeName?: string | undefined;
}

function decodeResponse<T>(
  response: Response, deserializer: Deserializer, target: DecodeTarget<T>,
): Promise<T>;
function decodeSuccessResponse<T>(
  response: Response, deserializer: Deserializer, target: DecodeTarget<T>,
): Promise<T>;
```

The `deserializer` is an explicit parameter, not an ambient default. Core owns no codec and must not acquire one
(`SEAM-1`), so there is nothing for it to fall back to — a caller passing `jsonSerde().deserializer` is the only
way a decode can happen, and making that visible at the call site is the point.

**`schema` and `typeName` travel together in `DecodeTarget<T>`, not as two trailing positional parameters.**
The positional form `(response, deserializer, schema, typeName?)` is four parameters, and ESLint's
`max-params: 3` counts optional parameters — Phase 1 reserves the `eslint-disable` for private builder-internal
constructors, which these are not. The object also keeps both handler signatures identical and reads better at
the call site, where `typeName` would otherwise be a bare string argument in fourth position.

Both are free functions over `Response`, matching 3b's `toHttpError()` precedent (`Response` stays ignorant of
serde semantics) rather than methods.

- `SERDE-27`: streams `response.body` through `deserializeFrom` without materializing at the handler layer;
  closes the response on every path, with a close failure attached to the primary error rather than replacing it
  (see the runtime-floor note below); a missing body (204) throws `DeserializationError` naming the target; a
  codec failure is wrapped with the original chained; a genuine mid-stream failure propagates as `IoError`,
  unwrapped.

  **The handler does not materialize; the JSON codec necessarily does.** `JSON.parse` has no incremental form,
  so `@dexpace/codec-json`'s `deserializeFrom` accumulates the decoded text of the whole body before parsing it.
  `SERDE-27`'s no-materialize clause is therefore honored at the seam (core hands the live stream over and never
  buffers) and unavoidably broken one layer down by this particular codec — a format property, not a design
  choice, and a codec with a streaming parser satisfies it fully behind the same interface. Recorded in the
  Deviation Ledger so Phase 9 does not read the handler's compliance as end-to-end compliance. No byte cap is
  imposed on the accumulator: capping it would truncate legitimate large payloads, which is a worse failure than
  the memory cost it would avoid.

  **Runtime-floor note on the close-failure path.** Preserving a decode failure as primary while carrying the
  close failure alongside it is what `SuppressedError` is for, and `SuppressedError` is **not available on the
  declared `engines.node` floor** — it belongs to the full Explicit Resource Management proposal, which reached
  Node only in 24.0.0, against a floor of `>=20.3`, and this package's `lib` does not supply its type either.
  The cross-phase decision is **closed**: Phase 4b resolved it to branch (b) and shipped
  `suppress(error, suppressed, message)` in `packages/core/src/suppress.ts` — native class where the runtime has
  one, shape-compatible stand-in where it does not. 6a calls that helper and asserts its shape, never
  `instanceof SuppressedError`.
- `SERDE-28`: 2xx decodes. **4xx/5xx delegates to 3b's `toHttpError()`** — that function already buffers a bounded
  error body inside the response's own close-guaranteeing scope, at the shared 1 MiB cap `BODY-30`/`HTTP-52`
  define and `§14` itself points at. Building a second cap here would be a defect. Other non-2xx (1xx, an
  unfollowed 304) closes the response and throws a `DeserializationError` whose message leads with the status
  code and carries `ETag`/`Location` as `readonly` fields (3b's §5.3 sanitized-fields pattern), not only
  interpolated into the message.

`TypedResponse<T>` (3b) is the lazy, parse-once wrapper these two are the eager counterparts of; 3b's design
already names Phase 6 as the supplier of its `parse` callback. 6a supplies it:
`new TypedResponse(response, (r) => decodeResponse(r, jsonSerde().deserializer, {schema}))`. No change to `TypedResponse` itself.

## `@dexpace/codec-json`

```
packages/codec-json/
  package.json            # peerDependencies: {"@dexpace/core": "workspace:*"} + peerDependenciesMeta
  tsconfig.json           # composite, project reference to ../core, lib/target pinned to its own engines.node
  api-extractor.json
  README.md               # required of every publishable package (documentation.md:28)
  etc/codec-json.api.md
  src/
    json-serde.ts         # jsonSerde() → Serde; JSON.parse/stringify
    tristate-replacer.ts  # the JSON.stringify replacer implementing SERDE-15/SERDE-20
    tristate-schema.ts    # tristate(inner) / tristateObject(shape) decode combinators
    index.ts
    json-serde.test.ts  json-serde.property.test.ts  tristate-replacer.test.ts
    tristate-schema.test.ts  cross-package.test.ts  conformance.test.ts
```

The replacer is its own module rather than a private function inside `json-serde.ts`: it is exported (a caller
composing their own `JSON.stringify` call needs it), and `module-organization.md:42`'s one-concept-per-file rule
puts an exported wire-semantics transform beside the bundle factory, not inside it.

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
| `NFR-8` / `NFR-9` — shrinker keep-configuration and its regression guard, which `NFR-8` requires to cover "the runtime-wired SPI seams … (serde)" and "the Tristate type" | **Deferred to Phase 9, not dropped.** Both artifacts are created here, but the keep-config and the shrink-and-run guard are one workspace-wide deliverable, not a per-package one. `plans/2026-07-28-phase9-cross-cutting-conformance.md` ships `@dexpace/shrink-test` and already lists `@dexpace/codec-json` and `jsonSerde` in `participatingPackages` and the fixture app. 6a's obligation is only that both stay reachable through the public barrels, which Task 7 and Task 13 prove |

**`SERDE-23` (SHOULD — ignore unknown fields) is delegated, not collapsed.** Whether an extra wire field is
ignored or rejected is a property of the caller's schema (Zod strips by default; `.strict()` rejects), and core
cannot and should not override it. Documented in the codec's TSDoc as a recommendation with the rationale
(forward compatibility with a server adding fields), plus a deviation-ledger row: this port satisfies the
requirement's *intent* by defaulting to the permissive path every mainstream schema library already defaults to,
but does not *enforce* it.

## Public Barrel

`@dexpace/codec-json` is a separate package and can import only from `@dexpace/core`'s public entry point. That
settles the segmentation design's open promotion question by force: **`Schema`, `Serde`, `Serializer`,
`Deserializer`, `DecodeTarget`, `Tristate` + its helpers (`absent`, `nullValue`, `present`, `ofNullable`,
`foldTristate`, `valueOrNull`, `isAbsent`, `isNull`, `isPresent`, `tristateToString`), `SerializationError`,
`DeserializationError`, `SerdeErrorOptions`, `isSerdeError`, `serdeBody`, `decodeResponse`,
`decodeSuccessResponse`, and `isTristate`/`TRISTATE_BRAND` (the codec's recognition test) all go public.**
`api-extractor`'s core report changes; a second report is created for codec-json. Both need a changeset.

Every one of those carries a TSDoc block before it reaches the barrel — `documentation.md:6` makes that a
condition of being exported, and the three predicates are the easiest to forget because their names read as
self-explanatory.

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
  "Every" is literal: all twelve pairs the requirement enumerates, including `empty-string → floating-point`,
  which is the one an earlier draft's table dropped.
- A type-level `expectTypeOf` assertion on `tristateObject`'s mapped-plus-conditional return type
  (`testing.md:30`), since a runtime test cannot catch an inference regression there.

## Deviation Ledger (for Phase 10)

| Deviation | Against | Reason |
|---|---|---|
| No generic type carrier / `TypeRef` type exists | `SERDE-6`/`SERDE-8` | Nothing to carry — the schema is both witness and static type, from one caller statement |
| No codec-configuration surface (coercion, unknown fields, date format) | `SERDE-21`–`SERDE-26` | `JSON.parse`/`stringify` expose no such knobs; the responsibility sits in the caller's schema, one layer up |
| `SERDE-23` satisfied by delegation, not enforcement | `SERDE-23` (SHOULD) | Core cannot override a caller's schema strictness without defeating the point of caller-supplied schemas |
| No serde-specific error base class; two flat leaves under `DexpaceError` plus an `isSerdeError` guard | `SEAM-23`, `SERDE-9`/`SERDE-10` ("both of the common serde exception root") | The checkpoint's §5.2 two-level cap is why 3b retrofitted `IoError`'s tier away; a `SerdeError` base would be the third instance of the banned shape. `DexpaceError` is the common root and `isSerdeError` is the catch-one-category mechanism, so the requirement's *intent* (distinguish direction, catch one thing) holds; its *structure* (a serde-specific base type) does not |
| `@dexpace/codec-json` buffers the whole decoded body before parsing | `SERDE-27` ("without first materializing the whole body as a string/byte array") | `JSON.parse` has no incremental form. `decodeResponse` itself never buffers — it hands the live stream to the deserializer — so the seam honors the requirement and this one codec cannot. A streaming-parser codec satisfies it behind the same interface. No byte cap is imposed: truncating a legitimate large payload is worse than the memory it would save |
| `Serde` is not generic in `T` | Phase 2's provisional `Serde<T>` | A bundle is per-format, not per-type, once the witness is a decode parameter — which is what `SERDE-1` says |
