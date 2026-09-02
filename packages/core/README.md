# @dexpace/core

The transport-agnostic HTTP core of the dexpace SDK: an immutable request/response domain model, a
staged policy pipeline, and the seams everything else plugs into. **Zero runtime dependencies**, ESM
only, Node ≥ 20.3.

It is deliberately not an HTTP client — it never opens a socket. Pair it with a transport.

```sh
bun add @dexpace/core @dexpace/transport-fetch
```

```typescript
import {Request, standardResilience} from '@dexpace/core';
import {fetchTransport} from '@dexpace/transport-fetch';

const client = standardResilience(fetchTransport());

const response = await client.send(
  Request.newBuilder().url('https://api.example.com/v1/things').build(),
);
try {
  console.log(response.status.code, await response.text());
} finally {
  await response.close(); // the caller owns the body, always (BODY-15)
}
```

That is the whole zero-to-one path. `standardResilience()` returns a `Runtime` with redirect, retry,
auth and logging already installed in the order `AUTH-27` requires — redirect wraps retry wraps auth
— so a retry re-resolves credentials and a redirect hop re-stamps them.

## Which package do I install?

`@dexpace/core` alone gets you the models and the pipeline. Everything that touches a platform API
lives in a sibling package, because core's zero-dependency and zero-`node:`-import invariants are
hard (`SEAM-1`, gate-enforced by `bun run verify:seam-1`).

| You need | Install |
|---|---|
| To send a request, no extra dependencies | `@dexpace/transport-fetch` |
| Connection pools, proxies, real `close()` semantics | `@dexpace/transport-undici` |
| A JSON wire codec behind the `Serde` seam | `@dexpace/codec-json` |
| A file-backed request body (`node:fs`) | `@dexpace/body-file` |
| Logs routed to `pino` or `debug` | `@dexpace/logging-pino`, `@dexpace/logging-debug` |
| RxJS `Observable` views of SSE and pagination | `@dexpace/rx` |

Every one of them declares `@dexpace/core` as a **peer**, never a dependency: two copies of core in
one install would defeat the branded symbols and `instanceof` checks the seams rely on.

## The five things worth knowing before reading source

**1. Models are frozen and builder-built.** There is no public constructor on `Request`, `Response`,
`Headers`, `QueryParams`, `RequestOptions` or `RequestConditions` — `newBuilder()` is the only way
in, so validation cannot be routed around (`HTTP-2`). `newBuilder()` on an *instance* returns a
pre-filled builder that deep-copies every collection, so deriving never aliases the source
(`HTTP-3`).

```typescript
import {Request} from '@dexpace/core';

const request = Request.newBuilder().url('https://api.example.com/v1/things').build();

const authorized = request
  .newBuilder()
  .headers(request.headers.newBuilder().set('Authorization', 'Bearer …').build())
  .build();
```

**2. `Status` is total.** `Status.of(599)` succeeds, reports `isServerError`, and has `name ===
undefined` and `isRecognized === false`; `Status.recognized(599)` returns `undefined` so a caller can
tell a vendor code from a registered one. An unrecognized code is never an error — a server is free
to invent one.

**3. A body is a producer, not a buffer.** `byteArrayBody`, `stringBody`, `formUrlEncodedBody`,
`multipartBody`, `streamBody` and `serdeBody` are the factories; the classes are exported as types
only. `body.replayable` decides whether a retry can re-send it, and `materialize(body)` buys
replayability by buffering. `streamBody` is single-use by construction.

**4. The caller owns the response body.** `response.close()` is yours to call, on every path,
including the ones where an error is propagating. Nothing in the pipeline closes a response it hands
you.

**5. Errors are a two-level tree.** `DexpaceError` at the root, one subclass per subsystem —
`DomainModelError`, `IoError`, `HttpStatusError`, `AuthResolutionError`, `PaginationError`,
`SerializationError`/`DeserializationError`, `SseStreamError`, `CancellationError`. Exactly one
sanctioned third level: `TransportFailureError extends IoError`, so `catch (e) { if (e instanceof
IoError) }` still catches a transport failure (`docs/deviations.md` item 17). Wrap-and-rethrow always
passes `{cause}`.

## Building a pipeline yourself

`standardResilience()` is a preset over `PipelineBuilder`. When it is the wrong shape, layer onto it:

```typescript
import {PipelineBuilder, standardResilience, type Step} from '@dexpace/core';
import {fetchTransport} from '@dexpace/transport-fetch';

const stamp: Step = async (request, ctx) =>
  ctx.next(
    request
      .newBuilder()
      .headers(request.headers.newBuilder().set('X-Client-Phase', ctx.context.kind).build())
      .build(),
  );

const runtime = PipelineBuilder.seedFrom(
  standardResilience(fetchTransport(), {retry: {settings: {maxAttempts: 5}}}),
  'flatten',
)
  .append({type: Symbol('x-client-phase'), stage: 'POST_SERDE', fn: stamp})
  .build();
```

Steps run in `STAGE_ORDER`, sixteen stages from `PRE_REDIRECT` to `SEND`. The five **pillar** stages
— `REDIRECT`, `RETRY`, `AUTH`, `LOGGING`, `SERDE` (`PILLAR_STAGES`) — admit exactly one step each and
raise on a second; the surrounding `PRE_`/`POST_` stages stack.
`seedFrom(runtime, 'flatten' | 'nest')` is how the preset composes with a customized builder, rather
than the preset growing a "skip occupied slots" branch.

**Start from `seedFrom`, not from a bare `new PipelineBuilder(transport)`, if you want redirects.**
`redirectStep()` is public but its companion `POST_AUTH` guard is not: the redirect pillar marks a
cross-origin hop with an internal header, and the step that strips it before dispatch is `@internal`
and reachable only through the preset. A hand-built pipeline that installs `redirectStep()` directly
forwards that marker to the wire (`docs/open-items.md` U7).

`Runtime` implements `Transport`, so a pipeline is substitutable for the transport it wraps.
`Runtime.close()` is a documented no-op: the pipeline never owns the transport it was given
(`PIPE-27`).

## Beyond request/response

- **Serde.** `Serde`/`Serializer`/`Deserializer`/`Schema` are the seam; `decodeResponse` and
  `decodeSuccessResponse` are the response handlers; `Tristate` models PATCH's
  absent/null/present distinction so `{}` and `{"x": null}` stop being the same wire message. Core
  ships no codec — `@dexpace/codec-json` is the reference one.
- **Server-Sent Events.** `sseStreamFrom(response)` yields an `SseStream` of `SseEvent`;
  `typedSseStream(stream, mapper)` decodes into your own models. Single-pass over a response body
  this stream does not own, and no reconnect path in core (`SSE-37`/`SSE-38`, gate-enforced).
- **Pagination.** `Paginator` iterates `items()` or `pages()`; `cursorStrategy`,
  `pageNumberStrategy` and `linkHeaderStrategy` cover the three shipped shapes, and
  `PaginationStrategy` is the seam for the rest. A `Page` is closed before its items are yielded
  (`PAGE-11`).
- **Configuration.** `Configuration` is a layered lookup — explicit override, then the environment
  source under the exact key, then the property source under a normalized (lower-cased, dotted) key,
  then your fallback — built through `ConfigurationBuilder`. Both sources are caller-supplied seams
  (`CFG-11`), so a test substitutes them without touching the real environment.
  `getGlobalConfiguration()`/`setGlobalConfiguration()` hold the process-wide slot.
- **Observability.** `Logger` is a facade with `NOOP_LOGGER` as the default; `createLogger(sink)`
  adapts anything. `Tracer`/`Span`/`Meter` are duck-typed, so an OpenTelemetry object satisfies them
  with no adapter and no registration.

## Where the details are

This README gets you running. It is deliberately not the API reference — that is generated and
gate-verified, and a hand-written third copy would drift:

- **Every exported symbol, with its signature:**
  [`etc/core.api.md`](https://github.com/dexpace/nodejs-sdk/blob/main/packages/core/etc/core.api.md), regenerated by `bun run api:local` and
  verified in CI by `bun run api`.
- **What each symbol means, `@throws` included:** the TSDoc, which ships in the emitted `.d.ts` and
  shows up on hover.
- **How the packages compose, with worked cross-package examples:**
  [`docs/sdk-documentation/`](https://github.com/dexpace/nodejs-sdk/blob/main/docs/sdk-documentation).
- **What is normative:** [`docs/product-spec/`](https://github.com/dexpace/nodejs-sdk/blob/main/docs/product-spec). Every `HTTP-N`, `SEAM-N`,
  `RETRY-N` identifier in this README and in the source is an entry there.

Every link above is absolute on purpose. `package.json` ships `files: ["dist"]`, so none of these
paths exist in the published tarball, and no manifest carries a `repository` field for npm's renderer
to rewrite a relative link with — so on npmjs.com a relative one renders broken. That is `U8`'s
failure class, and the first place to check when adding a link here.
