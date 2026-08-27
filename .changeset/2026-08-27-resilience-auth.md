---
'@dexpace/core': minor
---

Ship the authentication layer (product-spec §11, `AUTH-1`–`AUTH-38`) and promote the pillar-authoring surface
to the public barrel. **This is the first release with new public API since Phase 1.**

`minor`, not `patch`: `packages/core/etc/core.api.md` gains the whole pipeline-authoring surface plus the auth
configuration types its signatures name, and `RequestOptions` gains one member. Nothing is removed or
narrowed, so no consumer breaks.

## What a caller can now do

```ts
import {
  ApiKeyCredential,
  createAuthDescriptor,
  createAuthRequirement,
  standardResilience,
} from '@dexpace/core';

const client = standardResilience(transport, {
  auth: {
    credentials: {apiKey: {credential: new ApiKeyCredential(process.env.API_KEY ?? '')}},
    tiers: {client: createAuthDescriptor([createAuthRequirement('API_KEY')])},
  },
});
```

`standardResilience()` installs redirect, retry, and auth in that order — `AUTH-27`'s "redirect wraps retry
wraps auth" — so auth re-resolves and re-stamps per redirect hop and per retry attempt. `PipelineBuilder`,
`retryStep`, `redirectStep`, and `authStep` are exported for hand-assembling a pipeline instead, and
`PipelineBuilder.seedFrom(runtime, 'flatten' | 'nest')` composes one pipeline onto another with the choice
explicit rather than accidental (`PIPE-35`).

## What landed

The scheme-agnostic descriptor/resolver model (`AuthScheme`, `AuthRequirement`, `AuthDescriptor`,
`resolveAuthRequirement`), the credential types (`BearerToken`, `ApiKeyCredential`, `NameKeyCredential`,
`TokenProvider`), a total RFC 7235 challenge parser, a dependency-free MD5, the Basic/Digest/static-key
stamping handlers, a single-flight three-zone bearer token cache, and one AUTH pillar step tying them
together. `RequestOptions` gains `auth?: AuthDescriptor`, which fills `AUTH-4`'s most-specific `perCall` tier.

Zero runtime dependencies still (`SEAM-1`). SHA-256 and the Digest client nonce go through
`globalThis.crypto`, and Basic stamping through `globalThis.btoa`, never `node:crypto` — the package stays
portable to browsers, Deno, and Workers. MD5 is hand-rolled because Web Crypto deliberately excludes it and
RFC 7616 still requires it for interop.

## Design calls worth recording

- **Basic and Digest never stamp preemptively.** Both are phrased in §11 entirely in terms of answering a
  parsed challenge, and Digest structurally cannot stamp before seeing the server's `realm`/`nonce`. `OAUTH2`
  and `API_KEY` do stamp preemptively; `NO_AUTH` never stamps. Flagged as an interpretation, not a certainty
  — Phase 9's conformance sweep re-checks it.
- **One auth step with one pluggable challenge hook, not three mechanisms.** `AUTH-27` mandates exactly one
  step, yet `AUTH-30`, `AUTH-23`–`AUTH-26`, and `AUTH-34`–`AUTH-37` read as three. Reconciled as one step,
  one `challengeHook` extension point, and a scheme-dependent default body. A caller may override the hook
  entirely — for a custom OAuth2 grant, say — and it takes precedence over every scheme default.
- **The cross-origin marker suppresses the WHOLE hop, not just the outbound pass.** The redirect step
  (Phase 5b) marks a cross-origin re-issue; the auth step is that marker's intended consumer. It skips the
  HTTPS guard, skips stamping, clears the marker so it never reaches the wire — and declines to answer a 401
  on that hop, because answering it would stamp exactly the credential the outbound pass withheld, onto a
  server-chosen foreign host.
- **A `TokenProvider` takes no arguments and must carry its own deadline.** `AUTH-34` coalesces every
  concurrent caller racing on a missing or expiring token onto ONE fetch, so that fetch belongs to no single
  request — handing it one caller's signal would let a stranger's cancellation reject callers who never
  aborted, and let a request that merely finished tear down a refresh others were joined to. Each caller
  instead races its own wait against its own signal, cancelling the wait without cancelling the work. Because
  nothing could ever populate a signal parameter, the type has none: write providers as
  `() => fetchToken({signal: AbortSignal.timeout(5_000)})`.
- **`ChallengeHook` receives the call's signal.** Unlike a token fetch, a hook is not shared between callers,
  so the same reasoning that withholds the signal above positively requires passing it here — a hook running a
  custom OAuth2 refresh grant is network I/O on the request path. The hook's third parameter is optional and
  additive: an existing two-argument hook still type-checks. `authStep` also declines to spend a second wire
  send on the replay once the caller has aborted, and skips the hook entirely when the call was already
  abandoned before the challenge arrived — matching the redirect and retry pillars.
- **A Digest challenge this client cannot echo is declined, not answered.** A received header may legally
  carry non-ASCII (`Digest realm="café"` is a real RFC 7616 shape), but an outbound header value may not, and
  loosening that is the request-splitting defence. Such a challenge is now reported as unsatisfiable, so the
  401 surfaces unchanged rather than the step throwing. A non-ASCII configured Digest *username* is caller
  misconfiguration and is rejected up front; RFC 7616 `username*` encoding is not yet supported.
- **Every credential type is a nominal class that redacts its secret.** `BearerToken`, `ApiKeyCredential`, and
  `NameKeyCredential` each hold their secret in a `#` field, so `console.log`, `util.inspect`,
  `JSON.stringify`, and `Object.keys` all see a redacted form and never the value. Build them through
  `createBearerToken`/the constructors — an object literal is not assignable, which is also what stops a
  `TokenProvider` handing back a token that skipped the non-blank validation.
- **One clock for the whole pipeline.** `AuthStepSettings.clock` is the `now()` half of the same `Clock`
  `RetryStepOptions.clock` takes, so one instance drives both pillars and a test cannot fake time for one and
  forget the other.
- **`challengeHook` is the only challenge-reaction extension point.** There is deliberately no
  `handlers` field: the built-in Basic and Digest handlers are internal, so a caller-supplied list could only
  replace them wholesale, never compose with them. A hook covers the custom-scheme case with a shape a caller
  can actually satisfy.
- **One bearer strategy, not two.** The reference ships a synchronous single-flight policy and a separate
  async three-zone policy because it has two pipeline execution stories. This port has one, so the three-zone
  policy ships unconditionally and `AUTH-34`'s non-blocking cached read is its fresh-zone branch. Same shape
  as the retry engine's `RETRY-28` collapse.
- **`AUTH-31`'s replayability gate applies to every replacement — and gates only the replay.** The reference
  gates only its sync step and recommends a port extend it; one unified step leaves exactly one place to apply
  it. A non-replayable body skips the re-drive, but the challenge is still handled, so a 401 on a streaming
  upload still evicts the token the server rejected instead of leaving it cached for every later request.
- **A refresh margin is validated, and so is a token's expiry.** `bearerMarginMs`, `BearerCredential.marginMs`,
  and `createBearerToken`'s `expiresAt` must all be finite. Expiry is evaluated as `now + margin > expiresAt`,
  which is `false` for `NaN` — an unvalidated margin (`Number(process.env.MARGIN_MS)` on an unset variable)
  made the cache read a long-dead token as fresh and serve it forever without ever calling the provider again.
- **A failed background token refresh can never fail the request that triggered it.** `AUTH-37` says so
  unconditionally, so the failure is swallowed unconditionally — including a programmer-error-shaped one. The
  alternative re-raised it into a promise nobody awaits, which does not surface at the fault: it terminates the
  host process asynchronously, unattributable to any request, while the request that triggered it had already
  been served a valid token.
- **A failing response release never masks the error it was unwinding from.** If the challenge hook throws and
  closing the 401's body then also fails, the hook's error stays primary and the teardown failure rides along
  as `suppressed` (`RECOV-12`), matching the redirect and retry pillars.

`standardResilience()` leaves the `LOGGING` slot empty — Phase 7b installs `loggingStep()` there and gives
`AUTH-37`'s failed-background-refresh case somewhere to be recorded. `SERDE` stays reserved.
