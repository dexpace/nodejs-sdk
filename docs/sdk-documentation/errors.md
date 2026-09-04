# Errors

Every error this SDK raises **as a condition a caller might handle** descends from `DexpaceError`,
which descends from `Error`. There are no bare `throw new Error(...)` sites, and wrap-and-rethrow
always passes `{cause}`, so the original is always reachable.

The one deliberate exception is `InvariantViolation`, which extends `Error` directly because it
signals a bug rather than a condition — see the end of this file.

```typescript
import {DexpaceError, type Request, type Transport} from '@dexpace/core';

declare const client: Transport;
declare const request: Request;

try {
  await client.send(request);
} catch (error) {
  if (error instanceof DexpaceError) {
    // ours: name, message, and a cause chain
  }
  throw error;
}
```

Each class sets `this.name = new.target.name` in its constructor, so `error.name` is the class name
even after minification changes the function's own `name`.

## The tree

Two levels by rule, with exactly one sanctioned third.

```
Error
└── DexpaceError
    │
    │   (the ten HTTP domain-model errors — `isDomainModelError` matches this whole group)
    ├── RequiredFieldError                a builder was missing a required field (HTTP-4)
    ├── HeaderValidationError             a header name or value broke the grammar
    ├── UrlConstructionError              the URL could not be built
    ├── MediaTypeParseError               malformed media type
    ├── EtagParseError                    malformed ETag
    ├── ProtocolParseError                unrecognized protocol token
    ├── HttpRangeValidationError          malformed or impossible Range
    ├── RequestOptionsValidationError     timeoutMs / maxRetries out of range
    ├── RequestConditionsValidationError  contradictory if-match / if-none-match state
    ├── RequestBodyNotAllowedError        a body on a method that forbids one
    │
    ├── IoError                   — a byte-level failure
    │   └── TransportFailureError         the one third level, see below
    ├── HttpStatusError           — the server answered 4xx/5xx (see `toHttpError`)
    ├── CancellationError         — the caller aborted; terminal, never retried
    ├── ConsumedBodyError         — a single-use request body was written twice (BODY-3)
    ├── MultipartBoundaryError    — a supplied multipart boundary broke the grammar
    ├── FormBodyValidationError   — form-encoded input was not encodable
    ├── AuthResolutionError       — no configured credential satisfies the resolved tier
    ├── PlaintextCredentialError  — a credentialed scheme met a non-HTTPS URL (AUTH-28)
    ├── SerializationError        — a value could not be serialized
    ├── DeserializationError      — wire bytes did not satisfy the schema
    ├── SseStreamError            — the SSE stream failed
    ├── SseLineTooLongError       — a line exceeded the bounded buffer
    ├── PaginationError           — engine misuse or a precondition violation
    └── OperationAssemblyError    — an OperationDescriptor could not build a Request
```

**`TransportFailureError extends IoError` is the deliberate third level.** It is ledgered
(`docs/deviations.md` item 17): flattening it would force every consumer to discriminate on a string
tag, and `catch (e) { if (e instanceof IoError) }` still catches a transport failure. Held at exactly
three; a fourth is not sanctioned.

**`DomainModelError` was a second such tier, and it is gone.** It sat between `DexpaceError` and the
ten model leaves above as an empty marker class, and nothing in the SDK ever narrowed on it. Those
ten now extend `DexpaceError` directly, and `isDomainModelError(e)` replaces
`e instanceof DomainModelError` — same union, no inheritance level. That is a breaking change to a
barrel export, taken while `@dexpace/core` is still `0.0.0` and it is cheap to take. It does **not**
make the tree uniformly two-level: `TransportFailureError` above is required to be a third level by
`TRANSPORT-20`.

## The distinction that matters most: cancel versus timeout

```typescript
import {
  CancellationError,
  TransportFailureError,
  type Request,
  type RequestOptions,
  type Transport,
} from '@dexpace/core';

declare const client: Transport;
declare const request: Request;
declare const options: RequestOptions;
declare const signal: AbortSignal;

export async function call(): Promise<void> {
  try {
    await client.send(request, options, signal);
  } catch (error) {
    if (error instanceof CancellationError) return; // the caller asked to stop
    if (error instanceof TransportFailureError) throw error; // retryable: the network failed
    throw error;
  }
}
```

- **`CancellationError` is terminal.** The caller aborted. The retry engine will not retry it, and
  nothing further will be attempted. A raw `DOMException` from `AbortSignal` is never surfaced; both
  shipped transports map it (`TRANSPORT-3`/`TRANSPORT-4`).
- **`TransportFailureError` is retryable.** A timeout, a connection reset, a DNS failure.

`composeSignal(userSignal, timeoutMs)` builds the combined signal, and `isTimeoutSignal(signal)` tells
the two apart at the point of abort — which is exactly how a transport decides which of the two
errors to raise.

## Narrowing helpers

Three predicates exist for the cases where `instanceof` on a union is tedious:

```typescript
import {isBodyError, isDomainModelError, isSerdeError} from '@dexpace/core';

declare const e: unknown;

isBodyError(e); // ConsumedBodyError | MultipartBoundaryError | FormBodyValidationError
isSerdeError(e); // SerializationError | DeserializationError
isDomainModelError(e); // the ten domain-model leaves; replaces `e instanceof DomainModelError`
```

## HTTP status failures

A 4xx or 5xx is **not** an exception. `send()` resolves with the response, because the response is
often the useful part. `toHttpError` is the opt-in conversion:

```typescript
import {toHttpError, type Request, type Transport} from '@dexpace/core';

declare const client: Transport;
declare const request: Request;

const response = await client.send(request);
const failure = await toHttpError(response);
if (failure !== null) throw failure;
```

On an error status it drains the body to a 1 MiB cap (`BODY-30`/`HTTP-52`), keeps that preview on the
error, and **closes the response**. On any other status it returns `null` and leaves the response
untouched. The full error body is irrecoverable after the call; that is the documented trade.

## Errors raised by the pipeline and the redirect pillar

Eight classes that a `@throws` tag named but no package exported were promoted to the barrel on
2026-09-02, so `instanceof` now works for all of them (`docs/work/mvp/2026-09-04-open-items-dissolution.md` U9):

| Error | Raised by |
|---|---|
| `SchemeDowngradeError` | the redirect pillar, on a rejected HTTPS→HTTP hop |
| `NonReplayableBodyError` | the redirect pillar, when a hop needs a body resend it cannot do |
| `PillarCollisionError` | `PipelineBuilder`, on a second step in one pillar stage |
| `AnchorNotFoundError` | `insertBefore`/`insertAfter`/`replace`, on an unknown `type` symbol |
| `CrossStageEditError` | an insert or replace whose incoming step declares a different stage than its anchor |
| `ReservedStageError` | any attempt to install a user step onto the terminal `SEND` stage |
| `CursorAlreadyAdvancedError` | a step reusing an already-invoked `next()`/`fork()` continuation |
| `EndOfStreamError` | a `BufferedSource` read that required more bytes than the source delivered |

Two more joined them on the same date, both from `XCUT-8`'s "never fabricate a successful exception":

| Error | Raised by |
|---|---|
| `HttpStatusValidationError` | `new HttpStatusError(status, …)` when `status` is not an integer in 400–599. The constructor validated nothing before, so a consumer could build an `HttpStatusError` claiming a `200`. `toHttpError` is the total form — it returns `null` instead of throwing |
| `RetryDiscardedResponseError` | the retry engine's suppressed trail, for a response it discarded whose status is outside 400–599. Reachable only if you widen `RetrySettings.retryableStatuses` to include a non-error code; the trail previously said `HttpStatusError` for it, which claimed an HTTP failure that had not happened |

All of them descend from `DexpaceError`, so the broad catch works too.

**`InvariantViolation` is the one that stays unreachable, deliberately.** It extends `Error`
directly, not `DexpaceError`, and it is not exported. It signals a broken internal precondition — a
bug in this SDK or in a seam implementation you supplied, never a condition to handle — so the
`@throws` tags that used to name it now read as prose ("an assertion failure (a caller bug, not a
catchable condition)"), because a `@throws` tag is supposed to name the type *and what the caller
should do about it* (`docs/knowledge/harvested/documentation.md:24`), and "catch this" is the wrong
answer here. `standardResilience()` raises it synchronously for invalid pillar settings, such as a
non-finite bearer refresh margin or a non-header-safe Digest username, which is the one case a
consumer will see it: at wiring time, loudly, before any request is sent.

`DuplicateContextKeyError` is likewise unexported, because the only thing that raises it —
`ContextStore` — is itself `@internal` and appears in no `.d.ts` a consumer reads.

## What does not throw

Worth stating, because each looks like it should:

- **Exceeding the redirect hop cap.** `maxHops` returns the current 3xx response, unfollowed
  (`REDIR-17`, `decide.ts:205`). `maxHops: 0` is how "do not follow redirects" is spelled, and it is
  the same code path.
- **A retry budget running out.** The last response is returned live and unread; ownership transfers
  to you (`docs/work/mvp/2026-09-04-open-items-dissolution.md` P7).
- **An unrecognized status code.** `Status.of(599)` is a valid `Status`; see [`http.md`](./http.md).
- **A malformed ETag.** `ETag.parse` returns `undefined`. `EtagParseError` is for the construction
  paths that cannot degrade.
