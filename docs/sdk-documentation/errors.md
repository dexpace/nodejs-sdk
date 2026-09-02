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
    ├── DomainModelError          — a model rejected its input
    │   ├── RequiredFieldError            a builder was missing a required field (HTTP-4)
    │   ├── HeaderValidationError         a header name or value broke the grammar
    │   ├── UrlConstructionError          the URL could not be built
    │   ├── MediaTypeParseError           malformed media type
    │   ├── EtagParseError                malformed ETag
    │   ├── ProtocolParseError            unrecognized protocol token
    │   ├── HttpRangeValidationError      malformed or impossible Range
    │   ├── RequestOptionsValidationError timeoutMs / maxRetries out of range
    │   ├── RequestConditionsValidationError
    │   └── RequestBodyNotAllowedError    a body on a method that forbids one
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
import {isBodyError, isSerdeError} from '@dexpace/core';

declare const e: unknown;

isBodyError(e); // ConsumedBodyError | MultipartBoundaryError | FormBodyValidationError
isSerdeError(e); // SerializationError | DeserializationError
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

## Errors you cannot catch by class

Some throwables are not exported from the barrel, so `instanceof` is unavailable and the only handle
is `error.name` or the message:

| Error | Raised by | Reachable as |
|---|---|---|
| `SchemeDowngradeError` | the redirect pillar, on a rejected HTTPS→HTTP hop | `error.name === 'SchemeDowngradeError'` |
| `NonReplayableBodyError` | the redirect pillar, when a hop needs a body resend it cannot do | `error.name === 'NonReplayableBodyError'` |
| `PillarCollisionError` | `PipelineBuilder`, on a second step in one pillar stage | `error.name === 'PillarCollisionError'` |
| `AnchorNotFoundError` | `insertBefore`/`insertAfter`/`replace`, on an unknown `type` symbol | `error.name === 'AnchorNotFoundError'` |
| `CrossStageEditError`, `ReservedStageError`, `CursorAlreadyAdvancedError` | `PipelineBuilder` and the cursor | likewise |

All of them descend from `DexpaceError`, so the broad catch works; only the narrow one does not.

**`InvariantViolation` is the exception to the exception.** It extends `Error` directly, not
`DexpaceError`, and it is not exported. It signals a broken internal precondition — a bug in this SDK
or in a seam implementation you supplied, never a condition to handle. `standardResilience()` raises
it synchronously for invalid pillar settings, such as a non-finite bearer refresh margin or a
non-header-safe Digest username, which is the one case a consumer will see it: at wiring time, loudly,
before any request is sent.

**Whether to promote the classes in the table above is an open decision** (`docs/open-items.md` U9,
where the full count is ten classes across 57 `@throws` tags). Every one of them is documented in a
`@public` function's `@throws` tag, and the styleguide's rule for `@throws` is that it names the type
*and what the caller should do about it* (`docs/knowledge/harvested/documentation.md:24`), which a
caller cannot act on without the class. `InvariantViolation` is the awkward member and may well be
resolved the other way — by dropping its tags rather than exporting it, since a bug is not a
condition.

## What does not throw

Worth stating, because each looks like it should:

- **Exceeding the redirect hop cap.** `maxHops` returns the current 3xx response, unfollowed
  (`REDIR-17`, `decide.ts:205`). `maxHops: 0` is how "do not follow redirects" is spelled, and it is
  the same code path.
- **A retry budget running out.** The last response is returned live and unread; ownership transfers
  to you (`docs/open-items.md` P7).
- **An unrecognized status code.** `Status.of(599)` is a valid `Status`; see [`http.md`](./http.md).
- **A malformed ETag.** `ETag.parse` returns `undefined`. `EtagParseError` is for the construction
  paths that cannot degrade.
