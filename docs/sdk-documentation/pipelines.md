# Pipelines

A pipeline is an ordered list of steps ending at a transport. Building one is the main thing a client
library does with this SDK.

## The three types

```typescript
type Next = (request?: Request) => Promise<Response>;
type Step = (request: Request, ctx: StepContext) => Promise<Response>;

interface StepDescriptor {
  readonly type: symbol;   // stable identity, for anchoring and removal
  readonly stage: Stage;   // where in the order it sits
  readonly fn: Step;       // the behaviour
}
```

A step receives the request, may rewrite it, calls `ctx.next(maybeRewritten)` to invoke everything
below, and may post-process the response on the way back up. `ctx.next()` with no argument passes the
request through unchanged.

```typescript
interface StepContext {
  readonly next: Next;
  readonly context: ExecutionContext;         // DispatchContext | RequestContext | ExchangeContext
  readonly options?: RequestOptions;          // the per-call options
  readonly signal?: AbortSignal;              // the caller's signal
  readonly fork?: () => Next;                 // a fresh chain, for steps that re-drive
}
```

`fork` is what separates a re-driving step from an ordinary one. `next` may be called once; a step
that retries or follows a redirect calls `ctx.fork()` to obtain a fresh downstream chain per attempt.
Retry, redirect and auth all use it. An ordinary step does not need it and should not take it.

## The sixteen stages

```
PRE_REDIRECT  REDIRECT  POST_REDIRECT
PRE_RETRY     RETRY     POST_RETRY
PRE_AUTH      AUTH      POST_AUTH
PRE_LOGGING   LOGGING   POST_LOGGING
PRE_SERDE     SERDE     POST_SERDE
SEND
```

`STAGE_ORDER` is that array. `PILLAR_STAGES` is the set `{REDIRECT, RETRY, AUTH, LOGGING, SERDE}` —
each admits **exactly one** step and raises on a second. The `PRE_`/`POST_` stages around them stack
with append/prepend semantics, and are the user-extensible slots.

Order is not arbitrary. Redirect wraps retry wraps auth (`AUTH-27`), so a retry attempt re-resolves
credentials and a redirect hop re-stamps them. Getting that backwards means replaying a stale token
or leaking a credential across an origin.

`SERDE` is reserved and ships no behaviour anywhere in this roadmap's scope. It is a pillar so that a
future serde step cannot be installed twice.

## The preset

```typescript
import {standardResilience} from '@dexpace/core';
import {fetchTransport} from '@dexpace/transport-fetch';

const client = standardResilience(fetchTransport(), {
  retry: {settings: {maxAttempts: 4, totalTimeoutMs: 30_000}},
  redirect: {maxHops: 3, allowSchemeDowngrade: false},
  logging: {granularity: 'headers'},
  // auth: omitted -> a NO_AUTH-only step that stamps nothing
});
```

Every slot is optional and every omitted one takes that pillar's own defaults.
`PIPE-24`'s "installs into empty pillar slots only" holds **by construction**: the function always
starts from a fresh `PipelineBuilder`, so no slot can be occupied and no runtime check is needed.

`standardResilience()` also installs the redirect pillar through `withRedirect()`, which seats a
second, `POST_AUTH` step alongside it — the guard that strips the SDK's internal cross-origin marker
header before dispatch (`REDIR-11(c)`). **Both are public as of 2026-09-02**
(`docs/work/mvp/2026-09-04-open-items-dissolution.md` U7): call `withRedirect(builder)` to get the pillar and its guard together, or
`stripCrossOriginMarkerStep()` to install the guard yourself. A pipeline that installs bare
`redirectStep()` and neither of them forwards the marker to the wire.

## Extending the preset

```typescript
import {PipelineBuilder, standardResilience, type Step} from '@dexpace/core';
import {fetchTransport} from '@dexpace/transport-fetch';

const requestId: Step = async (request, ctx) =>
  ctx.next(
    request
      .newBuilder()
      .headers(request.headers.newBuilder().set('X-Request-Id', crypto.randomUUID()).build())
      .build(),
  );

const runtime = PipelineBuilder.seedFrom(standardResilience(fetchTransport()), 'flatten')
  .append({type: Symbol('x-request-id'), stage: 'PRE_SERDE', fn: requestId})
  .build();
```

`seedFrom(runtime, mode)` takes a **built** runtime and returns a builder seeded from it:

- **`'flatten'`** unpacks the runtime's steps into the new builder, so the result is one flat chain
  and the new step sits in true stage order among the old ones.
- **`'nest'`** installs the whole runtime as a single terminal unit, so the old pipeline runs as an
  opaque inner chain. Use this when the inner pipeline's ordering must be preserved exactly.

The rest of the builder API operates by descriptor `type` symbol: `insertBefore`, `insertAfter`,
`replace`, `remove`, `reload`. Anchoring on a symbol rather than a position is what keeps an edit
correct when the surrounding pipeline changes.

## Runtime

```typescript
class Runtime implements Transport {
  send(request: Request, options?: RequestOptions, signal?: AbortSignal): Promise<Response>;
  close(): Promise<void>;
  get steps(): readonly StepDescriptor[];
  get transport(): Transport;
}
```

Because `Runtime` **is** a `Transport`, a pipeline is substitutable for the transport it wraps — which
is what makes `'nest'` mode and `Paginator`'s `transport` field work on a full pipeline.

`Runtime.close()` is a documented no-op. The pipeline never owns the transport it was given
(`PIPE-27`); closing it is the caller's job, in the `finally` that also closes the response.

## Execution context

A call promotes through three context shapes, and a step reads `ctx.context.kind` to know which it is
in:

| `kind` | Shape adds | Meaning |
|---|---|---|
| `'dispatch'` | `key`, `instrumentation` | Before a request exists |
| `'request'` | `request`, `operationName` | A request has been assembled |
| `'exchange'` | the response side | A response has arrived |

All three carry the same `InstrumentationBundle`, so trace and span identity survive the promotions.
`activateSpan(span)` returns a `Scope`; `getActiveSpan()` reads the current one. Propagation is
`AsyncLocalStorage`-based, which is why `@dexpace/rx` installs no RxJS scheduler — adding
`observeOn`/`subscribeOn` downstream makes reinstating the context the caller's job.

## The four shipped pillars

| Pillar | Factory | Key settings |
|---|---|---|
| Retry | `retryStep(options?)` | `maxAttempts`, `retryableStatuses`, `totalTimeoutMs`, `attemptHeaderName`, backoff (`initialDelayMs`, `multiplier`, `maxDelayMs`, `jitter`, `fixedDelayMs`), injectable `clock`/`random` |
| Redirect | `redirectStep(overrides?)` | `maxHops`, `allowedMethods`, `allow303`, `allowSchemeDowngrade`, `locationHeader`, `predicate` |
| Auth | `authStep(settings)` | `credentials`, `tiers`, `challengeHook`, `bearerMarginMs` — see [`auth.md`](./auth.md) |
| Logging | `loggingStep(settings?)` | `granularity`, `severity`, `previewSizeBytes`, `droppedHeaderPolicy`, `logger`, `meter`, `tracerFactory` |

Retry and redirect are worth a few notes each, because both surprise people:

- **What retry throws is the last attempt's own error.** The class you catch does not depend on how
  many attempts ran: a refused connection is a `TransportFailureError` whether `maxAttempts` was 1 or
  3, and an abort that lands during a backoff wait is a `CancellationError` (`XCUT-1`). The earlier
  attempts are not thrown away — `retryAttempts(caught)` returns them, oldest first, with the error
  you passed in excluded from its own trail (`RETRY-34`):

  ```typescript
  import {
    retryAttempts,
    TransportFailureError,
    type Request,
    type Runtime,
  } from '@dexpace/core';

  declare const runtime: Runtime;
  declare const request: Request;

  export async function send(): Promise<void> {
    try {
      await runtime.send(request);
    } catch (error) {
      if (error instanceof TransportFailureError) {
        for (const prior of retryAttempts(error)) {
          console.error('an earlier attempt failed:', prior);
        }
      }
      throw error;
    }
  }
  ```

  One entry per attempt that failed *before* the one you caught — which is not an attempt count, so
  resist writing `length + 1`. The surfaced error is an attempt's own only when it came from one, and
  sometimes it did not: a cancellation or timeout the engine observes between attempts is synthesized
  at that gate, and so is a failure from stamping the attempt header, which runs before the request
  goes out. On those paths the trail already covers every send. Narrowing the catch does not help —
  a timeout signal is mapped to `TransportFailureError`, the same class a real send failure raises.

  The trail is a side table keyed by the error, not a property on it, so nothing is added to an
  object you may not own; an error that never went through a retry loop answers with an empty list.
  Until 2026-09-05 the pillar wrapped its terminal failure in a `SuppressedError` instead, which made
  the surfaced class a function of the attempt budget.
- **Retry pacing honours the server.** `Retry-After`, `X-RateLimit-Reset` and friends are parsed in a
  fixed precedence and win over computed backoff. Every computed delta is clamped to a 365-day
  ceiling that `RETRY-18` mandates — so a server that sends `X-RateLimit-Reset` in milliseconds
  instead of epoch seconds parks the retry for a year, which is indistinguishable from a hang. Set
  `totalTimeoutMs` if that matters to you; it is opt-in and `undefined` by default
  (`docs/work/mvp/2026-09-04-open-items-dissolution.md` P4).
- **Retry hands back a live response.** Any response the engine *discards* is closed. The response
  that ends the loop — attempt cap reached, budget spent, status not retryable — is returned live and
  unread. Ownership transfers to you (`docs/work/mvp/2026-09-04-open-items-dissolution.md` P7).
- **Redirects are never followed by the transport.** Both shipped transports pin redirects off, so
  the pipeline is the single redirect authority (`TRANSPORT-1`/`TRANSPORT-2`).
- **A non-replayable body ends a redirect.** `PIPE-40` and `REDIR-22` disagree about what should
  happen; this port closes the response and throws (`docs/work/mvp/2026-09-04-open-items-dissolution.md` G1).

## Testing a pipeline

Nothing here needs a socket. A `Transport` is two methods, so the test double is a literal:

```typescript
import {Protocol, Response, Status, type Transport} from '@dexpace/core';

const alwaysOk: Transport = {
  send: async request =>
    Response.newBuilder()
      .request(request)
      .status(Status.of(200))
      .protocol(Protocol.HTTP_1_1)
      .body(null)
      .build(),
  close: async () => undefined,
};
```

Timing is testable without waiting: `retryStep({clock, random})` takes both seams, so a test drives
the backoff schedule deterministically. `loggingStep({clock, logger, meter})` takes the same shape.

Core does carry a scripted `FakeTransport` under `src/testing/`, but it is `@internal` and **not**
exported from the barrel — it exists for core's own multi-attempt tests. A consumer writes the
five-line literal above.

`@dexpace/transport-conformance` is the other half of this, for transport authors rather than
pipeline authors: see [`write-a-transport.md`](./write-a-transport.md).
