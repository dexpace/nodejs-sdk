# Write a serde

A serde is a wire codec behind three interfaces. It is bigger than it first looks: the encode half
has **four allocation profiles** and the decode half **two**, and an implementor owes all six
(`SEAM-20`, `SERDE-3`/`SERDE-4`/`SERDE-5`/`SERDE-6`).

```typescript
interface Serde {
  readonly serializer: Serializer;
  readonly deserializer: Deserializer;
  readonly mediaType: string;
}

interface Serializer {
  serialize(value: unknown): Uint8Array;                        // fresh buffer
  serializeToString(value: unknown): string;                    // fresh string
  serializeInto(value: unknown, target: Uint8Array, offset?: number): number; // caller's buffer
  serializeTo(value: unknown, sink: WritableStream<Uint8Array>): Promise<void>; // caller's sink
}

interface Deserializer {
  deserialize<T>(data: Uint8Array, schema: Schema<T>, typeName?: string): T;
  deserializeFrom<T>(source: ReadableStream<Uint8Array>, schema: Schema<T>, typeName?: string): Promise<T>;
}

interface Schema<T> {
  parse(input: unknown): T;
}
```

No encode method takes a `Schema` — encoding has the value in hand and needs no witness.

`@dexpace/core` ships **no** codec. `@dexpace/codec-json` is the reference implementation and a peer
of core, never a dependency of it — which is what forced the seam to be public in the first place: a
separate package can only reach core through its published entry point.

## Schema is the type witness

`Schema<T>` is one method, `parse(input: unknown): T`. Zod, Valibot, ArkType, a hand-written
predicate — anything with a `parse` satisfies it, and nothing registers. This is `SEAM-21`'s type
witness: TypeScript erases generics, so a deserializer cannot reflect on `T`; the schema **is** the
runtime carrier of the type, and it is also the source of the static one, so there is no separate type
argument to keep in sync.

`typeName` is diagnostics only. It never selects behaviour; it makes a `DeserializationError`
message name the thing that failed to parse.

## The minimum

All six methods, no shortcuts. This is the shape, not a sketch:

```typescript
import {
  DeserializationError,
  SerializationError,
  type Schema,
  type Serde,
} from '@dexpace/core';

const TEXT = new TextEncoder();

export function csvSerde(): Serde {
  const encode = (value: unknown): string => {
    if (!Array.isArray(value)) {
      throw new SerializationError('the csv serializer takes an array of rows');
    }
    return value.map(row => String(row)).join('\n');
  };

  const decode = <T>(text: string, schema: Schema<T>, typeName?: string): T => {
    try {
      return schema.parse(text.split('\n'));
    } catch (cause) {
      throw new DeserializationError(
        `could not decode ${typeName ?? 'the target type'}`,
        {cause},
      );
    }
  };

  return {
    mediaType: 'text/csv',
    serializer: {
      serialize: value => TEXT.encode(encode(value)),
      serializeToString: encode,
      serializeInto(value, target, offset = 0) {
        const bytes = TEXT.encode(encode(value));
        // A plain RangeError, deliberately: SERDE-4 says a buffer that does not fit is the
        // caller's arithmetic error, not an encoding failure, so it is NOT a SerializationError.
        if (offset < 0 || offset + bytes.length > target.length) {
          throw new RangeError('the encoded payload does not fit at that offset');
        }
        target.set(bytes, offset);
        return bytes.length;
      },
      async serializeTo(value, sink) {
        const writer = sink.getWriter(); // TypeError if contended — a programmer error, not re-typed
        try {
          await writer.write(TEXT.encode(encode(value)));
        } finally {
          writer.releaseLock(); // never close or abort: the caller owns the sink (SERDE-3)
        }
      },
    },
    deserializer: {
      deserialize: (data, schema, typeName) =>
        decode(new TextDecoder().decode(data), schema, typeName),
      async deserializeFrom(source, schema, typeName) {
        const reader = source.getReader();
        const chunks: Uint8Array[] = [];
        try {
          for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
          }
        } finally {
          reader.releaseLock(); // never cancel: the caller owns the source (SERDE-3)
        }
        const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let at = 0;
        for (const chunk of chunks) {
          joined.set(chunk, at);
          at += chunk.length;
        }
        return decode(new TextDecoder().decode(joined), schema, typeName);
      },
    },
  };
}
```

Six rules, all visible above:

1. **Raise `SerializationError` / `DeserializationError`, never a raw error** — with one stated
   exception: `serializeInto`'s out-of-range or does-not-fit case is a plain `RangeError` with no
   chained cause (`SERDE-4`). Both serde errors descend from `DexpaceError`, and `isSerdeError(e)`
   narrows the union.
2. **Always pass `{cause}`.** The underlying parser's message is what a caller actually debugs with.
3. **Never take ownership of a caller's stream** (`SERDE-3`). `serializeTo` does not close or abort
   the sink; `deserializeFrom` does not cancel the source. Release your lock and leave the resource
   to whoever opened it — including on the failure path.
4. **A contended stream is a plain `TypeError`**, not re-typed. Two writers on one sink is a
   programmer error, not an encoding failure.
5. **A wire failure propagates unwrapped** (`SERDE-12`). Re-wrapping a write or read failure as a
   serde exception tells a caller their payload was malformed when their socket dropped. The rule is
   direction-agnostic: it applies to `serializeTo` as much as to `deserializeFrom`.
6. **A wire `null` decoded into a non-null target MUST throw** `DeserializationError` naming that
   target, on **every** entry point (`SERDE-13`), never return a `null` that detonates at a later
   field access. The fallback label is the literal `'the target type'`; each codec repeats it,
   because `SEAM-1` leaves core with no exported constant to share.

`mediaType` is the default `Content-Type` — `serdeBody(value, serde)` reads it, and a caller may
override per body.

## Using one

```typescript
import {serdeBody} from '@dexpace/core';
import {jsonSerde} from '@dexpace/codec-json';

const serde = jsonSerde();
const body = serdeBody({name: 'ada'}, serde); // Content-Type: application/json
```

See [`write-a-response-handler.md`](./write-a-response-handler.md) for the decode side.

## The tri-state problem

This is the part a JSON codec gets wrong by default, and the reason `@dexpace/codec-json` exists as a
reference rather than as a five-line `JSON.parse` wrapper.

A PATCH request has **three** meanings for a field, and JavaScript gives you two:

| Intent | Wire | JavaScript |
|---|---|---|
| Leave it alone | key absent | `undefined` |
| Clear it | `"x": null` | `null` |
| Set it | `"x": 1` | `1` |

`JSON.stringify` drops `undefined` keys, so the first two collapse the moment anything round-trips
through an optional property. `Tristate<T>` is core's answer — a branded discriminated union of
`'absent' | 'null' | 'present'`:

```typescript
import {absent, foldTristate, nullValue, present} from '@dexpace/core';

const patch = {
  name: present('ada'),
  nickname: nullValue(),   // emits "nickname": null
  bio: absent(),           // omits the key entirely
};

foldTristate(patch.name, {
  onAbsent: () => 'unchanged',
  onNull: () => 'cleared',
  onPresent: value => `set to ${value}`,
});
```

`isPresent`, `isNull`, `isAbsent` and `valueOrNull` are the narrowing helpers; `ofNullable` lifts a
`T | null | undefined`. The `TRISTATE_BRAND` symbol is what makes `isTristate` reliable against a
caller-shaped object literal.

`jsonSerde()` wires the encoding side **on by default** — `jsonSerde({tristate: false})` is the only
way out — and exports `tristate(schema)` and `tristateObject(shape)` to lift your schemas, plus
`tristateReplacer` for use with a bare `JSON.stringify`.

If your format has its own three-state encoding, map `Tristate` onto it. If it genuinely has only
two, say so in the README rather than silently collapsing absent into null.

## What core's serde seam does not do

- **No default codec, and no fallback to JSON.** A pipeline with no serde configured serializes
  nothing.
- **No content negotiation.** `mediaType` is a default, not a negotiation.
- **No incremental decode.** `deserializeFrom` reads its source to EOF before returning; it is
  streaming *input*, not streaming *output*. `@dexpace/codec-json` must buffer, because `JSON.parse`
  has no incremental form, and that limitation is ledgered.
- **No SSE coupling.** Core's SSE parser has no serde dependency at all, and
  `bun run verify:sse-37` is a blocking CI step that proves it. `typedSseStream(stream, mapper)` is
  where a caller plugs decoding in.
