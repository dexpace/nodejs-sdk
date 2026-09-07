# Bodies

There are two body concepts and they are not symmetric. A **request** body is a producer you hand to
the SDK. A **response** body is a resource the SDK hands to you, and you own it.

## Request bodies are producers, not buffers

```typescript
interface Body {
  readonly kind: 'byte-array' | 'string' | 'stream' | 'form-urlencoded' | 'multipart' | 'file';
  readonly mediaType: string | undefined;
  readonly contentLength: number;
  readonly replayable: boolean;
  writeTo(sink: WritableStream<Uint8Array>): Promise<void>;
}
```

`writeTo` emits bytes on demand into a sink the transport supplies. Nothing is buffered until
something asks for it, which is what lets a file body of any size cost a constant amount of heap.

**The concrete classes are exported as types only.** `ByteArrayBody`, `StringBody`,
`FormUrlEncodedBody`, `MultipartBody` and `StreamBody` are `export type`, never values, because
exporting the class would publish `new ByteArrayBody(...)` as a field-wise constructor — which
`HTTP-2` forbids and which duplicates the factory for no stated need. Construct through the factory
and annotate with the type.

| Factory | Signature | `replayable` |
|---|---|---|
| `byteArrayBody` | `(bytes, mediaType?)` | `true` |
| `stringBody` | `(text, mediaType?)` | `true` |
| `formUrlEncodedBody` | `(input)` — a `QueryParams`, `Map`, plain object, or entry list | `true` |
| `multipartBody` | `(parts, boundary?)` | as its least-replayable part |
| `streamBody` | `(stream, mediaType?, contentLength?)` | `false` |
| `serdeBody` | `(value, serde, mediaType?)` | `true` |
| `fileBody` (`@dexpace/body-file`) | `(path, {start?, count?})` | `true` |

```typescript
import {Request, multipartBody, stringBody} from '@dexpace/core';
import {fileBody} from '@dexpace/body-file';

const upload = multipartBody([
  {name: 'metadata', body: stringBody('{"kind":"photo"}', 'application/json')},
  {name: 'file', filename: 'cat.jpg', body: fileBody('./cat.jpg')},
]);

const request = Request.newBuilder()
  .method('POST')
  .url('https://api.example.com/v1/uploads')
  .body(upload)
  .build();
```

`multipartBody` generates a boundary when you do not supply one, and validates a supplied one against
the boundary grammar — a bad boundary is a `MultipartBoundaryError` at construction, not a corrupt
request on the wire.

## Replayability, and what retry does about it

`replayable` answers one question: can this body be sent a second time? A `ReadableStream` is
single-use by construction, so `streamBody(...).replayable` is `false` and a retry of a request
carrying one cannot re-send it.

`materialize(body)` is the escape hatch — it drains the body once, into memory, and returns an
equivalent replayable one:

```typescript
import {materialize, streamBody} from '@dexpace/core';

declare const someStream: ReadableStream<Uint8Array>;

const once = streamBody(someStream, 'application/octet-stream');
const many = await materialize(once); // now replayable; the original is consumed

console.log(once.replayable, many.replayable); // false true
```

That is a deliberate cost, taken deliberately: buffering an arbitrarily large upload to make it
retryable is a decision for the caller who knows how large it is, not for the retry engine. A
retryable body arrives at the retry pillar already retryable.

**A body is single-use even when `replayable` is `true`** in one sense that matters: `writeTo` may be
called again, but the *sink* may not be reused. Each call needs its own sink, and the transport
supplies one per attempt.

## Response bodies belong to the caller

`Response.body` is a `ReadableStream<Uint8Array> | null`. `Response` also offers `bytes()` and
`text()`, which drain it.

**You close it. Always. On every path.** `BODY-15` puts ownership with the caller, and nothing in the
pipeline closes a response it hands you — not the retry pillar, not the redirect pillar, not
`Runtime.send()`.

```typescript
import type {Response} from '@dexpace/core';

declare const response: Response;

async function read(): Promise<string> {
  try {
    return await response.text();
  } finally {
    await response.close();
  }
}
```

`close()` is idempotent, and idempotent in the strict sense: the promise is **memoized**, not
flag-guarded, so a release that *fails* propagates that failure to every caller rather than the
second call reporting success over a connection that was never released.

`bytes()` and `text()` close the response themselves, whether the read succeeds or not (`BODY-16`) —
including when an external consumer already holds the reader lock and `getReader()` throws. Calling
`close()` afterwards is still correct and costs nothing.

**On the request side, a single-use body written twice raises `ConsumedBodyError`** (`BODY-3`). That
is a different error from anything on the response side; `isBodyError(e)` narrows to it and its two
siblings.

### The one place the SDK closes a response for you

`toHttpError(response)` does, because it must:

```typescript
import {toHttpError, type Response} from '@dexpace/core';

declare const response: Response;

const failure = await toHttpError(response);
if (failure !== null) throw failure; // response is already drained and closed
console.log(await response.text());  // only reachable on 2xx/3xx
```

On an error status it drains the body up to a 1 MiB cap (`BODY-30`/`HTTP-52`), keeps the preview on
the returned `HttpStatusError`, and closes the response — the connection is released even for a
20 GB error body, because the drain keeps reading past the cap and discards. On a non-error status it
returns `null` and leaves the response untouched and unread.

`HttpStatusError` therefore carries the status, the headers, and a bounded body preview. The full
body is irrecoverably gone; that is the trade, and it is deliberate. The cap itself is required —
`BODY-30`/`HTTP-52` — and the decision to size it once for every consumer rather than make it
configurable is recorded as a **closed deferral** — the "Every buffering cap" row of
[`docs/work/mvp/2026-09-04-register-retirement-purge.md`](../work/mvp/2026-09-04-register-retirement-purge.md),
where the dissolved deferral register's rows went — not as a deviation:
nothing here departs from the reference contract. `errors.md` states the same fact the same way.

### Reading a response as a model

`TypedResponse<T>` pairs a `Response` with a parse function and exposes `value()`:

```typescript
import {TypedResponse, type Response} from '@dexpace/core';

declare const response: Response;

const typed = new TypedResponse(response, async r => JSON.parse(await r.text()) as {id: number});
const {id} = await typed.value();
```

Status, headers, protocol and request stay reachable without consuming anything. For the
schema-driven form, see [`write-a-response-handler.md`](./write-a-response-handler.md).

## File bodies, and why they are a separate package

```typescript
import {fileBody} from '@dexpace/body-file';

const body = fileBody('./upload.bin', {start: 1024, count: 4096});
```

`@dexpace/core` cannot import `node:fs`; its zero-`node:`-import invariant is hard, and that is the
whole reason `@dexpace/body-file` exists as its own unit.

The file is stat'd at **construction**, not at send time (`HTTP-40`, `BODY-11`), and all four ways
the range can be wrong are rejected there: the path must exist and be a regular file, `start >= 0`,
`start <= size`, `count >= 0`, and `start + count <= size`. The `start <= size` check earns its place
independently — `count` defaults to `size - start`, which goes negative past end-of-file and then
*satisfies* the sum check, silently producing a zero-byte upload.

`writeTo()` opens a **fresh** handle per call, so a retry re-sends the same bytes. It does not close
the sink it was handed (`BODY-8` — closing belongs to whoever created it) but aborts it on failure,
so a consumer sees the error rather than a silently truncated stream. A short read raises rather than
reporting success (`BODY-13`).

**Transports recognize a file body structurally, on `body.kind === 'file'`, never by `instanceof`.**
That is what lets `@dexpace/transport-undici` dispatch straight off the file — honoring `start`/`count`,
one fewer userspace copy — while depending on neither `@dexpace/body-file` nor anything it exports.
`FileBodyDescriptor` in core is the structural contract both sides agree on.

## Serde bodies

`serdeBody(value, serde, mediaType?)` serializes through a `Serde` and takes the serde's own media
type unless you override it:

```typescript
import {serdeBody} from '@dexpace/core';
import {jsonSerde} from '@dexpace/codec-json';

const body = serdeBody({name: 'ada'}, jsonSerde()); // Content-Type: application/json
```

See [`write-a-serde.md`](./write-a-serde.md) for the seam itself, including the PATCH tri-state
problem that makes `{}` and `{"x": null}` different messages.
