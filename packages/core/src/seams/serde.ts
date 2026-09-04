// SPDX-License-Identifier: MIT
// packages/core/src/seams/serde.ts

/**
 * The runtime type witness a decode operation requires (SERDE-5, closing SEAM-21).
 *
 * TypeScript erases types completely — there is no runtime class token to reflect over, so an
 * erased generic cannot be recovered the way a JVM port recovers one. Instead the caller supplies a
 * *value* that already carries the same information: a schema. This interface is deliberately
 * structural and minimal so that Zod, Valibot, ArkType, effect/schema, and anything following the
 * community "Standard Schema" convention satisfy it without an adapter. `@dexpace/core` defines this
 * shape and depends on none of them (SEAM-1).
 *
 * Because TypeScript infers `T` from the schema's own generic parameter, the compile-time type and
 * the runtime witness are one artifact, not two things kept in sync by convention.
 *
 * @public
 */
export interface Schema<T> {
  /**
   * Validate an already-parsed wire value and return it as `T`.
   *
   * @param input - the decoded-but-unvalidated wire value.
   * @returns the value as `T`.
   * @throws Whatever the schema library raises; a {@link Deserializer} wraps it as a
   * `DeserializationError` with the original chained.
   */
  parse(input: unknown): T;
}

/**
 * The encode half of a {@link Serde} (SERDE-3, SERDE-4).
 *
 * No method takes a {@link Schema} — encoding has the value in hand and needs no witness.
 *
 * @public
 */
export interface Serializer {
  /**
   * Encode to a freshly allocated string.
   *
   * One of `SEAM-20`'s four allocation profiles. A codec whose wire form is not textual (CBOR,
   * protobuf) throws a `SerializationError` from this method rather than inventing a lossy
   * rendering.
   *
   * @param value - the value to encode.
   * @returns the encoded payload as a fresh string.
   * @throws SerializationError when the value cannot be encoded, or when this codec has no textual
   * wire form.
   */
  serializeToString(value: unknown): string;

  /**
   * Encode to a freshly allocated buffer.
   *
   * @param value - the value to encode.
   * @returns the encoded payload as fresh bytes.
   * @throws SerializationError when the value cannot be encoded.
   */
  serialize(value: unknown): Uint8Array;

  /**
   * Encode into a caller-owned buffer at `offset` (default 0), returning the number of bytes
   * written.
   *
   * Bytes before `offset` are left untouched, and the buffer is never resized, reallocated, or
   * otherwise taken ownership of.
   *
   * @param value - the value to encode.
   * @param target - the caller-owned buffer to write into.
   * @param offset - where to start writing; defaults to 0.
   * @returns the number of bytes written.
   * @throws RangeError — a plain one, **not** a serde error and with no chained cause — when
   * `offset` is out of range or the payload does not fit (SERDE-4).
   * @throws SerializationError when the value cannot be encoded.
   */
  serializeInto(value: unknown, target: Uint8Array, offset?: number): number;

  /**
   * Encode into a caller-owned sink, writing the payload fully.
   *
   * Does **not** close, abort, or otherwise take ownership of `sink` — the caller opened it and the
   * caller closes it (SERDE-3).
   *
   * @param value - the value to encode.
   * @param sink - the caller-owned destination; never closed or aborted by this call.
   * @returns a promise resolving once the whole payload has been written.
   * @throws SerializationError when the value cannot be encoded.
   * @throws TypeError when `sink` is already locked by another writer — the plain platform error,
   * not re-typed, because a contended sink is a programmer error rather than an encoding failure.
   * @throws Whatever writing to `sink` raised, propagated unwrapped: SERDE-12's rule is
   * directional-agnostic, so a genuine write failure is never re-wrapped as a serde exception.
   * The writer lock is released on that path too; the sink itself is left errored and unclosed,
   * because the caller owns it (SERDE-3).
   *
   * @remarks Takes no `AbortSignal`. The project-wide position is that a signal is required where an
   * API drives a stream it did not open, and this method does — so it is one of the two SPI methods
   * queued to gain `{signal}` in the pre-publish breaking-change batch. Tracked at
   * `docs/open-items.md` H15.
   */
  serializeTo(value: unknown, sink: WritableStream<Uint8Array>): Promise<void>;
}

/**
 * The decode half of a {@link Serde} (SERDE-5, SERDE-6, SERDE-13).
 *
 * `typeName` is an optional diagnostic label, never a witness: a structural schema value carries no
 * reliable name, so when a wire `null` is decoded into a non-null target the implementation names
 * the target from this label, falling back to `'the target type'`. That literal is part of the
 * contract and each codec repeats it — SEAM-1 leaves core with no exported constant to share, so the
 * duplication between `response-handlers.ts` and `@dexpace/codec-json` is deliberate, not drift.
 *
 * **Contract obligation on implementors (SERDE-13).** A wire `null` decoded into a non-null target
 * MUST throw `DeserializationError` naming that target, on *every* entry point, and MUST NOT return
 * a `null` that flows through the non-null result and detonates at some later field access. Enforce
 * it before delegating to the schema — a schema library may or may not reject a bare `null`, and may
 * or may not name the target when it does. Core cannot enforce this for you: `decodeResponse`
 * streams bytes straight into {@link Deserializer.deserializeFrom} and never holds a parsed value to
 * inspect, and core owning a parser would violate SEAM-1.
 *
 * **Every decode target is treated as non-null.** An implementation sees a schema *value*, which
 * carries no nullability it could read, so the check above cannot be conditional — it rejects a
 * top-level wire `null` unconditionally. A legitimately nullable top-level target is therefore
 * outside this contract: a `200` whose whole body is the literal `null` does not decode, and
 * `tristate(inner)` is a *field* combinator rather than a top-level decode target. This is
 * deliberate — the alternative lets a permissive schema such as `{parse: (i) => i}` launder a wire
 * `null` into a non-null `T`, which is the heap pollution SERDE-5 and SERDE-13 exist to prevent.
 *
 * **Why the decode entry points are positional while the response handlers are not.** `deserialize`
 * and `deserializeFrom` sit at three parameters, inside the project's `max-params` ceiling, and are
 * an SPI a third-party codec *implements* — a positional shape keeps that implementation burden
 * minimal. `decodeResponse`/`decodeSuccessResponse` carry the same `schema`/`typeName` pair bundled
 * as a `DecodeTarget`, because positionally they would be four parameters, which is not. One concept
 * therefore has two spellings across the two layers; unifying them is an open question for the phase
 * that next reshapes this seam.
 *
 * @public
 */
export interface Deserializer {
  /**
   * Decode from a complete in-memory payload.
   *
   * @param data - the encoded bytes.
   * @param schema - the runtime type witness; also the source of the static return type.
   * @param typeName - an optional diagnostic label naming the target in error messages.
   * @returns the decoded value.
   * @throws DeserializationError on malformed input, a schema rejection, or a wire `null` decoded
   * into a non-null target.
   */
  deserialize<T>(data: Uint8Array, schema: Schema<T>, typeName?: string): T;

  /**
   * Decode from a caller-owned source, reading to EOF.
   *
   * Does **not** cancel or otherwise take ownership of `source` — the caller closes it (SERDE-3).
   *
   * @param source - the caller-owned byte stream; read to EOF, never cancelled.
   * @param schema - the runtime type witness; also the source of the static return type.
   * @param typeName - an optional diagnostic label naming the target in error messages.
   * @returns a promise of the decoded value.
   * @throws DeserializationError on malformed input, a schema rejection, or a wire `null` decoded
   * into a non-null target. A genuine stream failure propagates unwrapped (SERDE-12), with the
   * reader lock released on that path too and `source` left uncancelled (SERDE-3).
   * @throws TypeError when `source` is already locked by another reader — the plain platform error,
   * not re-typed, because a contended source is a programmer error rather than a decode failure.
   *
   * @remarks Takes no `AbortSignal`. The project-wide position is that a signal is required where an
   * API drives a stream it did not open, and this method does — so it is one of the two SPI methods
   * queued to gain `{signal}` in the pre-publish breaking-change batch. Tracked at
   * `docs/open-items.md` H15.
   */
  deserializeFrom<T>(
    source: ReadableStream<Uint8Array>,
    schema: Schema<T>,
    typeName?: string,
  ): Promise<T>;
}

/**
 * The SDK's format-agnostic serialization seam: one encoder, one decoder, and one declared wire
 * media type, acquired through a single reference (SERDE-1, SEAM-19).
 *
 * Not generic in a payload type. A bundle is per-*format*, not per-*type* — the payload type arrives
 * as a {@link Schema} parameter of each decode call, so one `jsonSerde()` instance serves every DTO
 * in an application.
 *
 * `mediaType` is required and non-optional so a body built from a value plus a serde can never fall
 * back to a format-agnostic default `Content-Type` (SERDE-2).
 *
 * @public
 */
export interface Serde {
  /** The wire media type this bundle's serializer produces; never defaulted at the seam (SERDE-2). */
  readonly mediaType: string;
  /** The encode half. */
  readonly serializer: Serializer;
  /** The decode half. */
  readonly deserializer: Deserializer;
}
