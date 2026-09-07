---
'@dexpace/core': patch
---

Add the redirect-following pillar step for product-spec §10 (`REDIR-1`–`REDIR-27`) and close `PIPE-40`. No
public API change.

Everything this adds lives under `packages/core/src/redirect/` and none of it is re-exported from
`src/index.ts` — `packages/core/etc/core.api.md` is byte-identical before and after. `patch` rather than an
empty changeset because files under `packages/` did change: the published tarball carries the new
`dist/redirect/*.js`, and a consumer stepping through the package in a debugger will see them.

One file landed outside `redirect/`: `packages/core/src/recovery/release.ts`, which is
`releaseQuietly`/`withReleaseFailure` extracted unchanged from `retry/engine.ts`. The redirect step needs
the same "a teardown failure never becomes primary" discipline `RECOV-12` already required of retry, and
the helper's identity guard is subtle enough that a second copy would drift. `engine.ts` now imports what
it used to define; its behavior and its suite are unchanged.

What landed: `codes.ts` (the recognized `{301,302,303,307,308}` set and per-code method eligibility),
`cross-origin.ts` (the RFC 6454 origin tuple compared against the seed, plus the credential-suppression
marker header), `settings.ts` (validated, frozen policy with a defensively copied allowed-method set),
`decide.ts` (the pure per-hop decision), `redirect-step.ts` (the `REDIRECT` pillar adapter), and
`strip-marker-step.ts` (a `POST_AUTH` guard plus `withRedirect()`). Two new operational error leaves,
`NonReplayableBodyError` and `SchemeDowngradeError`, both `@internal` for now.

Four design calls worth recording:

- **The cross-origin suppression signal is a real header, not an in-process marker.** A `WeakSet<Request>`
  keyed by object identity is unforgeable and never touches the wire, but stage order is
  `REDIRECT → RETRY → AUTH` and 5a's attempt-stamping builds a fresh per-attempt `Request` copy when
  enabled — an identity-keyed signal would silently stop matching exactly when a retry sits between
  redirect and auth, which is when cross-origin credential suppression matters most. Stamping preserves
  headers, so a header survives the intermediate copy.
- **A second, always-bundled step strips that marker independently of whether an auth step exists.**
  `REDIR-11` itself names the porter caveat: in the reference only the auth step strips the signal, so a
  pipeline with none forwards it to the transport. 5b ships before 5c, so that is not a future concern
  here — it is a live leak this phase would otherwise ship. `stripCrossOriginMarkerStep()` occupies 4c's
  inert `POST_AUTH` extension slot, so nothing in 4c or 5c had to change.
- **Two origin-shaped checks, two deliberately different reference points.** Cross-origin classification
  compares against the **seed** origin for the whole chain (`REDIR-8`), so a foreign host cannot hand the
  credential back by redirecting to the seed's own origin. The scheme-downgrade guard compares the
  **current hop** against its target (`REDIR-15`), so an HTTPS→HTTP→HTTPS chain flags only the hop that
  actually downgraded. Conflating them silently breaks one or the other.
- **A failing release never replaces the error it was supposed to let through.** `Response.close()`
  rethrows whatever cancelling the body raised, so the two error paths that close before propagating
  (`decideOrClose`, and the `'fail'` branch's `SchemeDowngradeError`) route through
  `withReleaseFailure`: the decision error stays primary and the release failure rides along as
  `suppressed`. The third close — releasing a superseded hop before the next drive — is deliberately
  left bare, because there is no primary error to preserve and `PIPE-40` makes the release itself part
  of the contract.
- **Location resolution ends with an explicit `http:`/`https:` gate.** WHATWG `URL` parses
  `javascript:`, `data:`, `file:`, and `mailto:` without complaint, and the downgrade guard waves all of
  them through (none is `http:`). Without the gate the step would dispatch a server-supplied
  `javascript:` target. The `catch` around `new URL(raw, base)` is a genuinely narrow path, not the
  general garbage guard it looks like: with a base supplied, a non-URL string resolves as a relative
  reference rather than throwing.

One normative conflict, resolved and recorded rather than silently picked: **`PIPE-40` and `REDIR-22`
disagree, both at `MUST`, about the non-replayable-body path.** `PIPE-40` lists it among the paths whose
in-flight response is "returned unclosed"; `REDIR-22`(b) lists the same trigger among those "closed before
the error propagates". `REDIR-6` settles the control flow — that path "MUST fail with a clear error" — so it
throws, and a response never returned cannot be returned unclosed. 5b closes and throws; the contradiction
is in the design's Deviation Ledger and deferred to Phase 10, which owns the erratum either way.

Two known gaps, both recorded in the phase checklist:

- **`REDIR-28`'s structured hop/loop/downgrade log events, and `REDIR-15`'s "surface it observably" clause
  on a permitted downgrade, are not implemented here.** Phase 5b executes before Phase 7b, so
  `redirect-step.ts` cannot import `observability/`, and 7b needs this step for its own retrofit test —
  the dependency cannot run the other way. Phase 7b's Task 9 owns them, named in `redirectStep()`'s TSDoc.
- **`REDIR-20`'s predicate override is read as scoped to code/method eligibility only.** A configured
  predicate replaces the built-in follow decision; it does not bypass userinfo stripping, credential
  hygiene, the downgrade guard, the replayability gate, or loop/cap detection, all of which the same spec
  document states as unconditional `MUST`s. Logged in the design's Deviation Ledger for Phase 10 and
  flagged for re-confirmation at Phase 9's conformance sweep.
