# Write a response handler

A response handler turns a `Response` into your model. Core ships three shapes; write your own when
none fits.

## The three shipped shapes

All three come from `@dexpace/core`.

| Shape | Use when |
|---|---|
| `decodeSuccessResponse(response, deserializer, target)` | The common case: decode 2xx, raise on 4xx/5xx |
| `decodeResponse(response, deserializer, target)` | You want the error body decoded too — an RFC 7807 problem document, say |
| `new TypedResponse(response, parse)` | You need the status, headers and request *alongside* the value, decoded lazily |

`target` is `{schema, typeName?}`: the runtime type witness plus an optional label that names it in
an error message. It travels as one object because a schema and its label describe one thing, and
because `(response, deserializer, schema, typeName)` is four parameters.

```typescript
import {decodeSuccessResponse, type Response, type Schema} from '@dexpace/core';
import {jsonSerde} from '@dexpace/codec-json';

interface Thing {
  readonly id: string;
}
declare const ThingSchema: Schema<Thing>; // any object with parse(input: unknown): Thing

const serde = jsonSerde();

export async function readThing(response: Response): Promise<Thing> {
  return decodeSuccessResponse(response, serde.deserializer, {
    schema: ThingSchema,
    typeName: 'Thing',
  });
}
```

**Import `Response` from `@dexpace/core`, always.** A bare `Response` in a signature resolves to the
DOM global under a `lib` that includes `"DOM"`, and the two are unrelated types — this SDK's
`Response` has `status: Status`, `close()` and `request`, and no `json()`. The mistake typechecks
until you try to pass one.

`decodeSuccessResponse` delegates to `decodeResponse` on a 2xx and to `toHttpError` on a **4xx or 5xx**,
so a `404` becomes an `HttpStatusError` carrying `status`, a replayable `body()` and a non-consuming
`preview()` — a bounded in-memory copy at the 1 MiB `HTTP-52`/`BODY-30` cap, taken before the response
was closed. There is no headers accessor on it; read anything else you need off the response before you
hand it over. Any *other* non-2xx — a `1xx`, or an unfollowed `3xx` such as a `304` — is neither decoded
nor mapped: the response is closed and a `DeserializationError` is raised whose message leads with the
status code and which carries `ETag` and `Location` as fields, so conditional and redirect context
survives the close (`SERDE-28`).

## What the shipped handlers guarantee, and what you must reproduce

**1. The response is closed on every path.** Success, missing body, codec failure, stream failure. A
handler that returns early on one branch strands a connection.

**2. A close failure never displaces the real failure.** This is the part that looks like a
one-liner and is not:

```typescript
// WRONG: when close() rejects while an error is already in flight, the finally's
// rejection REPLACES it — the caller is told their connection dropped when in fact
// their payload was malformed.
try {
  return await work();
} finally {
  await response.close();
}
```

The rule the shipped handlers follow (`RECOV-12`):

| Work | Close | Result |
|---|---|---|
| threw | ok | the work error propagates |
| threw | threw | the work error stays **primary**; the close error attaches as `suppressed` |
| ok | threw | the close error propagates — it is the only failure there is |

The suppression wrapper's `name` is `'SuppressedError'`, `.error` is the primary and `.suppressed` the
release failure. **`instanceof SuppressedError` is not a valid test**: the class is absent on this
project's declared Node floor and a structurally identical stand-in is built there instead. Test the
shape, or read `.error` unconditionally.

**A failed release is the only thing in this SDK that builds one.** Every site that constructs the
pairing — the response chain, the redirect and auth and retry pillars, the serde handlers, the SSE
stream, the paginator — is doing this one job: a `close()` that threw while an error was already in
flight. It is a genuine two-value shape, which is why it fits.

The retry pillar used to build one for a *second* reason, folding N prior attempt errors into a
nested chain of pairs so that what you caught after three attempts was a wrapper rather than the
failure. It no longer does: it surfaces the last attempt's error unwrapped and records the earlier
ones beside it, read back with `retryAttempts()` (see [`pipelines.md`](./pipelines.md#the-four-shipped-pillars)).
So if you catch a `'SuppressedError'` from this SDK, `.suppressed` is a teardown failure, never an
earlier attempt.

**3. Only payload failures are re-typed.** `SERDE-12`: a malformed body or a shape mismatch becomes a
`DeserializationError` with the original chained; a genuine stream failure propagates untouched,
because re-wrapping it would tell a caller their payload was malformed when their socket dropped.

**4. `isSerdeError(e)` is the supported discriminator**, not `instanceof` against a stream-error class
— that class is not public surface.

### The limit of that discriminator, stated plainly

Every error already in this SDK's typed tree passes through untouched, so a stream failure raised by
core's own I/O layer is always recognizable. A **foreign** one is not. `decodeResponse` hands the live
stream to the codec and never reads it, so at the catch a transport's raw error is indistinguishable
from a non-conforming codec leaking one — and since `SERDE-27` requires a codec failure to surface as
a serde exception, the untyped case is wrapped.

In practice that means a `fetch`/undici `TypeError('terminated')`, a hand-built `ReadableStream`
errored with a bare `Error`, or an aborted body (`DOMException` named `'AbortError'`) is reported as a
`DeserializationError`. Read `isSerdeError(e) === true` as "payload **or** foreign stream", not as
proof of a payload failure. Fixing it needs the transport to tag its stream errors.

## Writing one

```typescript
import {DeserializationError, type Response} from '@dexpace/core';

export async function readNdjson<T>(
  response: Response,
  parseLine: (line: string) => T,
): Promise<T[]> {
  try {
    const text = await response.text(); // text() closes the response itself (BODY-16)
    return text
      .split('\n')
      .filter(line => line.length > 0)
      .map(parseLine);
  } catch (cause) {
    throw new DeserializationError('could not decode the NDJSON payload', {cause});
  }
}
```

`response.text()` and `.bytes()` close the response whether the read succeeds or not, which is why
this handler needs no `finally`. A handler that reads `response.body` directly does, and then owes
rule 2's ordering.

**`decodeResponse` never buffers.** It hands the live body stream to `Deserializer.deserializeFrom`,
which reads it to EOF. Whether the codec buffers is the codec's business — `@dexpace/codec-json`
must, because `JSON.parse` has no incremental form, and that is ledgered. A handler that needs to act
on the payload *before* it ends reads `response.body` itself, as above.

## Two more things a response can be

**Server-Sent Events.** `sseStreamFrom(response)` yields `SseEvent`s; `typedSseStream(stream, mapper)`
decodes them into your models. The mapper returns `mapperValue(v)`, `MAPPER_SKIP` or `MAPPER_DONE`.
Core's SSE parser has **no** serde dependency and no reconnect path, and
`bun run verify:sse-37` is a blocking CI step that proves both.

**A page.** See [`write-a-paging-strategy.md`](./write-a-paging-strategy.md).

## Ownership, once more

The pipeline never closes a response it hands you. `toHttpError` and the two `decode*` handlers do,
because they read it. A handler you write must decide which it is and say so in its own TSDoc — that
is the single fact a caller cannot recover from the signature.
