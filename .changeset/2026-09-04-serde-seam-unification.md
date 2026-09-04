---
"@dexpace/core": minor
"@dexpace/codec-json": minor
---

**Breaking to the `Serde` SPI, taken deliberately before the first published version.** Every decode
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
schema runs, unconditionally, because a schema *value* carries no nullability a codec could read and
moving the check later would let `{parse: (i) => i}` launder a `null` into a non-null `T`. Set
`admitsNull: true` to state what the schema cannot — that `T` includes `null` — and the check is
skipped. This is what makes a legitimately nullable success body decodable, and the one way
`tristate(inner)` can serve as a top-level target rather than a field combinator.

See `docs/work/mvp/2026-09-04-open-items-dissolution.md` H9, H10 and H15.
