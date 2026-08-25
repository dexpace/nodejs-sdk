---
"@dexpace/core": minor
---

Phase 3 conformance fixes, from a review of the shipped `io/` and `body/` layers against the phase 3a/3b plans.

Correctness:

- The request-body logging tee now forwards **both** teardown paths to the sink it was handed. Its adapter stream
  declared `write` and `close` but no `abort`, and a `WritableStream`'s default abort algorithm is a no-op — so a
  delegate failure aborted the adapter and stopped there, leaving the caller's sink open, still locked, and never
  told the message was broken. A truncated body could be committed downstream as a complete one. `writeTo` also
  releases the writer when a delegate refuses before ever touching the adapter, which is what a `ConsumedBodyError`
  on a second write does (BODY-17, RECOV-12).
- `StreamBody.writeTo` no longer cancels the caller's stream when the sink fails. The unknown-length path used
  `pipeTo`'s default `preventCancel: false`, which cancels the *source* on a destination failure — taking
  cancellation ownership away from the caller on exactly the failure path, and disagreeing with the
  declared-length path, which only releases its reader. Both paths now leave the caller's stream alone (BODY-8).
- Every `Body` variant is frozen at construction. `readonly` is erased at run time, so `contentLength` could be
  reassigned after construction and desynchronized from the bytes `writeTo` emits — the same declared-length drift
  `MultipartBody` shares one framing routine to prevent, left open on the field a transport stamps into
  `Content-Length` (HTTP-1, XCUT-15, HTTP-51).
- `Response` regained the private constructor and `createResponse` friend hook that the body-lifecycle rewrite
  dropped. `Response` is exported as a value, so a public field-wise constructor let a caller construct around
  `build()`'s required-field validation, and it appeared in the published `.d.ts` (HTTP-2).
- `TeeSink.write` validates its count. `IO-3`'s guard existed as three byte-for-byte copies and the tee — the
  fourth size-taking surface — had none, so a negative count was rejected only indirectly, and not at all on its
  `count === 0` and short-source early returns. The guard is now single-sourced in `io/limits.ts`.
- `withResponseLogging` enforces the zero-length-chunk contract on the exceeds-cap tail path as well as the drain.
  A rule held in one regime and not the other made the same violating upstream pass or fail depending only on how
  big the body happened to be (BODY-25).

Public API:

- `Response` and the response-body logging wrapper no longer declare `[Symbol.asyncDispose]`; `close()` is the only
  teardown interface, matching every other resource-owning class in the package. The symbol postdates the declared
  `engines.node` floor (`>=18.17`), where it evaluates to `undefined` and binds the method to the string
  `"undefined"`, and its type reached the package only through a dev-only global — so a consumer compiling against
  the published `.d.ts` on this package's own declared `lib` failed with
  `TS2550: Property 'asyncDispose' does not exist on type 'SymbolConstructor'`. It returns, on all seven resource
  owners at once, when the runtime floor moves.
- Every public symbol now carries TSDoc. The committed API report had accumulated 62 `(undocumented)` members,
  including 11 of `Response`/`ResponseBuilder`'s own that a wholesale file rewrite had dropped; it is back to zero.

Internal:

- `http/charset.ts`'s `decodeText` is renamed `decodeBodyText`. It shares a name with `io/text-codec.ts`'s
  `decodeText` while deliberately disagreeing with it: this one delegates every label to `TextDecoder` (so
  `iso-8859-1` follows the WHATWG mapping onto windows-1252) and consumes a leading BOM, which is right for a whole
  message body; the other implements true ISO-8859-1 for IO-13's round-trip and sets `ignoreBOM` so a mid-stream
  BOM survives as ordinary data (SSE-12). Reaching for the wrong one silently changes bytes.
