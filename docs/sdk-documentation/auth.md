# Authentication

The auth pillar resolves *which* credential a call needs, then *stamps* it — once per attempt, per
redirect hop, per retry. It runs inside redirect and inside retry (`AUTH-27`), which is why a retried
request never replays a stale token and a redirected one is re-stamped against the new hop.

## Tiers

```typescript
interface AuthTiers {
  readonly perCall?: AuthDescriptor;    // highest precedence
  readonly operation?: AuthDescriptor;
  readonly client?: AuthDescriptor;     // lowest
}
```

The most specific tier that is set wins (`AUTH-4`). `perCall` comes from
`RequestOptions.newBuilder().auth(descriptor)`, which is how one call opts out of, or into, something
different from the client default. Only the *selection* is tiered; whether a selected requirement can
be satisfied at all is `AUTH-6`, and failing it is an `AuthResolutionError`.

An `AuthDescriptor` is a list of `AuthRequirement`s, each a scheme plus optional scopes and
parameters. Both are built by factory, never as an object literal:

```typescript
import {createAuthDescriptor, createAuthRequirement} from '@dexpace/core';

const clientTier = createAuthDescriptor([
  createAuthRequirement('OAUTH2', ['read:things']),
  createAuthRequirement('NO_AUTH'), // allowsAnonymous becomes true
]);
```

The factories validate and freeze (`AUTH-3`). A descriptor containing a `NO_AUTH` requirement reports
`allowsAnonymous`, which is how "authentication is optional here" is expressed.

## Credentials

```typescript
interface AuthCredentialSet {
  readonly bearer?: {provider: TokenProvider; marginMs?: number};
  readonly basic?: {username: string; password: string};
  readonly digest?: {username: string; password: string; algorithmPreference?: DigestAlgorithm[]};
  readonly apiKey?: {credential: ApiKeyCredential | NameKeyCredential; headerName?: string; prefix?: string};
}
```

The five schemes are `OAUTH2`, `API_KEY`, `BASIC`, `DIGEST` and `NO_AUTH`. A requirement names a
scheme; the credential set supplies the material for it. A requirement with no matching credential is
an `AuthResolutionError` at send time, not a silent unauthenticated request.

**`ApiKeyCredential`, `NameKeyCredential` and `BearerToken` are nominal, not structural.** Each carries
a `#private` field, so no caller-side object literal is assignable to them and the validation in each
factory cannot be routed around. They also override `toString()` and Node's inspect symbol, so a
credential cannot leak into a log line or a stack trace by accident.

```typescript
import {ApiKeyCredential, createBearerToken} from '@dexpace/core';

String(new ApiKeyCredential('super-secret')); // 'ApiKeyCredential{key=***}'
String(createBearerToken('t', 1)); // 'BearerToken{token=***, expiresAt=1}' — the expiry survives
```

The inspect symbol matters as much as `toString`: `console.log(credential)` and `util.inspect` do not
route an object argument through `toString`, so both are overridden (`AUTH-8`).

## A worked client

```typescript
import {
  createAuthDescriptor,
  createAuthRequirement,
  createBearerToken,
  standardResilience,
} from '@dexpace/core';
import {undiciTransport} from '@dexpace/transport-undici';

declare function mintToken(): Promise<string>;

const client = standardResilience(undiciTransport(), {
  auth: {
    credentials: {
      bearer: {
        provider: async () => createBearerToken(await mintToken(), Date.now() + 3_600_000),
        marginMs: 60_000,
      },
    },
    tiers: {client: createAuthDescriptor([createAuthRequirement('OAUTH2')])},
  },
});
```

`TokenProvider` is `() => Promise<BearerToken>`. The cache refreshes a token `marginMs` before its
`expiresAt`, and **concurrent refreshes are serialized** — a burst of calls arriving at expiry mints
one token, not one per call (`XCUT-12`). A provider returning a null or already-expired token is an
`AuthResolutionError` (`AUTH-35`), not a request sent with a dead token.

## The HTTPS guard

A credentialed scheme meeting a non-HTTPS URL is a `PlaintextCredentialError`, raised before the
request is dispatched (`AUTH-28`). There is no option to disable it. `NO_AUTH` never trips it, which
is why an auth-less `standardResilience()` installs a `NO_AUTH`-only step rather than no step at all —
the pillar slot stays filled and the behaviour stays uniform.

## Challenges

```typescript
type ChallengeHook = (
  response: Response,
  request: Request,
  options?: {signal?: AbortSignal},
) => Promise<Request | undefined>;
```

A `challengeHook` sees a `401` and may return a replacement request; returning `undefined` means "I
cannot satisfy this", and the `401` surfaces to the caller unchanged. The built-in Basic and Digest
handlers — including the RFC 7235 `WWW-Authenticate` parser and RFC 7616 Digest with MD5, MD5-sess,
SHA-256 and SHA-256-sess — are internal and drive themselves; the hook is for schemes this SDK does
not implement.

There is deliberately **no** way to append a handler to the built-in list. A `handlers` field existed
and was cut at review: it forced three types onto the public barrel and could not compose with the
internal handlers, so it was replace-semantics masquerading as extension. The shape to ship, if a
caller ever needs it, is an append field plus public `basicHandler`/`digestHandler` factories
(`docs/deferred-items.md`, the *caller-supplied `ChallengeHandler` list on `AuthStepSettings`* row — still
deferred, unscheduled until a second auth scheme needs one).

**Basic and Digest never stamp preemptively.** They react to a challenge. That is an interpretation of
`§11` rather than a stated requirement, and it is ledgered as one.

## Redirects and credentials

Credentials are attached at an origin and must not follow a request to a different one. The redirect
pillar marks a cross-origin hop with an internal header; the auth step is that marker's consumer and
first stripper, and a `POST_AUTH` guard strips it again as an idempotent backstop, so the marker can
never reach the wire (`REDIR-11`, `AUTH-29`).

That guard is installed by `standardResilience()`, and as of 2026-09-02 a hand-built pipeline can
install it too: `withRedirect(builder)` seats the pillar and its guard together, and
`stripCrossOriginMarkerStep()` is the guard on its own. Reaching for bare `redirectStep()` without
one of them is what forwards the marker — see [`pipelines.md`](./pipelines.md).

## Proxy credentials are a separate axis

`ProxyOptions.credentials` answers a proxy's `407`; the auth pillar answers an origin's `401`. They
never cross: proxy credentials are never sent in answer to a `401`, and a per-request
`Proxy-Authorization` header is dropped from the outbound pass whenever a proxy is configured. See
`@dexpace/transport-undici`'s README — it is the only transport that can route a proxy at all.
