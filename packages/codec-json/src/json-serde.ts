// SPDX-License-Identifier: MIT
// packages/codec-json/src/json-serde.ts
import {
  DeserializationError,
  SerializationError,
  type DecodeTarget,
  type Deserializer,
  type Serde,
  type Serializer,
} from '@dexpace/core';
import {
  degradeTopLevelTristate,
  tristateReplacer,
} from './tristate-replacer.js';

/**
 * Options for {@link jsonSerde}.
 *
 * @public
 */
export interface JsonSerdeOptions {
  /**
   * Install the `Tristate` PATCH wiring (SERDE-19). Without it, Absent and Null are
   * indistinguishable on the wire, which silently turns "leave unchanged" into "clear".
   *
   * Set to `false` **only** when the caller has already installed equivalent wiring. Never silent —
   * the caller has to name it.
   *
   * @defaultValue `true`
   */
  readonly tristate?: boolean | undefined;
}

/**
 * Whether the Tristate wiring is installed, carried as one value rather than inferred from the
 * replacer being `undefined`: the top-level degradation and the replacer are two halves of the same
 * opt-in (SERDE-19), and reading one off the other couples them by convention alone.
 */
interface TristateWiring {
  readonly installed: boolean;
  readonly replacer: ((key: string, value: unknown) => unknown) | undefined;
}

const ENCODER = new TextEncoder();
const MEDIA_TYPE = 'application/json';

/**
 * `JSON.stringify` is declared as returning `string`, and does not: it returns `undefined` for a
 * top-level `undefined`, function, or symbol. Kept as a named seam even at one call site, so the
 * correction is attached to the trap rather than buried in the caller's control flow.
 */
function stringifyOrUndefined(
  value: unknown,
  replacer: TristateWiring['replacer'],
): string | undefined {
  return JSON.stringify(value, replacer);
}

function encodeToText(value: unknown, wiring: TristateWiring): string {
  // SERDE-20's top-level degradation runs HERE, before `JSON.stringify`, not inside the replacer.
  // A replacer sees `key === ''` both for the top-level value and for an ordinary key named `''`,
  // and cannot tell them apart — so handling it there emits a wire null for `{"": absent()}`, which
  // SERDE-15 requires be omitted. This is the one place that knows which value is the root.
  // Skipped entirely when the caller opted out: `{tristate: false}` means "I have installed
  // equivalent wiring", and degrading behind their back would defeat that.
  const root = wiring.installed ? degradeTopLevelTristate(value) : value;

  let text: string | undefined;
  try {
    text = stringifyOrUndefined(root, wiring.replacer);
  } catch (e: unknown) {
    throw new SerializationError('failed to encode value as JSON', {cause: e});
  }

  if (text === undefined) {
    // Reachable only for a top-level `undefined`, function, or symbol — a top-level Tristate was
    // resolved above. All three are unencodable values, which SERDE-9/SERDE-10 require surface as
    // the stable serde type. Emitting `null` instead would silently substitute a meaningful wire
    // value for a payload the caller could not have meant to send.
    throw new SerializationError(
      `a top-level ${typeof root} value has no JSON representation`,
    );
  }
  return text;
}

function encodeToBytes(value: unknown, wiring: TristateWiring): Uint8Array {
  return ENCODER.encode(encodeToText(value, wiring));
}

function makeSerializer(wiring: TristateWiring): Serializer {
  return Object.freeze({
    serializeToString(value: unknown): string {
      return encodeToText(value, wiring);
    },

    serialize(value: unknown): Uint8Array {
      return encodeToBytes(value, wiring);
    },

    serializeInto(value: unknown, target: Uint8Array, offset = 0): number {
      // Range-checked before encoding, so a bad offset costs nothing and the caller's buffer is
      // never partially written. `Number.isInteger` also rejects NaN and Infinity.
      if (!Number.isInteger(offset) || offset < 0 || offset > target.length) {
        throw new RangeError(
          `offset ${String(offset)} is out of range for a buffer of ${String(target.length)} bytes`,
        );
      }
      const bytes = encodeToBytes(value, wiring);
      if (bytes.length > target.length - offset) {
        // SERDE-4: an overflow is a RangeError, distinct from the serde type and with no cause
        // chain. Thrown BEFORE `set`, so `[0, offset)` and everything past it are untouched.
        throw new RangeError(
          `encoded payload of ${String(bytes.length)} bytes does not fit in ${String(
            target.length - offset,
          )} available bytes`,
        );
      }
      target.set(bytes, offset);
      return bytes.length;
    },

    async serializeTo(
      value: unknown,
      sink: WritableStream<Uint8Array>,
      options?: {readonly signal?: AbortSignal | undefined},
    ): Promise<void> {
      // Encoded before the lock is taken: a failed encode then leaves the caller's sink untouched
      // and still usable, rather than locked-and-released around a write that never happened.
      const bytes = encodeToBytes(value, wiring);
      // Checked after the encode and before the lock, so an aborted call leaves the sink neither
      // locked nor closed (SERDE-3). One write follows, so there is no loop to check inside.
      options?.signal?.throwIfAborted();
      const writer = sink.getWriter();
      try {
        await writer.write(bytes);
      } finally {
        // Release the lock, never close: the sink is caller-owned (SERDE-3).
        writer.releaseLock();
      }
    },
  });
}

const UNNAMED_TARGET = 'the target type';

function decodeText<T>(text: string, decodeTarget: DecodeTarget<T>): T {
  const {schema, typeName, admitsNull} = decodeTarget;
  const target = typeName ?? UNNAMED_TARGET;

  let parsed: unknown;
  try {
    // `as unknown`: JSON.parse is typed `any`, which would silently infect everything downstream.
    // The cast narrows *away* from `any`, the one direction the type-system chapter asks for at a
    // boundary.
    parsed = JSON.parse(text) as unknown;
  } catch (e: unknown) {
    throw new DeserializationError(`malformed JSON while decoding ${target}`, {
      cause: e,
    });
  }

  // SERDE-13, checked here rather than delegated: a schema library may or may not reject a bare
  // null, and may or may not name the target when it does. Checking in the codec makes the
  // behaviour uniform across every entry point and every schema library a caller might supply.
  // This is also the single funnel that makes SERDE-13's "across every decode overload" true for
  // this codec — `deserialize` and `deserializeFrom` both route through it.
  // `admitsNull` is the caller stating what the schema value cannot: that `T` includes `null`. Off
  // by default, so the rejection stays unconditional for every target that does not opt in.
  if (parsed === null && admitsNull !== true) {
    throw new DeserializationError(
      `wire null cannot be decoded into the non-null target ${target}`,
    );
  }

  try {
    return schema.parse(parsed);
  } catch (e: unknown) {
    throw new DeserializationError(
      `value does not match the schema for ${target}`,
      {cause: e},
    );
  }
}

function makeDeserializer(): Deserializer {
  return Object.freeze({
    deserialize<T>(data: Uint8Array, target: DecodeTarget<T>): T {
      return decodeText(new TextDecoder().decode(data), target);
    },

    async deserializeFrom<T>(
      source: ReadableStream<Uint8Array>,
      target: DecodeTarget<T>,
      options?: {readonly signal?: AbortSignal | undefined},
    ): Promise<T> {
      // `text` accumulates the WHOLE body before parsing, and is deliberately uncapped.
      //
      // SERDE-27 asks a decoder not to materialize the body. `JSON.parse` has no incremental form,
      // so this codec cannot honor that — a limitation of the format, not of the seam:
      // `decodeResponse` hands over the live stream and never buffers, and a codec with a streaming
      // parser satisfies SERDE-27 fully behind this same interface. Recorded in the phase's
      // Deviation Ledger.
      //
      // No byte cap: truncating a legitimate large payload is a worse failure than the memory it
      // would save, and a caller who needs a bound imposes it on the transport, where the whole
      // response is bounded at once.
      //
      // A streaming TextDecoder keeps multi-byte characters intact across chunk boundaries; decoding
      // each chunk independently would corrupt any character split across two reads.
      // Checked before the lock so an aborted call leaves the source neither locked nor cancelled
      // (SERDE-3), and again after every read so a long drain stops promptly.
      const signal = options?.signal;
      signal?.throwIfAborted();
      const decoder = new TextDecoder('utf-8');
      const reader = source.getReader();
      let text = '';
      try {
        for (;;) {
          // Serial by necessity: each read depends on the previous one advancing the cursor.
          const {done, value} = await reader.read();
          if (done) break;
          signal?.throwIfAborted();
          text += decoder.decode(value, {stream: true});
        }
        text += decoder.decode();
      } finally {
        // Release the lock, never cancel: the source is caller-owned (SERDE-3). A stream failure
        // surfaces from `read()` and propagates unwrapped (SERDE-12) — it is not caught here.
        reader.releaseLock();
      }
      return decodeText(text, target);
    },
  });
}

/**
 * Build a fresh JSON `Serde` bundle (SERDE-1, SERDE-2, SERDE-25).
 *
 * The bundle is frozen and stateless, so one instance safely serves every DTO and every concurrent
 * operation in an application (SERDE-29) — the payload type arrives as a `Schema` parameter of each
 * decode call, not as a property of the bundle.
 *
 * **Unknown wire fields (SERDE-23).** This codec does not strip or reject them — that is your
 * schema's decision. Prefer the permissive default (Zod's `.parse()` strips unknown keys;
 * `.strict()` rejects them), so a server adding a backward-compatible field does not break clients
 * that have not been regenerated yet. If you opt into a strict schema, you are opting out of that
 * forward compatibility deliberately.
 *
 * **Coercion (SERDE-21/SERDE-22).** There is no coercion setting because there is no coercing codec:
 * `JSON.parse` reshapes nothing, so `{"x":"5"}` yields the string `"5"` and a number-typed schema
 * rejects it. Representation-preserving binding still works, because JavaScript has one numeric type.
 *
 * **Values with no JSON representation (SERDE-9/SERDE-10).** A top-level `undefined`, function, or
 * symbol raises a `SerializationError` rather than encoding as the `null` literal. `JSON.stringify`
 * returns the *value* `undefined` for all three, and substituting `null` would put a meaningful
 * wire value in place of a payload the caller cannot have meant to send. Nested occurrences follow
 * ordinary `JSON.stringify` rules (the key is dropped; an array element becomes `null`).
 *
 * **Top-level Tristate degradation (SERDE-20)** is resolved by this bundle's serializer *before*
 * `JSON.stringify` runs, not by the replacer: a replacer cannot tell the top-level value from an
 * ordinary key named `''`. A top-level Absent or Null therefore still encodes as `null` here, while
 * `{"": absent()}` correctly omits the key. A caller composing their own
 * `JSON.stringify(v, tristateReplacer)` gets the nested and array-element behaviour but not the
 * top-level degradation — see {@link tristateReplacer}.
 *
 * **A top-level wire `null` decodes only into a target that admits one (SERDE-13).** A schema value
 * carries no nullability this codec could read, so the rejection is unconditional *by default* and
 * runs *before* the schema: a `200` whose entire body is the literal `null` raises a
 * `DeserializationError`. Setting `admitsNull: true` on the `DecodeTarget` is the caller stating what
 * the schema value cannot — that `T` includes `null` — and skips the check, which is the one case
 * where `tristate(inner)` serves as a top-level target rather than a field combinator for use inside
 * `tristateObject`. Checking after the schema instead would let a permissive schema such as
 * `{parse: (i) => i}` return that `null` as a non-null `T`.
 *
 * @param options - opt out of the Tristate wiring; everything else is fixed by the format.
 * @returns a frozen, stateless bundle safe to share across concurrent operations (SERDE-29).
 * @public
 */
export function jsonSerde(options?: JsonSerdeOptions): Serde {
  const installed = options?.tristate ?? true;
  const wiring: TristateWiring = {
    installed,
    replacer: installed ? tristateReplacer : undefined,
  };
  return Object.freeze({
    mediaType: MEDIA_TYPE,
    serializer: makeSerializer(wiring),
    deserializer: makeDeserializer(),
  });
}
